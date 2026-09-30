# Labels

15 receipts labelled from the image only, before any model run: 10 random (seed 4) + 5 worst-looking.

Rules:
- vendor: the name printed next to the company number; if none, the top name
- date: ISO yyyy-mm-dd; printed dates read as dd/mm/yy(yy)
- total: the final amount printed
- notes: only what is visible on the receipt

Review: `pnpm labels:review`, then open `labels/review.html` (click an image to open it full size).
