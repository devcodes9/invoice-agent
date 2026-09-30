import type { Receipt } from "./schema";

// One canonical form per reading, so two readings that mean the same thing compare equal:
// - a "subtotal" equal to the total is the total printed twice ("Total Amount" above "Nett Total"), not a subtotal
// - a printed 0.00 rounding or adjustment changes nothing, same as none printed
export function normalize(r: Receipt): Receipt {
  const drop = new Set<string>();
  let { subtotal, rounding } = r;
  if (subtotal !== null && r.total !== null && Math.round(subtotal * 100) === Math.round(r.total * 100)) {
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
