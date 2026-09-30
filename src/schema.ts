import { z } from "zod";

const money = z.number().nullable();

export const Receipt = z.object({
  legible: z.boolean(),
  vendor: z.string().nullable(),
  date: z.string().nullable().describe("ISO yyyy-mm-dd"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. MYR"),
  currency_symbol_seen: z.string().nullable().describe('Raw currency text printed on the receipt, e.g. "RM"'),
  line_items: z.array(
    z.object({
      description: z.string().nullable(),
      qty: z.number().nullable(),
      unit_price: money,
      amount: money,
      illegible: z.boolean().describe("true if a value of this item is printed but cannot be read, e.g. cut off or faded"),
    }),
  ),
  subtotal: money.describe("Exactly as printed; may include tax"),
  taxes: z.array(z.object({ label: z.string().nullable(), rate: z.number().nullable(), amount: money })),
  adjustments: z
    .array(z.object({ label: z.string().nullable(), amount: money }))
    .describe("Discount, service charge, tip. Not rounding."),
  rounding: money.describe('Printed rounding adjustment, e.g. "Rounding Adj -0.01". Null if not printed.'),
  total: money.describe("Final amount payable, after rounding. Not cash tendered or change."),
  missing: z.array(
    z.object({
      field: z.enum(["vendor", "date", "currency", "subtotal", "taxes", "rounding", "total"]),
      reason: z.enum(["absent", "illegible"]),
    }),
  ),
});

export type Receipt = z.infer<typeof Receipt>;
