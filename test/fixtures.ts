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
      { description: "A", qty: 1, unit_price: 400, amount: 400, illegible: false },
      { description: "B", qty: 1, unit_price: 11.5, amount: 11.5, illegible: false },
    ],
    subtotal: 411.5,
    taxes: [{ label: "GST", rate: 6, amount: 24.69 }],
    adjustments: [],
    rounding: 0.01,
    total: 436.2,
    missing: [],
    evidence: {
      vendor: "PERNIAGAAN ZHENG HUI",
      date: "Date: 09/02/2018",
      subtotal: "(Excluded GST) Sub Total (RM) : 411.50",
      tax: "Total GST (RM) : 24.69",
      adjustments: null,
      rounding: "Rounding (RM) : 0.01",
      total: "Total (RM) : 436.20",
    },
    ...over,
  };
}

// Same receipt with one evidence line replaced.
export function withEvidence(r: Receipt, over: Partial<Receipt["evidence"]>): Receipt {
  return { ...r, evidence: { ...r.evidence, ...over } };
}

export const item = (amount: number | null, illegible = false) => ({ description: "X", qty: 1, unit_price: amount, amount, illegible });
