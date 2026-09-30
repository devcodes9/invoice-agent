// out/review.html: one card per receipt, image next to what to check. Same rows as the CSV, no extra logic.
import { STATUSES, type Row } from "./score";

export type ItemRow = { file: string; description: string | null; qty: number | null; unit_price: number | null; amount: number | null };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
const money = (v: number | null) => (v === null ? "" : v.toFixed(2));
const cell = (v: string | number | null) => (v === null ? "" : esc(String(v)));

function card(r: Row, items: ItemRow[], images: string): string {
  const src = esc(`${images}/${r.file}`);
  const values: [string, string | null][] = [
    ["vendor", r.vendor],
    ["date", r.date],
    ["currency", r.currency],
    ["subtotal", r.subtotal === null ? null : money(r.subtotal)],
    ["tax", r.tax === null ? null : money(r.tax)],
    ["total", r.total === null ? null : money(r.total)],
  ];
  const dl = r.status === "DUPLICATE" ? "" : `<dl>${values.map(([k, v]) => (v === null ? `<dt>${k}</dt><dd class="check">check</dd>` : `<dt>${k}</dt><dd>${esc(v)}</dd>`)).join("")}</dl>`;
  const reasons = r.reasons.length ? `<ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const table = items.length
    ? `<details><summary>${items.length} line item${items.length > 1 ? "s" : ""}</summary><table>${items
        .map((i) => `<tr><td>${cell(i.description)}</td><td>${cell(i.qty)}</td><td>${money(i.unit_price)}</td><td>${money(i.amount)}</td></tr>`)
        .join("")}</table></details>`
    : "";
  return `<section class="card ${r.status}" data-status="${r.status}">
<a href="${src}" target="_blank"><img src="${src}" loading="lazy" alt=""></a>
<div><h2><span class="badge ${r.status}">${r.status}</span> ${esc(r.file)}</h2>${dl}${reasons}${table}</div>
</section>`;
}

export function renderReview(rows: Row[], items: ItemRow[], images: string): string {
  const buttons = STATUSES.map((s) => `<button data-filter="${s}">${s} ${rows.filter((r) => r.status === s).length}</button>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt review</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--UNREADABLE:#6b21a8;--LOW:#b91c1c;--MEDIUM:#b45309;--HIGH:#15803d;--DUPLICATE:#64748b}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#999;--line:#333;--UNREADABLE:#c084fc;--LOW:#f87171;--MEDIUM:#fbbf24;--HIGH:#4ade80;--DUPLICATE:#94a3b8}}
body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px;background:var(--bg);color:var(--fg)}
nav{position:sticky;top:0;background:var(--bg);padding:8px 0;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
button{font:inherit;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:none;color:inherit;cursor:pointer}
button.on{border-color:var(--fg)}
.card{display:flex;gap:16px;padding:14px 0;border-bottom:1px solid var(--line);border-left:4px solid var(--c);padding-left:12px}
.card img{width:220px;max-height:360px;object-fit:contain;object-position:top;border:1px solid var(--line)}
${STATUSES.map((s) => `.${s}{--c:var(--${s})}`).join("")}
h2{font-size:15px;margin:0 0 8px}
.badge{color:var(--bg);background:var(--c);padding:1px 7px;border-radius:4px;font-size:12px}
dl{display:grid;grid-template-columns:80px 1fr;gap:2px 8px;margin:0 0 8px}dt{color:var(--muted)}dd{margin:0}
dd.check{color:var(--c);font-weight:600}
ul{margin:0 0 8px;padding-left:18px}table{border-collapse:collapse}td{padding:2px 8px 2px 0}
@media (max-width:640px){.card{flex-direction:column}.card img{width:100%}}
</style></head><body>
<h1>Receipt review</h1>
<nav><button data-filter="" class="on">All ${rows.length}</button>${buttons}</nav>
${rows.map((r) => card(r, items.filter((i) => i.file === r.file), images)).join("\n")}
<script>
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".card").forEach((c) => c.hidden = !!b.dataset.filter && c.dataset.status !== b.dataset.filter);
});
</script>
</body></html>
`;
}
