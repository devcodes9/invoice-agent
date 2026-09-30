import { TOLERANCE } from "./config";
import type { Receipt } from "./schema";

export const FIELDS = ["vendor", "date", "currency", "subtotal", "tax", "adjustments", "rounding", "total", "items"] as const;
export type Field = (typeof FIELDS)[number];
export type Value = string | number | null;
export type FieldDiff = { field: Field; a: Value; b: Value; agree: boolean };

// Lowercase, bracketed parts (registration numbers) dropped, punctuation stripped, spaces collapsed:
// "99 Speed Mart S/B (519537-X)" == "99 SPEED MART S/B".
export const normText = (s: string | null) =>
  s === null ? null : s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const sum = (xs: (number | null)[]) =>
  xs.length ? Math.round(xs.reduce<number>((t, x) => t + (x ?? 0), 0) * 100) / 100 : null;

// The comparable view of one extraction. Line items are compared by net sum only.
export function fieldValues(r: Receipt): Record<Field, Value> {
  return {
    vendor: r.vendor,
    date: r.date,
    currency: r.currency,
    subtotal: r.subtotal,
    tax: sum(r.taxes.map((t) => t.amount)),
    adjustments: sum(r.adjustments.map((a) => a.amount)),
    rounding: r.rounding,
    total: r.total,
    items: sum(r.line_items.map((i) => i.amount)),
  };
}

export function sameValue(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= TOLERANCE.match + 1e-9;
  return normText(String(a)) === normText(String(b));
}

export function compare(a: Receipt, b: Receipt): FieldDiff[] {
  const va = fieldValues(a), vb = fieldValues(b);
  return FIELDS.map((field) => ({ field, a: va[field], b: vb[field], agree: sameValue(va[field], vb[field]) }));
}
