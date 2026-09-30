import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { Receipt } from "./schema";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export const PROMPT = `Extract the data printed on this receipt.

Rules:
- Copy values exactly as printed. Never guess, never compute a value that is not printed.
- If a field is printed but you cannot read it, return null and add it to "missing" with reason "illegible".
- If a field is not printed, return null and add it to "missing" with reason "absent".
- "missing" covers only the top-level fields listed in its schema, not line items.
- vendor: the business name printed on the same line as, or directly above, the company registration number (e.g. "(123456-X)", "Co. No."). This may be a legal name like "... Sdn Bhd" rather than the brand name at the top. If no registration number is printed, the name at the top.
- date: the transaction date as yyyy-mm-dd. Printed dates are day-first (dd/mm/yy or dd/mm/yyyy).
- line_items: one entry per product. A discount printed under an item is its own entry with a negative amount. An item with no printed price (e.g. part of a set) gets null unit_price and amount. If an item's amount is printed but cut off or unreadable, set amount null and illegible true; never fill it from qty × unit price.
- subtotal: the amount before tax, as printed. For example a "Subtotal", "Sub Total", "Total Sales (Excluding GST)" or "Total Excl. Tax" line, or the total row of the GST/tax summary (its amount column, not its tax column). Copy it as printed. Null if no before-tax amount is printed; never compute it. Never use a line that includes tax (e.g. "Total Amount" when prices include GST, "Total Sales (Inclusive of GST)", "Total Amt Incl. GST"), the final total, or a quantity line. A tax summary with a single row: use that row's amount. Several rows (one per rate) and no total row: null, never add rows up.
- taxes: each tax amount printed (e.g. GST, SST). Include it even if the receipt says it is already included in the total.
- adjustments: bill-level discounts (negative), service charge, tip. Not rounding. Not discounts already listed as line items. Not summary lines such as "Total Savings". Not payment lines (cash, card, change).
- rounding: the printed rounding adjustment, signed. Null if not printed.
- total: the final amount payable, after rounding. Not cash tendered, not change.
- evidence: one entry per field that has a value (vendor, date, subtotal, tax, adjustments, rounding, total): the printed line it came from, exactly as printed, including its label and number (e.g. "Total (RM) : 436.20"). For tax and adjustments, join several lines with " | ". A field with no printed line gets no entry, and its value must be null.
- legible: false only if the receipt as a whole cannot be read.`;

// Replay ignores saved responses from an older prompt.
const PROMPT_HASH = createHash("sha256").update(PROMPT).update(JSON.stringify(z.toJSONSchema(Receipt))).digest("hex").slice(0, 12);

export type Extraction = {
  model: string;
  prompt: string;
  file: string;
  output: Receipt;
  usage: { input: number | undefined; output: number | undefined; cost: number | undefined };
  ms: number;
};

const mediaType = (file: string) => (extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg");

export function cachePath(model: string, file: string) {
  return join("cache", model, `${basename(file)}.json`);
}

// Live by default: always calls the model and saves the response to cache/.
// replay: read from cache/ only, never call the model.
export async function extract(model: string, file: string, { replay = false } = {}): Promise<Extraction> {
  const path = cachePath(model, file);
  if (replay) {
    const cached: Extraction | undefined = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    if (cached?.prompt !== PROMPT_HASH) throw new Error(`no cached response for the current prompt: ${path}`);
    return cached;
  }

  const t0 = Date.now();
  const res = await generateText({
    model: openrouter(model, { usage: { include: true }, provider: { require_parameters: true } }),
    temperature: 0,
    output: Output.object({ schema: Receipt, name: "receipt" }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "file", data: readFileSync(file), mediaType: mediaType(file) },
        ],
      },
    ],
  });

  const result: Extraction = {
    model,
    prompt: PROMPT_HASH,
    file: basename(file),
    output: res.output,
    usage: {
      input: res.usage.inputTokens,
      output: res.usage.outputTokens,
      cost: (res.providerMetadata?.openrouter as any)?.usage?.cost,
    },
    ms: Date.now() - t0,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2));
  return result;
}
