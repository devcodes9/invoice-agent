import { test } from "node:test";
import assert from "node:assert/strict";
import { score, scoreReadings } from "../src/score";
import { receipt } from "./fixtures";

const today = new Date("2026-09-30T00:00:00Z");

test("agreeing clean readings are HIGH with no reasons", () => {
  const row = score("f.jpg", receipt(), receipt(), today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.confidence, 3);
  assert.deepEqual(row.reasons, []);
  assert.equal(row.total, 436.2);
  assert.equal(row.tax, 24.69);
  assert.equal(row.currency, "MYR");
});

test("total disagreement is LOW; the reading whose sums add up is used", () => {
  const row = score("f.jpg", receipt(), receipt({ total: 437.2 }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.total, 436.2);
  assert.deepEqual(row.flagged_fields, ["total"]);
  assert.ok(row.reasons.includes("check total: A=436.20 B=437.20, used A (sums match)"));
});

test("when only B's sums add up, B's numbers are used", () => {
  const row = score("f.jpg", receipt({ total: 437.2 }), receipt(), today);
  assert.equal(row.total, 436.2);
  assert.ok(row.reasons.includes("check total: A=437.20 B=436.20, used B (sums match)"));
});

test("when neither reading adds up, the primary is used", () => {
  const row = score("f.jpg", receipt({ total: 437.2 }), receipt({ total: 438.2 }), today);
  assert.equal(row.total, 437.2);
  assert.ok(row.reasons.includes("check total: A=437.20 B=438.20, used A"));
});

test("date disagreement is LOW", () => {
  const row = score("f.jpg", receipt({ date: "2016-03-13" }), receipt({ date: "2018-03-13" }), today);
  assert.equal(row.status, "LOW");
  assert.deepEqual(row.flagged_fields, ["date"]);
  assert.ok(row.reasons.includes("check date: A=2016-03-13 B=2018-03-13, used A"));
});

test("vendor disagreement is MEDIUM", () => {
  const row = score("f.jpg", receipt({ vendor: "PETRON BKT LANJAN SB" }), receipt({ vendor: "ALSERKAM ENTERPRISE" }), today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.vendor, "PETRON BKT LANJAN SB");
  assert.deepEqual(row.flagged_fields, ["vendor"]);
  assert.ok(row.reasons.includes("check vendor: A=PETRON BKT LANJAN SB B=ALSERKAM ENTERPRISE, used A"));
});

test("vendor differing only in case and punctuation is not a disagreement", () => {
  assert.equal(score("f.jpg", receipt({ vendor: "BENS SDN. BHD" }), receipt({ vendor: "Bens Sdn Bhd" }), today).status, "HIGH");
});

test("line-item disagreement settled by arithmetic is a reason, not a downgrade", () => {
  const b = receipt({ line_items: [{ description: "A", qty: 1, unit_price: 411.5, amount: 411.5 }, { description: "B", qty: 1, unit_price: 1, amount: 1 }] });
  const row = score("f.jpg", receipt(), b, today);
  assert.equal(row.status, "HIGH");
  assert.ok(row.reasons.includes("check line items: A=411.50 B=412.50, used A (items add up)"));
});

test("line-item disagreement where neither reading adds up is MEDIUM", () => {
  const a = receipt({ line_items: [{ description: "A", qty: 1, unit_price: 5, amount: 5 }] });
  const b = receipt({ line_items: [{ description: "A", qty: 1, unit_price: 6, amount: 6 }] });
  const row = score("f.jpg", a, b, today);
  assert.equal(row.status, "MEDIUM");
  assert.deepEqual(row.flagged_fields, ["items"]);
});

test("a subtotal-only disagreement is a reason but does not downgrade", () => {
  const row = score("f.jpg", receipt(), receipt({ subtotal: null }), today);
  assert.equal(row.status, "HIGH");
  assert.ok(row.reasons.includes("check subtotal: A=411.50 B=none, used A (sums match)"));
});

test("agreeing readings whose sums fail are LOW", () => {
  const r = receipt({ total: 440 });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "LOW");
  assert.deepEqual(row.flagged_fields, ["total"]);
  assert.ok(row.reasons.includes("check sums: subtotal 411.50 + tax 24.69 + adjustments 0.00 + rounding 0.01 = 436.20, total 440.00"));
});

test("items matching neither subtotal nor total is MEDIUM", () => {
  const r = receipt({ line_items: [{ description: "A", qty: 1, unit_price: 5, amount: 5 }] });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes("check line items: sum 5.00 matches neither subtotal 411.50 nor total 436.20"));
});

test("null total is LOW", () => {
  const r = receipt({ total: null, missing: [{ field: "total", reason: "absent" }] });
  assert.equal(score("f.jpg", r, r, today).status, "LOW");
});

test("invalid date is LOW", () => {
  const r = receipt({ date: "2018-02-30" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "LOW");
  assert.ok(row.reasons.includes("check date: 2018-02-30 is not a valid date"));
});

test("illegible key field (date) is LOW", () => {
  const r = receipt({ date: null, missing: [{ field: "date", reason: "illegible" }] });
  assert.equal(score("f.jpg", r, r, today).status, "LOW");
});

test("illegible non-key field is MEDIUM", () => {
  const r = receipt({ rounding: null, missing: [{ field: "rounding", reason: "illegible" }] });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes("rounding illegible"));
});

test("absent fields do not downgrade", () => {
  const r = receipt({ subtotal: null, taxes: [], rounding: null, total: 411.5, missing: [{ field: "subtotal", reason: "absent" }, { field: "taxes", reason: "absent" }] });
  assert.equal(score("f.jpg", r, r, today).status, "HIGH");
});

test("either model saying not legible is UNREADABLE with empty values", () => {
  const row = score("f.jpg", receipt(), receipt({ legible: false }), today);
  assert.equal(row.status, "UNREADABLE");
  assert.equal(row.confidence, 0);
  assert.equal(row.total, null);
  assert.equal(row.vendor, null);
  assert.ok(row.reasons.includes("model B: not legible"));
});

test("two of vendor/date/total illegible in one model is UNREADABLE", () => {
  const a = receipt({ vendor: null, date: null, missing: [{ field: "vendor", reason: "illegible" }, { field: "date", reason: "illegible" }] });
  assert.equal(score("f.jpg", a, receipt(), today).status, "UNREADABLE");
});

test("one model failing still gives values from the other, marked LOW", () => {
  const row = scoreReadings("f.jpg", receipt(), new Error("timeout"), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.total, 436.2);
  assert.ok(row.reasons.includes("model B failed: timeout"));
});

test("both models failing is LOW with empty values", () => {
  const row = scoreReadings("f.jpg", new Error("x"), new Error("y"), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.total, null);
  assert.deepEqual(row.reasons, ["model A failed: x", "model B failed: y"]);
});

test("line items come from the reading whose items add up, even if the other supplies the numbers", () => {
  const a = receipt({ line_items: [{ description: "A", qty: 1, unit_price: 5, amount: 5 }] });
  const row = score("f.jpg", a, receipt(), today);
  assert.equal(row.source, "A");
  assert.equal(row.itemsSource, "B");
  assert.equal(row.status, "HIGH");
  assert.ok(row.reasons.includes("check line items: A=5.00 B=411.50, used B (items add up)"));
  assert.ok(!row.reasons.some((r) => r.includes("matches neither")));
});

test("adjustment disagreement is a reason (credit note: one model dropped the -0.20 discount)", () => {
  const a = receipt({ adjustments: [{ label: "Item Discount", amount: -0.2 }] });
  const row = score("f.jpg", a, receipt(), today);
  assert.ok(row.reasons.includes("check adjustments: A=-0.20 B=none, used B (sums match)"));
});
