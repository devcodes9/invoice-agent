// Usage: pnpm extract [--model <id>] <image>...   (default model: current tier's first reader)
import { extract } from "../src/extract";
import { MODELS, TIER } from "../src/config";

const args = process.argv.slice(2);
const i = args.indexOf("--model");
const model = i >= 0 ? args.splice(i, 2)[1] : MODELS[TIER][0];

const results = await Promise.allSettled(args.map((f) => extract(model, f)));
results.forEach((r, n) => {
  if (r.status === "rejected") return console.log(`FAIL ${args[n]}: ${r.reason?.message?.slice(0, 300)}`);
  const { file, output: o, usage, ms } = r.value;
  console.log(`${file} ${ms}ms $${usage.cost ?? "?"}`);
  console.log(`  vendor=${o.vendor} date=${o.date} sub=${o.subtotal} tax=${o.taxes.map((t) => t.amount).join("+")} adj=${o.adjustments.map((a) => a.amount).join("+")} rnd=${o.rounding} total=${o.total} items=${o.line_items.length} legible=${o.legible} missing=${JSON.stringify(o.missing)}`);
});
