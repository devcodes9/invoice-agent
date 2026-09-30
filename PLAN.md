# Plan: Receipt Extraction Agent with Validation

Goal: an agent that knows when it might be wrong and says so. Perfect extraction is not the goal.

## Approach

A fixed pipeline, not an agent loop. The LLM reads the image; code decides how far to trust it. (Called an agent per the brief; NOTES.md: "a workflow by design: the model reads, code decides trust.")

```
image → dedupe → extract ×2 (two vision models) → compare → validate → score + gate → CSV
```

## Stack

- TypeScript, Vercel AI SDK `generateObject`, Zod schema
- OpenRouter via `@openrouter/ai-sdk-provider` (one key, switch models by string)
- Models (in config): primary = Claude, second reader = Gemini (different vendor, so errors are more independent)
- Tier picked by test: run cheap pair (Haiku + Flash) and strong pair on the 15 labeled receipts; ship cheap if its all-3 row accuracy is within ~1 receipt of strong. Result goes in NOTES.md.
- Step 0: check both models support structured output + images on OpenRouter

## Schema (Zod, every field nullable)

```
legible: boolean
vendor: string | null
date: string | null            // ISO yyyy-mm-dd
currency: string | null        // ISO code, e.g. MYR
currency_symbol_seen: string | null  // raw text on receipt, e.g. "RM"
line_items: { description, qty, unit_price, amount }[]
subtotal: number | null
taxes: { label, rate | null, amount }[]
adjustments: { label, amount }[]   // rounding, discount, service charge, tip
total: number | null
missing: { field, reason: "absent" | "illegible" }[]
```

Prompt rule: "If you cannot read a value, return null and mark it illegible. If it is not printed, return null and mark it absent. Never guess."

## Steps

1. **Dedupe:** hash each image; the second copy of an exact duplicate gets status `DUPLICATE` (reason `duplicate of <file>`). Known pair: X51005268275 = X51005301666.
2. **Extract ×2:** same prompt and schema, temperature 0. Cache results in `cache/<model>/<file>.json`.
3. **Compare per field:** numbers equal within 0.01; strings normalized (lowercase, punctuation and extra spaces stripped); line items compared by net sum only (discounts are negative items). On disagreement, the CSV gets the value that passes the arithmetic checks, else the primary's.
4. **Validate** (tolerance ±0.05). Subtotal is copied exactly as printed (may include tax).
   - Subtotal not printed (`absent`): compute `total − Σtaxes`, label "subtotal computed (not printed)", no status downgrade, skip the (circular) sum check below
   - pass if `subtotal + Σtaxes + Σadjustments = total` (tax added) OR `subtotal + Σadjustments = total` (tax-inclusive); record which matched
   - `Σ line_items.amount = subtotal` (tax-exclusive) OR `= total` (tax-inclusive); record which matched
   - tax sanity (reason only, no downgrade): 0 ≤ tax ≤ 30% of subtotal; printed-rate mismatch noted (mixed 6%/0% items are common)
   - date parses and is not in the future
   - currency matches `currency_symbol_seen` (e.g. RM → MYR); no symbol seen → "currency inferred" in reasons
5. **Score** (rules, not a weighted number):
   - **UNREADABLE:** either model says `legible: false`, or either marks 2+ of {vendor, date, total} `illegible`. Values left empty.
   - **LOW:** a key field (total, date) disagrees, subtotal/total check fails both forms, or total is null
   - **MEDIUM:** vendor or line items disagree, items match neither subtotal nor total, a non-key field `illegible`
   - **HIGH:** none of the above (`absent` fields do not downgrade)
   - **DUPLICATE:** see step 1
6. **Output:**
   - `out/receipts.csv`: file, status, confidence (UNREADABLE=0, LOW=1, MEDIUM=2, HIGH=3, DUPLICATE=4, so sorting works), vendor, date, currency, subtotal, tax, total, flagged_fields, reasons. Reasons say what to check, with both models' values, e.g. `check total: A=48.70 B=47.70, used A (sums match)`. Sorted by confidence ascending.
   - `out/line_items.csv`: file, description, qty, unit_price, amount
7. **Eval:** before any model run, pick ~10 random + 3-5 worst-looking receipts and label them from the image only in `labels/labels.csv` (vendor, date, total). Report per-field accuracy (total within 0.01, date exact, vendor normalized) and all-3 row accuracy per status level, flag recall, and false-flag rate per signal. The one tuning pass uses the same 15, so numbers are in-sample. Log tokens and cost per call.

## Project layout

```
src/config.ts     models, tolerances
src/schema.ts     Zod schema
src/extract.ts    generateObject + cache + usage logging
src/compare.ts    field-by-field agreement
src/validate.ts   arithmetic and sanity rules
src/score.ts      status, flagged_fields, reasons
src/csv.ts        output files
src/eval.ts       accuracy per status vs labels, cost
src/index.ts      run pipeline over images/
```

## Build order (about 2h)

| # | Step | Time |
|---|---|---|
| 0 | OpenRouter + generateObject on 1 image, both models | 10m |
| 1 | Label 15 blind (before seeing outputs) | 15m |
| 2 | Schema + prompt, run on 5 images | 15m |
| 3 | Second model + compare; cheap vs strong pair on the 15 | 20m |
| 4 | Validation rules | 20m |
| 5 | Score + gate + CSVs | 20m |
| 6 | Run eval, adjust once | 10m |
| 7 | README, NOTES.md, prompts.md | 15m |

Keep a running log of real failures during the build; pick the Loom "tried that didn't work" from it.

## Later / with more time

- OCR mean word confidence as a deterministic gate signal (only if bad images slip past disagreement)
- `is_receipt` guard for non-receipt input
- Targeted re-ask on key-field disagreement
- Small review UI
- Multi-page and PDF input

## Known limits (for NOTES.md)

- Two models can make up the same value; agreement is not proof
- Consistent made-up numbers pass the sum checks
- `legible: true` carries no information; only `false` is trusted
- Day/month swaps (e.g. 02/01) pass all checks if both models flip them the same way
- Vendor legal vs trade name (e.g. company line vs shop name) shows as a MEDIUM disagreement
- Computed subtotals can't be checked against the total; only items-vs-total validates them
- Rules tested on 45 SROIE-style receipts (Malaysian, MYR, GST); other formats are untested
