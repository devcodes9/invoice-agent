# Invoice Extraction

Reads receipt images with two models, keeps values they agree on, checks the arithmetic, and flags what a person should review. See `NOTES.md` for how confidence works.

## Setup

Needs Node 20.6+ and pnpm.

```sh
pnpm install
```

## Run

**Replay (no API key):** re-runs the pipeline on the model responses saved in `cache/` and reproduces the committed `out/` exactly.

```sh
pnpm replay
```

**Live:** calls the models via OpenRouter for every receipt (about $0.90) and saves the responses to `cache/`, so a later `pnpm replay` reproduces that run.

```sh
cp .env.example .env   # set OPENROUTER_API_KEY
pnpm start
```

Both write:

- `out/receipts.csv`: one row per receipt, with status, confidence and flagged fields
- `out/line_items.csv`: line items per receipt
- `out/review.html`: open in a browser to review flagged receipts next to their images

To run on other receipts, put `.jpg`/`.png` files in `images/` and use `pnpm start`.

## Other commands

```sh
pnpm eval    # score out/receipts.csv against labels/labels.csv (no API key needed)
pnpm test    # unit tests
```
