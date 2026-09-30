// Step 0: confirm each model accepts an image and returns schema-valid structured output via OpenRouter.
import { readFileSync } from "node:fs";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { MODELS } from "../src/config";
import { Receipt } from "../src/schema";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const image = readFileSync(process.argv[2] ?? "images/X51005200931.jpg");
const ids = [...new Set(Object.values(MODELS).flatMap((t) => [t.primary, t.second]))];

for (const id of ids) {
  const t0 = Date.now();
  try {
    const res = await generateText({
      model: openrouter(id, { usage: { include: true }, provider: { require_parameters: true } }),
      temperature: 0,
      output: Output.object({ schema: Receipt, name: "receipt" }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract this receipt. If you cannot read a value, return null and mark it illegible. If it is not printed, return null and mark it absent. Never guess." },
            { type: "file", data: image, mediaType: "image/jpeg" },
          ],
        },
      ],
    });
    const o = res.output;
    const cost = (res.providerMetadata?.openrouter as any)?.usage?.cost;
    console.log(`OK   ${id} ${Date.now() - t0}ms in=${res.usage.inputTokens} out=${res.usage.outputTokens} cost=$${cost ?? "?"}`);
    console.log(`     vendor=${o.vendor} date=${o.date} cur=${o.currency}/${o.currency_symbol_seen} sub=${o.subtotal} rounding=${o.rounding} total=${o.total} items=${o.line_items.length} taxes=${JSON.stringify(o.taxes)} adj=${JSON.stringify(o.adjustments)} missing=${JSON.stringify(o.missing)}`);
  } catch (e: any) {
    console.log(`FAIL ${id} ${Date.now() - t0}ms ${e.name}: ${e.message?.slice(0, 400)}`);
  }
}
