// Builds labels/review.html: each label row next to its receipt image.
import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "../src/labels";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
const [header, ...rows] = parseCsv(readFileSync("labels/labels.csv", "utf8"));
const col = (r: string[], name: string) => r[header.indexOf(name)] ?? "";

const cards = rows
  .map((r) => {
    const src = `../images/${col(r, "file")}`;
    return `<section>
  <a href="${esc(src)}" target="_blank"><img src="${esc(src)}" loading="lazy"></a>
  <dl>
    <dt>file</dt><dd><a href="${esc(src)}" target="_blank">${esc(col(r, "file"))}</a> <small>${esc(col(r, "set"))}</small></dd>
    <dt>vendor</dt><dd>${esc(col(r, "vendor"))}</dd>
    <dt>date</dt><dd>${esc(col(r, "date"))}</dd>
    <dt>total</dt><dd>${esc(col(r, "total"))}</dd>
    <dt>notes</dt><dd>${esc(col(r, "notes"))}</dd>
  </dl>
</section>`;
  })
  .join("\n");

writeFileSync(
  "labels/review.html",
  `<!doctype html><meta charset="utf-8"><title>Label review</title>
<style>
body{font:14px system-ui;margin:16px;background:#fff;color:#111}
section{display:flex;gap:16px;border-bottom:1px solid #ddd;padding:12px 0}
img{width:260px;max-height:420px;object-fit:contain;object-position:top;border:1px solid #ccc}
dl{display:grid;grid-template-columns:70px 1fr;gap:4px 8px;margin:0}
dt{color:#666}dd{margin:0}
</style>
<h1>Label review (${rows.length})</h1>
${cards}
`,
);
console.log(`wrote labels/review.html (${rows.length} rows)`);
