import type { Receipt } from "./schema";
import { inQuote } from "./compare";

// One canonical form per reading, so two readings that mean the same thing compare equal.
// A subtotal is the before-tax amount as printed. Safety nets for readings that still take another line:
// - a subtotal quoted from the same printed line as the total is the total, not a subtotal
// - a subtotal not in its own quoted line was computed, not printed
// - a subtotal that already includes tax (with adjustments and rounding it reaches the total, tax > 0) is not before tax
// - a printed 0.00 rounding or adjustment changes nothing, same as none printed
export function normalize(r: Receipt): Receipt {
  const drop = new Set<string>();
  let { subtotal, rounding } = r;
  const line = (f: string) => r.evidence.find((e) => e.field === f)?.text.trim().toLowerCase();
  const sum = (xs: (number | null)[]) => Math.round(xs.reduce<number>((t, x) => t + (x ?? 0), 0) * 100) / 100;
  const tax = sum(r.taxes.map((t) => t.amount));
  const inclTax = subtotal !== null && r.total !== null && tax > 0 && Math.abs(sum([subtotal, ...r.adjustments.map((a) => a.amount), r.rounding]) - r.total) <= 0.01 + 1e-9;
  const quoted = r.evidence.find((e) => e.field === "subtotal")?.text;
  const computed = subtotal !== null && (!quoted || !inQuote(subtotal, quoted));
  if (subtotal !== null && ((line("subtotal") !== undefined && line("subtotal") === line("total")) || inclTax || computed)) {
    subtotal = null;
    drop.add("subtotal");
  }
  if (rounding === 0) {
    rounding = null;
    drop.add("rounding");
  }
  const adjustments = r.adjustments.filter((a) => a.amount !== 0);
  if (!adjustments.length) drop.add("adjustments");
  return { ...r, subtotal, rounding, adjustments, evidence: r.evidence.filter((e) => !drop.has(e.field)) };
}
