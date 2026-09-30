// Pipeline: images/ → dedupe → extract ×2 → compare + validate → score → out/*.csv
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS, TIER } from "./config";
import { toCsv } from "./csv";
import { findDuplicates } from "./dedupe";
import { extract, type Extraction } from "./extract";
import { pool } from "./pool";
import { emptyRow, scoreReadings, STATUSES, type Row } from "./score";

const IMAGES = "images";
const { primary, second } = MODELS[TIER];

const files = readdirSync(IMAGES).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
const dupes = findDuplicates(files.map((file) => ({ file, bytes: readFileSync(join(IMAGES, file)) })));
const unique = files.filter((f) => !dupes.has(f));

const reading = (r: PromiseSettledResult<Extraction>) =>
  r.status === "fulfilled" ? r.value.output : new Error(String(r.reason?.message ?? r.reason).slice(0, 200));

const jobs = unique.flatMap((file) => [primary, second].map((model) => ({ file, model })));
const settled = await pool(jobs, 8, (j) => extract(j.model, join(IMAGES, j.file)));

const rows: Row[] = [];
const items: Record<string, string | number | boolean | null>[] = [];
unique.forEach((file, i) => {
  const [a, b] = [settled[2 * i], settled[2 * i + 1]];
  const row = scoreReadings(file, reading(a), reading(b));
  rows.push(row);
  const src = row.itemsSource === "A" ? a : row.itemsSource === "B" ? b : null;
  if (src?.status === "fulfilled" && row.status !== "UNREADABLE")
    for (const it of src.value.output.line_items) items.push({ file, ...it });
});
for (const [file, of] of dupes) rows.push(emptyRow(file, "DUPLICATE", [`duplicate of ${of}`]));
rows.sort((x, y) => x.confidence - y.confidence || x.file.localeCompare(y.file));

mkdirSync("out", { recursive: true });
const COLUMNS = ["file", "status", "confidence", "vendor", "date", "currency", "subtotal", "tax", "total", "flagged_fields", "reasons"];
writeFileSync("out/receipts.csv", toCsv(COLUMNS, rows));
writeFileSync("out/line_items.csv", toCsv(["file", "description", "qty", "unit_price", "amount", "illegible"], items));

const cost = settled.reduce((t, r) => t + (r.status === "fulfilled" ? (r.value.usage.cost ?? 0) : 0), 0);
const counts = STATUSES.map((s) => `${s} ${rows.filter((r) => r.status === s).length}`);
console.log(`${rows.length} receipts (${counts.join(", ")}), ${items.length} line items, $${cost.toFixed(3)} (incl. cached)`);
console.log("wrote out/receipts.csv, out/line_items.csv");
