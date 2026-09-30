// Eval: out/receipts.csv vs labels/labels.csv, plus token and cost per call from the cache.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS, TIER } from "../src/config";
import { evaluate, type EvalRow } from "../src/eval";
import type { Extraction } from "../src/extract";
import { loadLabels, parseCsv } from "../src/labels";

const [header, ...cells] = parseCsv(readFileSync("out/receipts.csv", "utf8"));
const rows: EvalRow[] = cells.map((c) => {
  const o = Object.fromEntries(header.map((h, i) => [h, c[i] ?? ""]));
  return {
    file: o.file,
    status: o.status,
    vendor: o.vendor || null,
    date: o.date || null,
    total: o.total === "" ? null : Number(o.total),
    flagged_fields: o.flagged_fields ? o.flagged_fields.split("; ") : [],
  };
});
const labels = loadLabels();
const r = evaluate(rows, labels);

console.log(`Labelled receipts: ${r.n} (in-sample: tuning used these)\n`);
console.log("Per field: right / empty (left for review) / wrong (filled but wrong)");
for (const k of ["vendor", "date", "total"] as const) console.log(`  ${k.padEnd(7)} ${r.field[k].right} / ${r.field[k].empty} / ${r.field[k].wrong}`);
console.log("\nRows with a filled-but-wrong key field, per status");
for (const [s, v] of Object.entries(r.byStatus)) console.log(`  ${s.padEnd(10)} ${v.wrong}/${v.n}`);
console.log(`\nFlag recall: ${r.recall.flagged}/${r.recall.wrong} rows with a wrong value are not HIGH${r.recall.missed.length ? `; missed: ${r.recall.missed.join(", ")}` : ""}`);
console.log("\nSignals fired on labelled rows: " + Object.entries(r.signals).map(([k, v]) => `${k} ${v}`).join(", "));
console.log("\nCost per call (all cached calls for the shipped pair)");
for (const model of MODELS[TIER]) {
  const dir = join("cache", model);
  if (!existsSync(dir)) continue;
  const es: Extraction[] = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const avg = (f: (e: Extraction) => number | undefined) => es.reduce((t, e) => t + (f(e) ?? 0), 0) / es.length;
  console.log(`  ${model.padEnd(28)} n=${es.length} in=${avg((e) => e.usage.input).toFixed(0)} out=${avg((e) => e.usage.output).toFixed(0)} tok, $${avg((e) => e.usage.cost).toFixed(4)}, ${(avg((e) => e.ms) / 1000).toFixed(1)}s`);
}
