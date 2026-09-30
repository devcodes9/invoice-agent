# Notes

A workflow by design: the model reads, code decides trust.

## Confidence

Two readers (Haiku, Flash) read each receipt. A value is filled when they agree, or when arithmetic on values they agree on picks one of two different numbers (never a number over an empty or illegible reading). Levels are by the action they ask for:

- HIGH: readers agree and the sums pass. Nothing to check.
- MEDIUM: every value filled, but a disagreement was settled by arithmetic. Confirm the highlighted value.
- LOW: a value is empty (readers disagree, or illegible) or the sums fail. Read it from the image.

## Limits

- All numbers are in-sample: rules were tuned on the same 45 receipts, eval uses 15 labels from them.
- One format: Malaysian GST receipts. Service charge, several tax rates or other layouts are untested.
- Arithmetic picks were checked by hand on 7 receipts only.
- Next for production: a held-out labelled set, and one targeted re-read for key-field disagreements.

## Tier choice (step 3, 2026-09-30)

15 labelled receipts, in-sample. Correct = vendor (normalized), date (exact), total (±0.01).

| Model | vendor | date | total | all 3 | cost / 15 | avg s |
|---|---|---|---|---|---|---|
| claude-haiku-4.5 | 15 | 14 | 15 | 14 | $0.067 | 8.0 |
| gemini-3.8-flash | 15 | 15 | 15 | 15 | $0.132 | 10.4 |
| claude-sonnet-5.5 | 13 | 15 | 15 | 13 | $0.180 | 5.6 |
| gemini-3.1-pro-preview | 15 | 15 | 15 | 15 | $0.476 | 19.6 |

Both pairs: every primary error showed up as a key-field disagreement, with no false flags on key fields.
Cheap pair costs ~$0.013 per receipt (both models) vs ~$0.044 for strong. **Ship cheap.**

## Failure log

- Haiku put "Total Savings" (a summary line) into adjustments, double-counting item discounts. Fixed in prompt.
- Haiku then put the "Mastercard -140.65" payment line into adjustments. Fixed in prompt: no payment lines.
- Haiku returned the brand name (OLDTOWN WHITE COFFEE) instead of the name next to the company number. Fixed in prompt.
- Haiku marked set items without prices as `illegible`. Fixed: `missing` limited to top-level fields.
- Haiku read the faded subtotal on X51005268408 as 169.78 on one run and 169.76 on the next, at temperature 0.
- Haiku read 2018 as 2016 on X51005442343. Caught by disagreement with Flash.
- Sonnet ignored the vendor rule on 2/15 (used the top name). Caught by disagreement with Gemini Pro.
- Gemini Flash leaves `currency` null when only "RM" is printed; Haiku returns MYR.
- Haiku fills `subtotal` with the total when no subtotal line is printed; Flash returns null as instructed.
- Line-item sums disagree often (unit price read as amount, a missed item, amounts cut off at the image edge).
