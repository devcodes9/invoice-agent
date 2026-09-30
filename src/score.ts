import { compare, type Field, type Value } from "./compare";
import type { Receipt } from "./schema";
import { validate, type Validation } from "./validate";

export const STATUSES = ["UNREADABLE", "LOW", "MEDIUM", "HIGH", "DUPLICATE"] as const;
export type Status = (typeof STATUSES)[number];

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
  reasons: string[];
  source: "A" | "B" | null; // reading used for the numbers
  itemsSource: "A" | "B" | null; // reading used for line items
};

const KEY: Field[] = ["total", "date"];
const NUMERIC: Field[] = ["subtotal", "tax", "adjustments", "rounding", "total", "items"];
const LABEL: Partial<Record<Field, string>> = { items: "line items" };

const fmt = (v: Value) => (v === null ? "none" : typeof v === "number" ? v.toFixed(2) : v);
const sum = (xs: (number | null)[]) => Math.round(xs.reduce<number>((t, x) => t + (x ?? 0), 0) * 100) / 100;
const illegible = (r: Receipt) => r.missing.filter((m) => m.reason === "illegible").map((m) => m.field as string);

// How well a reading's numbers are backed: 2 = sums add up, 1 = sums not checkable but items back them, 0 = neither.
const strength = (v: Validation) =>
  v.totalCheck === "tax-added" || v.totalCheck === "tax-inclusive" ? 2 : v.totalCheck === "skipped" && (v.itemsCheck === "subtotal" || v.itemsCheck === "total") ? 1 : 0;
const BACKED = ["", " (items add up)", " (sums match)"];

export function emptyRow(file: string, status: Status, reasons: string[]): Row {
  return { file, status, confidence: STATUSES.indexOf(status), vendor: null, date: null, currency: null, subtotal: null, tax: null, total: null, flagged_fields: [], reasons, source: null, itemsSource: null };
}

export function score(file: string, a: Receipt, b: Receipt, today = new Date()): Row {
  const unreadable: string[] = [];
  for (const [name, r] of [["A", a], ["B", b]] as const) {
    const keyIllegible = illegible(r).filter((f) => f === "vendor" || f === "date" || f === "total");
    if (!r.legible) unreadable.push(`model ${name}: not legible`);
    else if (keyIllegible.length >= 2) unreadable.push(`model ${name}: ${keyIllegible.join(", ")} illegible`);
  }
  if (unreadable.length) return emptyRow(file, "UNREADABLE", unreadable);

  const va = validate(a, today), vb = validate(b, today);
  const source = strength(vb) > strength(va) ? "B" : "A";
  const [c, vc] = source === "A" ? [a, va] : [b, vb];
  // Line items: the numbers' reading unless its items don't add up and the other's do.
  const itemsOk = (v: Validation) => v.itemsCheck !== "fail";
  const itemsSource = itemsOk(vc) || !itemsOk(source === "A" ? vb : va) ? source : source === "A" ? "B" : "A";
  const [ci, vi] = itemsSource === "A" ? [a, va] : [b, vb];

  const low = new Set<string>(), medium = new Set<string>();
  const reasons: string[] = [];

  for (const d of compare(a, b)) {
    if (d.agree || d.field === "currency") continue;
    const numeric = NUMERIC.includes(d.field);
    const used = d.field === "items" ? itemsSource : numeric ? source : "A";
    const why = d.field === "items" ? (itemsOk(vi) ? " (items add up)" : "") : numeric ? BACKED[strength(vc)] : "";
    reasons.push(`check ${LABEL[d.field] ?? d.field}: A=${fmt(d.a)} B=${fmt(d.b)}, used ${used}${why}`);
    if (KEY.includes(d.field)) low.add(d.field);
    else if (d.field === "vendor") medium.add(d.field);
    // Item disagreement only downgrades via the items check below: arithmetic settles it otherwise.
  }
  if (va.currency && vb.currency && va.currency !== vb.currency) {
    medium.add("currency");
    reasons.push(`check currency: A=${va.currency} B=${vb.currency}, used ${source}`);
  }

  if (vc.totalCheck === "fail") {
    low.add("total");
    const adj = sum(c.adjustments.map((x) => x.amount)), tax = sum(c.taxes.map((x) => x.amount)), rnd = c.rounding ?? 0;
    reasons.push(`check sums: subtotal ${fmt(c.subtotal)} + tax ${fmt(tax)} + adjustments ${fmt(adj)} + rounding ${fmt(rnd)} = ${fmt(sum([c.subtotal, tax, adj, rnd]))}, total ${fmt(c.total)}`);
  }
  if (c.total === null) low.add("total");
  if (vc.dateOk === false) low.add("date");
  if (vi.itemsCheck === "fail") {
    medium.add("items");
    reasons.push(`check line items: sum ${fmt(sum(ci.line_items.map((i) => i.amount)))} matches neither subtotal ${fmt(vi.subtotal)} nor total ${fmt(ci.total)}`);
  }
  for (const f of new Set([...illegible(a), ...illegible(b)])) {
    (KEY.includes(f as Field) ? low : medium).add(f);
    reasons.push(`${f} illegible`);
  }
  for (const r of vc.reasons) if (!reasons.includes(r)) reasons.push(r);

  const status: Status = low.size ? "LOW" : medium.size ? "MEDIUM" : "HIGH";
  return {
    file,
    status,
    confidence: STATUSES.indexOf(status),
    vendor: a.vendor ?? b.vendor,
    date: a.date ?? b.date,
    currency: vc.currency ?? (source === "A" ? vb : va).currency,
    subtotal: vc.subtotal,
    tax: c.taxes.length ? sum(c.taxes.map((t) => t.amount)) : null,
    total: c.total,
    flagged_fields: [...low, ...medium],
    reasons,
    source,
    itemsSource,
  };
}

// A failed model call never drops a receipt: score what we have and send it to review.
export function scoreReadings(file: string, a: Receipt | Error, b: Receipt | Error, today = new Date()): Row {
  const failed = [["A", a], ["B", b]].flatMap(([n, r]) => (r instanceof Error ? [`model ${n} failed: ${r.message}`] : []));
  if (!failed.length) return score(file, a as Receipt, b as Receipt, today);
  const ok = [a, b].find((r): r is Receipt => !(r instanceof Error));
  if (!ok) return emptyRow(file, "LOW", failed);
  const row = score(file, ok, ok, today);
  const status = row.status === "UNREADABLE" ? row.status : "LOW";
  return { ...row, status, confidence: STATUSES.indexOf(status), reasons: [...failed, ...row.reasons], source: ok === a ? "A" : "B", itemsSource: ok === a ? "A" : "B" };
}
