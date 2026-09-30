import { TOLERANCE } from "./config";
import type { Receipt } from "./schema";

export type Validation = {
  subtotal: number | null; // before tax, as printed; never computed
  totalCheck: "pass" | "fail" | "skipped";
  itemsCheck: "subtotal" | "total" | "fail" | "skipped";
  dateOk: boolean | null;
  currency: string | null; // from the printed symbol when known, else the model's code
  currencyPrinted: boolean; // a known currency symbol or code is printed
  reasons: string[];
};

const SYMBOLS: Record<string, string> = {
  RM: "MYR", MYR: "MYR",
  S$: "SGD", SGD: "SGD",
  US$: "USD", USD: "USD",
  "€": "EUR", EUR: "EUR",
  "£": "GBP", GBP: "GBP",
};

const round2 = (x: number) => Math.round(x * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE.sums + 1e-9;
const sum = (xs: (number | null)[]) => round2(xs.reduce<number>((t, x) => t + (x ?? 0), 0));
const fmt = (x: number) => x.toFixed(2);

export function validate(r: Receipt, today = new Date()): Validation {
  const reasons: string[] = [];
  const tax = sum(r.taxes.map((t) => t.amount));
  const adj = sum(r.adjustments.map((a) => a.amount));
  const rounding = r.rounding ?? 0;
  // The total before bill-level adjustments and rounding: what the items (with or without tax) add up to.
  const net = r.total === null ? null : round2(r.total - adj - rounding);

  // Printed subtotal (before tax) + tax + adjustments + rounding must reach the total. Skipped when no subtotal is printed.
  const subtotal = r.subtotal;
  let totalCheck: Validation["totalCheck"] = "skipped";
  if (r.total !== null && subtotal !== null) totalCheck = near(subtotal + tax + adj + rounding, r.total) ? "pass" : "fail";

  const amounts = r.line_items.map((i) => i.amount).filter((a): a is number => a !== null);
  let itemsCheck: Validation["itemsCheck"] = "skipped";
  if (amounts.length && !r.line_items.some((i) => i.illegible)) {
    const items = sum(amounts);
    // Items match the subtotal, or the total before adjustments and rounding, with or without tax.
    itemsCheck = subtotal !== null && near(items, subtotal) ? "subtotal" : net !== null && (near(items, net) || near(items, net - tax)) ? "total" : "fail";
  }

  // Tax sanity: reasons only. Printed rates are not checked: mixed 6%/0% and service charge make it noise.
  if (tax < 0) reasons.push(`check tax: ${fmt(tax)} is negative`);
  else if (subtotal !== null && subtotal > 0 && tax > 0.3 * subtotal) reasons.push(`check tax: ${fmt(tax)} is over 30% of subtotal ${fmt(subtotal)}`);

  let dateOk: boolean | null = null;
  if (r.date !== null) {
    const d = new Date(`${r.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== r.date) {
      dateOk = false;
      reasons.push(`check date: ${r.date} is not a valid date`);
    } else if (d.getTime() > today.getTime()) {
      dateOk = false;
      reasons.push(`check date: ${r.date} is in the future`);
    } else dateOk = true;
  }

  let currency = r.currency;
  const symbol = r.currency_symbol_seen?.trim().toUpperCase() ?? null;
  const fromSymbol = symbol ? SYMBOLS[symbol] : undefined;
  if (fromSymbol) {
    if (currency && currency.toUpperCase() !== fromSymbol) reasons.push(`check currency: read as ${currency} but symbol ${r.currency_symbol_seen} means ${fromSymbol}`);
    currency = fromSymbol;
  } else if (currency) {
    reasons.push("currency inferred");
  }

  return { subtotal, totalCheck, itemsCheck, dateOk, currency, currencyPrinted: !!fromSymbol, reasons };
}
