// out/review.html: one card per receipt, image next to what to check. Same rows as the CSV, no extra logic.
import { STATUSES, type Row } from "./score";

export type ItemRow = { file: string; description: string | null; qty: number | null; unit_price: number | null; amount: number | null };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
const money = (v: number | null) => (v === null ? "" : v.toFixed(2));
const cell = (v: string | number | null) => (v === null ? "" : esc(String(v)));

// Notes that apply to many receipts and change nothing: a tag next to the value, not a bullet.
const TAGS: Record<string, [string, string]> = {
  "subtotal computed (not printed)": ["subtotal", "computed"],
  "currency inferred": ["currency", "inferred"],
};
const REVIEW = ["UNREADABLE", "LOW", "MEDIUM"];
const LEGEND = "LOW: a value is missing, read it from the image · MEDIUM: values filled, confirm the highlighted one · HIGH: nothing to check";

// Empty and flagged: check. Empty and not flagged: both readings agree it isn't printed.
function value(r: Row, k: keyof Row["readAs"], v: string | null): string {
  const flagged = r.flagged_fields.includes(k) || (k === "tax" && r.flagged_fields.includes("taxes"));
  const both = r.readAs[k];
  const read = both ? ` <span class="read">(read ${esc(both[0])} / ${esc(both[1])})</span>` : "";
  const tag = Object.entries(TAGS).find(([note, [f]]) => f === k && r.reasons.includes(note));
  const tagged = tag ? ` <span class="tag">${tag[1][1]}</span>` : "";
  if (v === null) return flagged || both ? `<dd class="check">check${read}</dd>` : `<dd class="none" title="not printed">—</dd>`;
  // Settled between two numbers: the dropped reading struck through, so the choice shows at a glance.
  const dropped = both && both.includes(v) && both.every((x) => x !== "none") ? both.find((x) => x !== v) : undefined;
  const shown = dropped ? ` <s class="drop" title="other reading, not used">${esc(dropped)}</s>` : read;
  return `<dd${flagged || both ? ' class="flag"' : ""}>${esc(v)}${shown}${tagged}</dd>`;
}

function card(r: Row, items: ItemRow[], images: string): string {
  const src = esc(`${images}/${r.file}`);
  const values: [keyof Row["readAs"], string | null][] = [
    ["vendor", r.vendor],
    ["date", r.date],
    ["currency", r.currency],
    ["subtotal", r.subtotal === null ? null : money(r.subtotal)],
    ["tax", r.tax === null ? null : money(r.tax)],
    // Only when printed (or disputed), so subtotal + tax + adjustments + rounding visibly reaches the total.
    ...(["adjustments", "rounding"] as const)
      .filter((k) => r[k] !== null || r.flagged_fields.includes(k))
      .map((k): [keyof Row["readAs"], string | null] => [k, r[k] === null ? null : money(r[k])]),
    ["total", r.total === null ? null : money(r.total)],
  ];
  const dl = r.status === "DUPLICATE" ? "" : `<dl>${values.map(([k, v]) => `<dt>${k}</dt>${value(r, k, v)}`).join("")}</dl>`;
  const bullets = r.reasons.filter((x) => !(x in TAGS));
  const reasons = bullets.length ? `<ul>${bullets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
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
.card[hidden]{display:none}
.card{display:flex;gap:16px;padding:14px 0;border-bottom:1px solid var(--line);border-left:4px solid var(--c);padding-left:12px}
.card img{width:220px;max-height:360px;object-fit:contain;object-position:top;border:1px solid var(--line)}
${STATUSES.map((s) => `.${s}{--c:var(--${s})}`).join("")}
h2{font-size:15px;margin:0 0 8px}
.badge{color:var(--bg);background:var(--c);padding:1px 7px;border-radius:4px;font-size:12px}
dl{display:grid;grid-template-columns:96px 1fr;gap:2px 8px;margin:0 0 8px}dt{color:var(--muted)}dd{margin:0}
dd.check,dd.flag{color:var(--c);font-weight:600}dd.none{color:var(--muted)}
.legend{flex-basis:100%;margin:2px 0 0;color:var(--muted);font-size:13px}
.read,.drop{color:var(--muted);font-weight:400}.tag{color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:12px}
ul{margin:0 0 8px;padding-left:18px}table{border-collapse:collapse}td{padding:2px 8px 2px 0}
@media (max-width:640px){.card{flex-direction:column}.card img{width:100%}}
</style></head><body>
<h1>Receipt review</h1>
<nav><button data-filter="${REVIEW.join(" ")}" class="on">Needs review ${rows.filter((r) => REVIEW.includes(r.status)).length}</button><button data-filter="">All ${rows.length}</button>${buttons}
<p class="legend">${LEGEND}</p></nav>
${rows.map((r) => card(r, items.filter((i) => i.file === r.file), images)).join("\n")}
<script>
const show = (b) => {
  const want = b.dataset.filter.split(" ").filter(Boolean);
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
  document.querySelectorAll(".card").forEach((c) => c.hidden = want.length > 0 && !want.includes(c.dataset.status));
};
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => show(b));
show(document.querySelector("nav button.on"));
</script>
</body></html>
`;
}
