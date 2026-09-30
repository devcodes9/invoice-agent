import { compare, normText, sameValue, type Field, type Value } from "./compare";
import type { Receipt } from "./schema";
import { validate } from "./validate";

export const STATUSES = ["UNREADABLE", "LOW", "MEDIUM", "HIGH", "DUPLICATE"] as const;
export type Status = (typeof STATUSES)[number];

// A value is filled only when both readings agree. Code never breaks a tie; it reports the disagreement.
export type Row = {
  file: string;
  status: Status;
  confidence: number; // index in STATUSES, so sorting ascending puts the worst first
  vendor: string | null;
  date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  flagged_fields: string[];
  reasons: string[]; // user-facing: about the receipt, never about models
  itemsAgreed: boolean; // line items are written only when both readings agree
};

type Evidence = Receipt["evidence"];
const KEY: Field[] = ["total", "date"];
const SUMMED: Field[] = ["tax", "adjustments", "rounding", "items"];
const QUOTED = ["subtotal", "rounding", "total"] as const; // single printed numbers we can find in their line
const LABEL: Partial<Record<Field, string>> = { items: "line items" };

const fmt = (v: Value) => (v === null ? "none" : typeof v === "number" ? v.toFixed(2) : v);
const sum = (xs: (number | null)[]) => Math.round(xs.reduce<number>((t, x) => t + (x ?? 0), 0) * 100) / 100;
const illegible = (r: Receipt) => r.missing.filter((m) => m.reason === "illegible").map((m) => m.field as string);
const quote = (r: Receipt, f: Field): string | null => (f in r.evidence ? r.evidence[f as keyof Evidence] : null);
// The printed label without its number: "Total (RM) : 436.20" → "total".
const lineLabel = (ev: string) => normText(ev.replace(/[\d.,-]+/g, " "));
// "RM1,436.20" contains 1436.20; "(0.20)" or "-0.20" contains -0.20.
const inQuote = (v: number, ev: string) => {
  const text = ev.replace(/,/g, "");
  const abs = Math.abs(v);
  return text.includes(abs.toFixed(2)) || new RegExp(`(^|[^\\d.])${abs}([^\\d]|$)`).test(text);
};

function describe(field: Field, x: Value, evx: string | null, y: Value, evy: string | null): string {
  const label = LABEL[field] ?? field;
  // A summed 0 with no printed line means "nothing found".
  const eff = (v: Value, ev: string | null) => (SUMMED.includes(field) && v === 0 && !ev ? null : v);
  // Sorted, so the reason doesn't depend on reader order.
  const [p, q] = [
    { v: eff(x, evx), ev: evx },
    { v: eff(y, evy), ev: evy },
  ].sort((m, n) => fmt(m.v).localeCompare(fmt(n.v), undefined, { numeric: true }));
  if (field === "items")
    return sameValue(x, y) ? `check line items: same total ${fmt(x)}, but line amounts differ` : `check line items: totals read as ${fmt(p.v ?? 0)} or ${fmt(q.v ?? 0)}`;
  if (p.v === null || q.v === null) {
    const one = p.v === null ? q : p;
    return `check ${label}: ${fmt(one.v)} may not be printed${one.ev ? ` ("${one.ev}")` : ""}`;
  }
  if (p.ev && q.ev && lineLabel(p.ev) !== lineLabel(q.ev))
    return `check ${label}: ${fmt(p.v)} ("${p.ev}") or ${fmt(q.v)} ("${q.ev}"), different printed lines`;
  const ev = p.ev ?? q.ev;
  return `check ${label}: read as ${fmt(p.v)} or ${fmt(q.v)}${ev ? ` ("${ev}")` : ""}`;
}

export function emptyRow(file: string, status: Status, reasons: string[]): Row {
  return { file, status, confidence: STATUSES.indexOf(status), vendor: null, date: null, currency: null, subtotal: null, tax: null, total: null, flagged_fields: [], reasons, itemsAgreed: false };
}

export function score(file: string, a: Receipt, b: Receipt, today = new Date()): Row {
  if (!a.legible || !b.legible) return emptyRow(file, "UNREADABLE", ["receipt could not be read"]);
  const keyIllegible: string[] = [...new Set([...illegible(a), ...illegible(b)])].filter((f) => f === "vendor" || f === "date" || f === "total");
  if (illegible(a).filter((f) => keyIllegible.includes(f)).length >= 2 || illegible(b).filter((f) => keyIllegible.includes(f)).length >= 2)
    return emptyRow(file, "UNREADABLE", [`${keyIllegible.join(", ")} illegible`]);

  const va = validate(a, today), vb = validate(b, today);
  const low = new Set<string>(), medium = new Set<string>();
  const reasons: string[] = [];
  const flag = (f: string) => (KEY.includes(f as Field) ? low : medium).add(f);

  const diffs = compare(a, b);
  const agrees = (f: Field) => diffs.find((d) => d.field === f)!.agree;
  for (const d of diffs) {
    if (d.agree || d.field === "currency") continue;
    reasons.push(describe(d.field, d.a, quote(a, d.field), d.b, quote(b, d.field)));
    flag(d.field);
  }
  const currencyAgrees = va.currency === vb.currency;
  if (!currencyAgrees) {
    const [x, y] = [va.currency, vb.currency].map((c) => c ?? "none").sort();
    reasons.push(`check currency: read as ${x} or ${y}`);
    flag("currency");
  }

  // A number must appear in the line it was quoted from; otherwise it may be made up.
  const quoteReasons = new Set<string>();
  for (const f of QUOTED)
    for (const r of [a, b]) {
      const v = r[f], ev = r.evidence[f];
      if (v === null) continue;
      if (!ev) quoteReasons.add(`check ${f}: ${fmt(v)} has no printed line`);
      else if (!inQuote(v, ev)) quoteReasons.add(`check ${f}: ${fmt(v)} not found in printed line "${ev}"`);
      else continue;
      medium.add(f);
    }
  reasons.push(...[...quoteReasons].sort());

  // Checks on agreed values.
  const moneyAgrees = (["subtotal", "tax", "adjustments", "rounding", "total"] as Field[]).every(agrees);
  if (moneyAgrees && va.totalCheck === "fail") {
    low.add("total");
    const adj = sum(a.adjustments.map((x) => x.amount)), tax = sum(a.taxes.map((x) => x.amount)), rnd = a.rounding ?? 0;
    reasons.push(`check sums: subtotal ${fmt(a.subtotal)} + tax ${fmt(tax)} + adjustments ${fmt(adj)} + rounding ${fmt(rnd)} = ${fmt(sum([a.subtotal, tax, adj, rnd]))}, total ${fmt(a.total)}`);
  }
  if (agrees("total") && a.total === null) low.add("total");
  if (agrees("date") && va.dateOk === false) low.add("date");

  const unreadableItems = Math.max(...[a, b].map((r) => r.line_items.filter((i) => i.illegible).length));
  if (unreadableItems) {
    medium.add("items");
    reasons.push(`check line items: ${unreadableItems} amount${unreadableItems > 1 ? "s" : ""} could not be read`);
  }
  const itemsAgreed = agrees("items") && !unreadableItems;
  if (itemsAgreed && va.itemsCheck === "fail") {
    medium.add("items");
    reasons.push(`check line items: sum ${fmt(sum(a.line_items.map((i) => i.amount)))} matches neither subtotal ${fmt(va.subtotal)} nor total ${fmt(a.total)}`);
  }

  for (const f of [...new Set([...illegible(a), ...illegible(b)])].sort()) {
    flag(f);
    reasons.push(`${f} illegible`);
  }
  for (const r of va.reasons) if (vb.reasons.includes(r) && !reasons.includes(r)) reasons.push(r);

  const status: Status = low.size ? "LOW" : medium.size ? "MEDIUM" : "HIGH";
  const subtotal = !agrees("subtotal") ? null : a.subtotal ?? (agrees("total") && agrees("tax") ? va.subtotal : null);
  return {
    file,
    status,
    confidence: STATUSES.indexOf(status),
    vendor: agrees("vendor") ? a.vendor : null,
    date: agrees("date") ? a.date : null,
    currency: currencyAgrees ? va.currency : null,
    subtotal,
    tax: agrees("tax") && (a.taxes.length || b.taxes.length) ? sum(a.taxes.map((t) => t.amount)) : null,
    total: agrees("total") ? a.total : null,
    flagged_fields: [...low, ...medium],
    reasons,
    itemsAgreed,
  };
}

// A failed reading never drops a receipt, but with one reading nothing is agreed, so nothing is filled.
export function scoreReadings(file: string, a: Receipt | Error, b: Receipt | Error, today = new Date()): Row {
  if (a instanceof Error || b instanceof Error) return emptyRow(file, "LOW", ["could not be read automatically, check all fields"]);
  return score(file, a, b, today);
}
