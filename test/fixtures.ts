import type { Receipt } from "../src/schema";

// A clean, tax-added receipt; tests override only what they exercise.
export function receipt(over: Partial<Receipt> = {}): Receipt {
  return {
    legible: true,
    vendor: "PERNIAGAAN ZHENG HUI",
    date: "2018-02-09",
    currency: "MYR",
    currency_symbol_seen: "RM",
    line_items: [
      { description: "A", qty: 1, unit_price: 400, amount: 400 },
      { description: "B", qty: 1, unit_price: 11.5, amount: 11.5 },
    ],
    subtotal: 411.5,
    taxes: [{ label: "GST", rate: 6, amount: 24.69 }],
    adjustments: [],
    rounding: 0.01,
    total: 436.2,
    missing: [],
    ...over,
  };
}
