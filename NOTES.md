# Notes

## Approach

A fixed workflow, not an agent loop. The models only read the receipt; code checks and scores the result.

- Two vision models from different vendors (Claude Haiku 4.5, Gemini Flash) read each receipt. For each value they return the printed line it came from. If they can't read a value, they return null.
- A value goes to the CSV only if both models agree. Otherwise the cell is empty and flagged.
- If they read different numbers, code uses the one that makes the receipt add up (total 6.50 vs 8.50, items sum to 8.50). If one model returned null, nothing is chosen.

Confidence, by action needed:

- HIGH: models agree and sums add up. Nothing to check.
- MEDIUM: code chose a value by the sums. Confirm it.
- LOW: a cell is empty or sums fail. Read it from the image.
- UNREADABLE: the receipt can't be read. No values.

## For production

- Privacy: run local open-source vision models, or use zero-retention providers and mask card/phone numbers before sending. (PII)
- Guardrails: reject non-receipts/offensive/explicit images; escape CSV cells starting with = + - @.
- Independent check: OCR on quoted evidence lines, since two LLMs can invent the same value.
- Reliability: rate limiting, retries with backoff, a cost cap per run.
- Evals: set up evals with tracking of time, tokens and cost per receipt, to tune the prompt and models on output quality, speed and cost together.

## Tradeoffs (2-hour budget)

- Two LLM readers instead of adding OCR: much less setup, but both can invent the same value.
- Hosted models (via OpenRouter) instead of local open-source ones: quick setup and proven vision models, but receipt images leave the machine.
- Fixed workflow instead of an agent that picks its own tools and loops: predictable, testable and cheap, but it can't try another route (crop, zoom, re-read) on a hard receipt.
- Didn't explore an evaluator-optimizer loop (re-read a disputed field with the error as feedback): disputed fields go to a human instead of being settled automatically.
- Confidence is simple rule-based levels; I wanted better handling there, e.g. per-field confidence, or a third reader to break ties.
