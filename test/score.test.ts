import { test } from "node:test";
import assert from "node:assert/strict";
import { score, scoreReadings } from "../src/score";
import { item, receipt, withEvidence } from "./fixtures";

const today = new Date("2026-09-30T00:00:00Z");
const noModelNames = (reasons: string[]) => assert.ok(!reasons.some((r) => /\b(model|A=|B=|haiku|gemini|flash)\b/i.test(r)), reasons.join(" | "));

test("agreeing clean readings are HIGH, all values filled, no reasons", () => {
  const row = score("f.jpg", receipt(), receipt(), today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.confidence, 3);
  assert.deepEqual(row.reasons, []);
  assert.deepEqual([row.vendor, row.date, row.currency, row.subtotal, row.tax, row.total], ["PERNIAGAAN ZHENG HUI", "2018-02-09", "MYR", 411.5, 24.69, 436.2]);
  assert.equal(row.itemsAgreed, true);
});

test("reader order does not matter", () => {
  const a = receipt({ total: 437.2 }), b = receipt();
  assert.deepEqual(score("f.jpg", a, b, today), score("f.jpg", b, a, today));
});

test("misread: same printed line, different number → LOW, total empty, both readings in the reason", () => {
  const row = score("f.jpg", receipt(), withEvidence(receipt({ total: 486.2 }), { total: "Total (RM) : 486.20" }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.total, null);
  assert.deepEqual(row.flagged_fields, ["total"]);
  assert.ok(row.reasons.includes('check total: read as 436.20 or 486.20 ("Total (RM) : 436.20")'));
  noModelNames(row.reasons);
});

test("different line: each reading quotes a different printed line → MEDIUM, subtotal empty", () => {
  const b = withEvidence(receipt({ subtotal: 436.19 }), { subtotal: "Total Sales (Inclusive of GST) : 436.19" });
  const row = score("f.jpg", receipt(), b, today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.subtotal, null);
  assert.ok(row.reasons.includes('check subtotal: 411.50 ("(Excluded GST) Sub Total (RM) : 411.50") or 436.19 ("Total Sales (Inclusive of GST) : 436.19"), different printed lines'));
});

test("one-sided: one reading has a value the other didn't find → MEDIUM, empty, says it may not be printed", () => {
  const b = withEvidence(receipt({ subtotal: null }), { subtotal: null });
  const row = score("f.jpg", receipt(), b, today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.subtotal, null);
  assert.deepEqual(row.flagged_fields, ["subtotal"]);
  assert.ok(row.reasons.includes('check subtotal: 411.50 may not be printed ("(Excluded GST) Sub Total (RM) : 411.50")'));
});

test("a value missing from its own quoted line is flagged as possibly made up", () => {
  const r = withEvidence(receipt(), { total: "Total (RM) :" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes('check total: 436.20 not found in printed line "Total (RM) :"'));
});

test("a value with no quoted line at all is flagged", () => {
  const r = withEvidence(receipt(), { subtotal: null });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes("check subtotal: 411.50 has no printed line"));
});

test("quoted line with thousands separator or negative sign still matches", () => {
  const r = withEvidence(receipt({ subtotal: 1411.5, total: 1436.2, line_items: [item(1411.5)] }), { subtotal: "Sub Total : 1,411.50", total: "TOTAL RM1,436.20" });
  assert.equal(score("f.jpg", r, r, today).status, "HIGH");
});

test("date disagreement is LOW, date empty", () => {
  const row = score("f.jpg", receipt({ date: "2016-03-13" }), receipt({ date: "2018-03-13" }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.date, null);
  assert.ok(row.reasons.includes('check date: read as 2016-03-13 or 2018-03-13 ("Date: 09/02/2018")'));
});

test("vendor disagreement is MEDIUM, vendor empty", () => {
  const row = score("f.jpg", receipt({ vendor: "TED HENG" }), withEvidence(receipt({ vendor: "TEO HENG" }), { vendor: "TEO HENG" }), today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.vendor, null);
  assert.deepEqual(row.flagged_fields, ["vendor"]);
});

test("vendor differing only in case, punctuation or a bracketed number is agreement", () => {
  assert.equal(score("f.jpg", receipt({ vendor: "BENS SDN. BHD (913144-A)" }), receipt({ vendor: "Bens Sdn Bhd" }), today).status, "HIGH");
});

test("currency disagreement is MEDIUM, currency empty", () => {
  const row = score("f.jpg", receipt({ currency: "SGD", currency_symbol_seen: "$" }), receipt({ currency: "MYR", currency_symbol_seen: "$" }), today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.currency, null);
  assert.ok(row.reasons.includes("check currency: read as MYR or SGD"));
});

test("adjustment disagreement is MEDIUM (credit note: one reading has the -0.20 discount)", () => {
  const a = withEvidence(receipt({ adjustments: [{ label: "Item Discount", amount: -0.2 }] }), { adjustments: "Item Discount : RM 0.20" });
  const row = score("f.jpg", a, receipt(), today);
  assert.equal(row.status, "MEDIUM");
  assert.deepEqual(row.flagged_fields, ["adjustments"]);
  assert.ok(row.reasons.includes('check adjustments: -0.20 may not be printed ("Item Discount : RM 0.20")'));
});

test("no adjustments vs a printed 0.00 is not a disagreement", () => {
  const row = score("f.jpg", receipt({ adjustments: [{ label: "Discount", amount: 0 }] }), receipt(), today);
  assert.equal(row.status, "HIGH");
});

test("no rounding line vs a printed 0.00 is not a disagreement", () => {
  const r = withEvidence(receipt({ rounding: 0, total: 436.19 }), { rounding: "Rounding : 0.00", total: "Total (RM) : 436.19" });
  assert.equal(score("f.jpg", r, withEvidence({ ...r, rounding: null }, { rounding: null }), today).status, "HIGH");
});

test("line-item totals disagreeing is MEDIUM; items not written", () => {
  const row = score("f.jpg", receipt(), receipt({ line_items: [item(411.5), item(1)] }), today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.itemsAgreed, false);
  assert.ok(row.reasons.includes("check line items: totals read as 411.50 or 412.50"));
});

test("an item amount that could not be read is MEDIUM; items not written (X51005447844: cut off)", () => {
  const row = score("f.jpg", receipt(), receipt({ line_items: [item(400), item(null, true)] }), today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.itemsAgreed, false);
  assert.ok(row.reasons.includes("check line items: 1 amount could not be read"));
});

test("agreeing readings whose sums fail are LOW", () => {
  const r = withEvidence(receipt({ total: 440 }), { total: "Total (RM) : 440.00" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "LOW");
  assert.ok(row.reasons.includes("check sums: subtotal 411.50 + tax 24.69 + adjustments 0.00 + rounding 0.01 = 436.20, total 440.00"));
});

test("agreeing items that match neither subtotal nor total are MEDIUM", () => {
  const r = receipt({ line_items: [item(5)] });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes("check line items: sum 5.00 matches neither subtotal 411.50 nor total 436.20"));
});

test("agreed subtotal not printed is computed and filled", () => {
  const r = withEvidence(receipt({ subtotal: null, rounding: null, total: 436.19, missing: [{ field: "subtotal", reason: "absent" }] }), { subtotal: null, rounding: null, total: "Total (RM) : 436.19" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.subtotal, 411.5);
  assert.ok(row.reasons.includes("subtotal computed (not printed)"));
});

test("null total is LOW", () => {
  const r = withEvidence(receipt({ total: null, missing: [{ field: "total", reason: "absent" }] }), { total: null });
  assert.equal(score("f.jpg", r, r, today).status, "LOW");
});

test("invalid agreed date is LOW", () => {
  const r = receipt({ date: "2018-02-30" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "LOW");
  assert.ok(row.reasons.includes("check date: 2018-02-30 is not a valid date"));
});

test("illegible key field is LOW; illegible non-key field is MEDIUM", () => {
  const d = withEvidence(receipt({ date: null, missing: [{ field: "date", reason: "illegible" }] }), { date: null });
  const r = withEvidence(receipt({ rounding: null, total: 436.19, missing: [{ field: "rounding", reason: "illegible" }] }), { rounding: null, total: "Total (RM) : 436.19" });
  assert.equal(score("f.jpg", d, d, today).status, "LOW");
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes("rounding illegible"));
});

test("not legible is UNREADABLE with empty values and a neutral reason", () => {
  const row = score("f.jpg", receipt(), receipt({ legible: false }), today);
  assert.equal(row.status, "UNREADABLE");
  assert.equal(row.total, null);
  assert.deepEqual(row.reasons, ["receipt could not be read"]);
});

test("two of vendor/date/total illegible is UNREADABLE", () => {
  const a = receipt({ vendor: null, date: null, missing: [{ field: "vendor", reason: "illegible" }, { field: "date", reason: "illegible" }] });
  const row = score("f.jpg", a, receipt(), today);
  assert.equal(row.status, "UNREADABLE");
  assert.deepEqual(row.reasons, ["vendor, date illegible"]);
});

test("a failed reading leaves every value empty, LOW, neutral reason", () => {
  const row = scoreReadings("f.jpg", receipt(), new Error("timeout"), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.total, null);
  assert.equal(row.itemsAgreed, false);
  assert.deepEqual(row.reasons, ["could not be read automatically, check all fields"]);
});

test("no reason ever names a model or a reading", () => {
  const a = receipt({ vendor: "X", date: "2016-01-01", total: 1, currency: "SGD", currency_symbol_seen: "$", line_items: [item(null, true)] });
  noModelNames(score("f.jpg", a, receipt(), today).reasons);
});

test("same item total but different line amounts is MEDIUM with a line-level reason", () => {
  const row = score("f.jpg", receipt(), receipt({ line_items: [item(300), item(111.5)] }), today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.itemsAgreed, false);
  assert.ok(row.reasons.includes("check line items: same total 411.50, but line amounts differ"));
});
