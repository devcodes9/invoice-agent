// Tier test: run both model pairs on the labelled receipts and compare accuracy, agreement and cost.
import { MODELS } from "../src/config";
import { extract, type Extraction } from "../src/extract";
import { compare, sameValue } from "../src/compare";
import { loadLabels, type Label } from "../src/labels";
import { pool } from "../src/pool";

const labels = loadLabels();

const models = [...new Set(Object.values(MODELS).flatMap((t) => [t.primary, t.second]))];
const jobs = models.flatMap((model) => labels.map((l) => ({ model, file: `images/${l.file}` })));
const settled = await pool(jobs, 8, (j) => extract(j.model, j.file));

const results = new Map<string, Extraction>();
settled.forEach((r, i) => {
  if (r.status === "fulfilled") results.set(`${jobs[i].model}|${labels[i % labels.length].file}`, r.value);
  else console.log(`FAIL ${jobs[i].model} ${jobs[i].file}: ${String(r.reason?.message ?? r.reason).slice(0, 200)}`);
});
const get = (model: string, l: Label) => results.get(`${model}|${l.file}`);

const correct = (e: Extraction | undefined, l: Label) => ({
  vendor: !!e && sameValue(e.output.vendor, l.vendor),
  date: !!e && e.output.date === l.date,
  total: !!e && sameValue(e.output.total, l.total),
});
const allThree = (c: ReturnType<typeof correct>) => c.vendor && c.date && c.total;

console.log("\nPer model (n=%d)", labels.length);
console.log("model".padEnd(34), "vendor date total all3  cost    avg s");
for (const m of models) {
  const cs = labels.map((l) => correct(get(m, l), l));
  const es = labels.map((l) => get(m, l)).filter((e): e is Extraction => !!e);
  const cost = es.reduce((t, e) => t + (e.usage.cost ?? 0), 0);
  const secs = es.reduce((t, e) => t + e.ms, 0) / es.length / 1000;
  const n = (k: keyof ReturnType<typeof correct>) => String(cs.filter((c) => c[k]).length).padStart(6);
  console.log(m.padEnd(34), n("vendor"), n("date").slice(1), n("total"), String(cs.filter(allThree).length).padStart(4), ("$" + cost.toFixed(3)).padStart(7), secs.toFixed(1).padStart(6));
}

for (const [tier, { primary, second }] of Object.entries(MODELS)) {
  console.log(`\n${tier}: ${primary} + ${second}`);
  let wrongPrimary = 0, caught = 0, falseFlags = 0;
  for (const l of labels) {
    const a = get(primary, l), b = get(second, l);
    if (!a || !b) continue;
    const diffs = compare(a.output, b.output).filter((d) => !d.agree);
    const keyDisagree = diffs.some((d) => d.field === "vendor" || d.field === "date" || d.field === "total");
    const ok = allThree(correct(a, l));
    if (!ok) wrongPrimary++;
    if (!ok && keyDisagree) caught++;
    if (ok && keyDisagree) falseFlags++;
    const mark = ok ? (keyDisagree ? "flag, primary right" : "ok") : keyDisagree ? "WRONG, caught" : "WRONG, MISSED";
    const detail = diffs.map((d) => `${d.field}: A=${d.a} B=${d.b}`).join("; ");
    console.log(`  ${l.file} ${mark.padEnd(20)} ${detail}`);
  }
  console.log(`  primary wrong on ${wrongPrimary}, caught by key-field disagreement ${caught}, false flags ${falseFlags}`);
}
