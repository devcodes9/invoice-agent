import { compare, inQuote, normText, sameValue, type Field, type Value } from "./compare";
import type { Receipt } from "./schema";
import { validate } from "./validate";
import { TOLERANCE } from "./config";
import { normalize } from "./normalize";

export const STATUSES = ["UNREADABLE", "LOW", "MEDIUM", "HIGH", "DUPLICATE"] as const;
export type Status = (typeof STATUSES)[number];

// A value is filled only when both readings agree, or when arithmetic on agreed values picks one of two different numbers.
export type Row = {
  file: string;
  status: Status;
  confidence: number; // index in STATUSES, so sorting ascending puts the worst first
  vendor: string | null;
  date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  adjustments: number | null; // service charge, bill discount: shown so subtotal + tax + adjustments + rounding visibly reaches the total
  rounding: number | null;
  total: number | null;
  flagged_fields: string[];
  reasons: string[]; // user-facing: about the receipt, never about models
  readAs: Partial<Record<Field, [string, string]>>; // both readings of each disputed field, for the review page
  lineItems: Receipt["line_items"] | null; // written only when both readings agree, or arithmetic settled them
};

const SUMMED: Field[] = ["tax", "adjustments", "rounding", "items"];
const QUOTED = ["subtotal", "rounding", "total"] as const; // single printed numbers we can find in their line
const LABEL: Partial<Record<Field, string>> = { items: "line items" };
const NOUN: Partial<Record<Field, string>> = { adjustments: "an adjustment" };

const fmt = (v: Value) => (v === null ? "none" : typeof v === "number" ? v.toFixed(2) : v);
const sum = (xs: (number | null)[]) => Math.round(xs.reduce<number>((t, x) => t + (x ?? 0), 0) * 100) / 100;
const illegible = (r: Receipt) => r.missing.filter((m) => m.reason === "illegible").map((m) => m.field as string);
const quote = (r: Receipt, f: Field): string | null => r.evidence.find((e) => e.field === f)?.text ?? null;
// The printed label without its number: "Total (RM) : 436.20" → "total".
const lineLabel = (ev: string) => normText(ev.replace(/[\d.,-]+/g, " "));
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
    // The line is printed; the question is whether it is this field.
    return one.ev ? `check ${label}: is "${one.ev}" ${NOUN[field] ?? `the ${label}`}? (${fmt(one.v)})` : `check ${label}: ${fmt(one.v)} may not be printed`;
  }
  if (p.ev && q.ev && lineLabel(p.ev) !== lineLabel(q.ev))
    return `check ${label}: ${fmt(p.v)} ("${p.ev}") or ${fmt(q.v)} ("${q.ev}"), different printed lines`;
  const ev = p.ev ?? q.ev;
  return `check ${label}: read as ${fmt(p.v)} or ${fmt(q.v)}${ev ? ` ("${ev}")` : ""}`;
}

export function emptyRow(file: string, status: Status, reasons: string[]): Row {
  return { file, status, confidence: STATUSES.indexOf(status), vendor: null, date: null, currency: null, subtotal: null, tax: null, adjustments: null, rounding: null, total: null, flagged_fields: [], reasons, readAs: {}, lineItems: null };
}

type Anchor = { value: number; label: string };
const near = (x: number, y: number) => Math.abs(x - y) <= TOLERANCE.sums + 1e-9;
const itemsSum = (r: Receipt) => sum(r.line_items.map((i) => i.amount));
const itemCount = (r: Receipt) => r.line_items.filter((i) => !!i.amount).length;

// Arithmetic settles a disagreement only between two different numbers, never a number against a null,
// and only by a value both readings agree on: numbers made up to fit their own reading's total don't count.
// The winner must match an anchor and the loser none.
function pick<T>(xs: [T, T], value: (x: T) => number | null, anchors: Anchor[]): { winner: T; anchor: Anchor } | null {
  const fits = xs.map((x) => {
    const v = value(x);
    return v === null ? undefined : anchors.find((an) => near(an.value, v)) ?? null;
  });
  if (fits.includes(undefined)) return null;
  const i = fits.findIndex((f) => f);
  if (i < 0 || fits[1 - i]) return null;
  return { winner: xs[i], anchor: fits[i]! };
}

export function score(file: string, rawA: Receipt, rawB: Receipt, today = new Date()): Row {
  if (!rawA.legible || !rawB.legible) return emptyRow(file, "UNREADABLE", ["receipt could not be read"]);
  const keyIllegible: string[] = [...new Set([...illegible(rawA), ...illegible(rawB)])].filter((f) => f === "vendor" || f === "date" || f === "total");
  if (illegible(rawA).filter((f) => keyIllegible.includes(f)).length >= 2 || illegible(rawB).filter((f) => keyIllegible.includes(f)).length >= 2)
    return emptyRow(file, "UNREADABLE", [`${keyIllegible.join(", ")} illegible`]);

  const a = normalize(rawA), b = normalize(rawB);
  const va = validate(a, today), vb = validate(b, today);
  // Levels by the action they ask for. Any doubt flags a field; LOW when a flagged value is left empty
  // or the sums fail (read the image and fill it in), MEDIUM when every value is filled (confirm it).
  const flagged = new Set<string>();
  let sumsFail = false;
  const flag = (f: string) => flagged.add(f);
  const reasons: string[] = [];

  const diffs = compare(a, b);
  const agrees = (f: Field) => diffs.find((d) => d.field === f)!.agree;
  // One reading takes a printed line as the subtotal, the other finds none (e.g. "Total : 46.00" above service
  // charge and GST). Settled when the number is in its quoted line (so it is printed, not total minus tax)
  // and fits the sums of values both agree on. Still a disagreement: MEDIUM, not HIGH.
  const sub = diffs.find((d) => d.field === "subtotal")!;
  const noSub = a.subtotal === null ? a : b.subtotal === null ? b : null;
  let settledSubtotal: { value: number; ev: string } | null = null;
  if (!sub.agree && noSub && !illegible(noSub).includes("subtotal") && (["total", "tax", "adjustments", "rounding"] as Field[]).every(agrees) && a.total !== null) {
    const x = (a.subtotal ?? b.subtotal)!;
    const ev = quote(noSub === a ? b : a, "subtotal");
    const net = sum([a.total, -sum(a.adjustments.map((j) => j.amount)), -(a.rounding ?? 0)]);
    const tax = sum(a.taxes.map((t) => t.amount));
    const fits = Math.abs(x + tax - net) <= TOLERANCE.sums + 1e-9; // before tax: subtotal + tax + adjustments + rounding = total
    if (ev && inQuote(x, ev) && fits) {
      settledSubtotal = { value: x, ev };
      sub.agree = true; // the values below use it as agreed; the flag and reason are added with the other disagreements
    }
  }
  const agreedSubtotal = agrees("subtotal") ? a.subtotal ?? b.subtotal : null;
  let unreadableItems = Math.max(...[a, b].map((r) => r.line_items.filter((i) => i.illegible).length));

  // Settle total, then line items, by values both readings agree on.
  const extras = agrees("adjustments") && agrees("rounding") ? sum([...a.adjustments.map((x) => x.amount), a.rounding]) : null;
  const tax = agrees("tax") ? sum(a.taxes.map((t) => t.amount)) : null;
  const plus = (base: number, label: string): Anchor[] =>
    extras === null ? [] : [{ value: sum([base, extras]), label }, ...(tax ? [{ value: sum([base, extras, tax]), label: `${label} + tax` }] : [])];
  const itemsKnown = agrees("items") && !unreadableItems && itemCount(a) > 0;
  let total = agrees("total") ? a.total : null;
  const settledTotal = agrees("total")
    ? null
    : pick([a, b], (r) => r.total, [...(itemsKnown ? plus(itemsSum(a), "line items") : []), ...(agreedSubtotal !== null ? plus(agreedSubtotal, "subtotal") : [])]);
  if (settledTotal) total = settledTotal.winner.total;

  let lineItems = itemsKnown ? a.line_items : null;
  // Items add up to the total before bill-level adjustments and rounding, with or without tax.
  // When the readings dispute the adjustments, the total itself is the only agreed anchor.
  const net = total === null ? null : sum([total, -(extras ?? 0)]);
  const netLabel = extras ? "total less adjustments and rounding" : "total";
  const itemAnchors: Anchor[] = [
    ...(agreedSubtotal !== null ? [{ value: agreedSubtotal, label: "subtotal" }] : []),
    ...(net !== null ? [{ value: net, label: netLabel }] : []),
    ...(net !== null && tax ? [{ value: sum([net, -tax]), label: `${netLabel} - tax` }] : []),
  ];
  // Amounts marked unreadable can't hide a value when the readable ones, read the same by both, already reach
  // an agreed value (e.g. set items with no printed price marked illegible). Their amounts stay empty.
  const explained = unreadableItems && agrees("items") && itemCount(a) ? itemAnchors.find((an) => near(an.value, itemsSum(a))) : undefined;
  if (explained) {
    flag("items");
    reasons.push(`check line items: ${unreadableItems} line${unreadableItems > 1 ? "s" : ""} marked unreadable, but the read amounts already add up to ${explained.label} ${fmt(explained.value)}`);
    unreadableItems = 0;
    lineItems = a.line_items;
  }
  const settledItems =
    agrees("items") || unreadableItems ? null : pick([a, b], (r) => (itemCount(r) ? itemsSum(r) : null), itemAnchors);
  // The winner may not have more amounts than the loser: it never fills a line the other reading left empty.
  if (settledItems && itemCount(settledItems.winner) <= itemCount(settledItems.winner === a ? b : a)) lineItems = settledItems.winner.line_items;
  const itemsSettled = !agrees("items") && lineItems !== null;

  const readAs: Row["readAs"] = {};
  const both = (f: Field, x: Value, y: Value) => {
    // A summed 0 with no printed line means "nothing found".
    const show = (v: Value, r: Receipt) => (SUMMED.includes(f) && v === 0 && !quote(r, f) ? "none" : fmt(v));
    readAs[f] = [show(x, a), show(y, b)].sort((m, n) => m.localeCompare(n, undefined, { numeric: true })) as [string, string];
  };
  for (const d of diffs) {
    if (d.agree || d.field === "currency") continue;
    both(d.field, d.a, d.b);
    const settled = d.field === "total" ? settledTotal : d.field === "items" && itemsSettled ? settledItems : null;
    if (settled) {
      const used = d.field === "total" ? settled.winner.total : itemsSum(settled.winner);
      const [x, y] = [d.a, d.b].map((v) => fmt(v ?? 0)).sort((m, n) => m.localeCompare(n, undefined, { numeric: true }));
      reasons.push(`check ${LABEL[d.field] ?? d.field}: ${d.field === "items" ? "totals " : ""}read as ${x} or ${y}, used ${fmt(used)} (matches ${settled.anchor.label} ${fmt(settled.anchor.value)})`);
      flag(d.field);
      continue;
    }
    flag(d.field);
    // Unreadable amounts get their own reason; a sum over the rest would read like a second problem.
    if (d.field === "items" && unreadableItems) continue;
    reasons.push(describe(d.field, d.a, quote(a, d.field), d.b, quote(b, d.field)));
  }
  if (settledSubtotal) {
    flag("subtotal");
    readAs.subtotal = ["none", fmt(settledSubtotal.value)];
    reasons.push(`check subtotal: read as ${fmt(settledSubtotal.value)} or none, used ${fmt(settledSubtotal.value)} ("${settledSubtotal.ev}" fits the total)`);
  }
  // Currency is inferred when no symbol is printed: one reading leaving it empty is not a disagreement.
  const inferredOnly = !va.currencyPrinted && !vb.currencyPrinted && (va.currency === null || vb.currency === null);
  const currency = va.currency === vb.currency || inferredOnly ? va.currency ?? vb.currency : null;
  if (va.currency !== vb.currency && !inferredOnly) {
    const [x, y] = [va.currency, vb.currency].map((c) => c ?? "none").sort();
    reasons.push(`check currency: read as ${x} or ${y}`);
    readAs.currency = [x, y];
    flag("currency");
  }

  // A number must appear in the line it was quoted from; otherwise it may be made up.
  const quoteReasons = new Set<string>();
  for (const f of QUOTED)
    for (const r of [a, b]) {
      const v = r[f], ev = quote(r, f);
      if (v === null) continue;
      if (!ev) quoteReasons.add(`check ${f}: ${fmt(v)} has no printed line`);
      else if (!inQuote(v, ev)) quoteReasons.add(`check ${f}: quoted line "${ev}" doesn't show ${fmt(v)}`);
      else continue;
      flag(f);
    }
  reasons.push(...[...quoteReasons].sort());

  // Checks on agreed (or settled) values.
  const resolved: Receipt = { ...a, subtotal: agreedSubtotal ?? a.subtotal, total, line_items: lineItems ?? a.line_items };
  const vr = validate(resolved, today);
  const moneyKnown = (["subtotal", "tax", "adjustments", "rounding"] as Field[]).every(agrees) && (agrees("total") || !!settledTotal);
  if (moneyKnown && vr.totalCheck === "fail") {
    flag("total");
    sumsFail = true;
    const adj = sum(a.adjustments.map((x) => x.amount)), rnd = a.rounding ?? 0, t = sum(a.taxes.map((x) => x.amount));
    reasons.push(`check sums: subtotal ${fmt(resolved.subtotal)} + tax ${fmt(t)} + adjustments ${fmt(adj)} + rounding ${fmt(rnd)} = ${fmt(sum([resolved.subtotal, t, adj, rnd]))}, total ${fmt(total)}`);
  }
  if (agrees("total") && a.total === null) flag("total");
  if (agrees("date") && va.dateOk === false) {
    flag("date");
    sumsFail = true;
  }

  if (unreadableItems) {
    flag("items");
    reasons.push(`check line items: ${unreadableItems} amount${unreadableItems > 1 ? "s" : ""} could not be read`);
  }
  // Items are checked against the total only when the total is known.
  if (lineItems && !itemsSettled && total !== null && vr.itemsCheck === "fail") {
    flag("items");
    sumsFail = true;
    reasons.push(`check line items: sum ${fmt(itemsSum(resolved))} matches neither subtotal ${fmt(vr.subtotal)} nor total ${fmt(total)}`);
  }

  for (const f of [...new Set([...illegible(a), ...illegible(b)])].sort()) {
    flag(f);
    reasons.push(`${f} illegible`);
  }
  for (const r of va.reasons) if (vb.reasons.includes(r) && !reasons.includes(r)) reasons.push(r);

  const subtotal = agreedSubtotal; // as printed, never computed
  const out = {
    // The registration number next to the name identifies the vendor; it is not part of the name.
    vendor: agrees("vendor") && a.vendor !== null ? a.vendor.replace(/\s*\([^)]*\d[^)]*\)\s*$/, "") : null,
    date: agrees("date") ? a.date : null,
    currency,
    subtotal,
    tax: agrees("tax") && (a.taxes.length || b.taxes.length) ? sum(a.taxes.map((t) => t.amount)) : null,
    adjustments: agrees("adjustments") ? sum(a.adjustments.map((x) => x.amount)) || null : null,
    rounding: agrees("rounding") ? a.rounding : null,
    total,
  };
  const context = ["adjustments", "rounding"]; // shown so the sums visibly add up; doubt there only asks to confirm
  const empty = (f: string) =>
    f === "items" ? lineItems === null : f === "taxes" ? out.tax === null : !context.includes(f) && f in out && out[f as keyof typeof out] === null;
  const status: Status = sumsFail || [...flagged].some(empty) ? "LOW" : flagged.size ? "MEDIUM" : "HIGH";
  return {
    file,
    status,
    confidence: STATUSES.indexOf(status),
    ...out,
    flagged_fields: [...flagged],
    reasons,
    readAs,
    lineItems,
  };
}

// A failed reading never drops a receipt, but with one reading nothing is agreed, so nothing is filled.
export function scoreReadings(file: string, a: Receipt | Error, b: Receipt | Error, today = new Date()): Row {
  if (a instanceof Error || b instanceof Error) return emptyRow(file, "LOW", ["could not be read automatically, check all fields"]);
  return score(file, a, b, today);
}
