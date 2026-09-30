import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/validate";
import { item, receipt } from "./fixtures";

const today = new Date("2026-09-30T00:00:00Z");

test("total check: tax added, rounding counted (411.50 + 24.69 + 0.01 = 436.20)", () => {
  assert.equal(validate(receipt(), today).totalCheck, "tax-added");
});

test("total check: tax inclusive (81.00 incl. 1.74 GST)", () => {
  const r = receipt({ subtotal: 81, taxes: [{ label: "GST", rate: 6, amount: 1.74 }], rounding: 0, total: 81, line_items: [] });
  assert.equal(validate(r, today).totalCheck, "tax-inclusive");
});

test("total check: adjustments are added (discount -0.20)", () => {
  const r = receipt({ subtotal: 263.02, taxes: [{ label: "GST", rate: 6, amount: 15.78 }], adjustments: [{ label: "Discount", amount: -0.2 }], rounding: null, total: 278.6, line_items: [] });
  assert.equal(validate(r, today).totalCheck, "tax-added");
});

test("total check: fails when neither form adds up (credit note 278.80)", () => {
  const r = receipt({ subtotal: 263.02, taxes: [{ label: "GST", rate: 6, amount: 15.78 }], adjustments: [{ label: "Discount", amount: -0.2 }], rounding: null, total: 278.8, line_items: [] });
  assert.equal(validate(r, today).totalCheck, "fail");
});

test("total check: 0.02 off fails (169.76 + 0.02 vs 169.80)", () => {
  const r = receipt({ subtotal: 169.76, taxes: [{ label: "GST", rate: 6, amount: 9.61 }], rounding: 0.02, total: 169.8, line_items: [] });
  assert.equal(validate(r, today).totalCheck, "fail");
});

test("total check: skipped when total is null", () => {
  assert.equal(validate(receipt({ total: null }), today).totalCheck, "skipped");
});

test("absent subtotal is computed as total - taxes, and the total check is skipped", () => {
  const r = receipt({ subtotal: null, missing: [{ field: "subtotal", reason: "absent" }], taxes: [{ label: "GST", rate: 6, amount: 0.24 }], rounding: null, total: 4.2, line_items: [] });
  const v = validate(r, today);
  assert.equal(v.subtotal, 3.96);
  assert.equal(v.subtotalComputed, true);
  assert.equal(v.totalCheck, "skipped");
  assert.ok(v.reasons.includes("subtotal computed (not printed)"));
});

test("null subtotal without a missing entry counts as absent", () => {
  const r = receipt({ subtotal: null, taxes: [], rounding: null, total: 8, line_items: [] });
  const v = validate(r, today);
  assert.equal(v.subtotal, 8);
  assert.equal(v.subtotalComputed, true);
});

test("illegible subtotal is not computed; total check skipped", () => {
  const r = receipt({ subtotal: null, missing: [{ field: "subtotal", reason: "illegible" }] });
  const v = validate(r, today);
  assert.equal(v.subtotal, null);
  assert.equal(v.subtotalComputed, false);
  assert.equal(v.totalCheck, "skipped");
});

test("items check: items equal subtotal (tax exclusive)", () => {
  assert.equal(validate(receipt(), today).itemsCheck, "subtotal");
});

test("items check: items equal total (tax inclusive), discounts as negative items", () => {
  const r = receipt({
    subtotal: 30,
    total: 33.8,
    taxes: [],
    rounding: null,
    line_items: [
      { description: "A", qty: 1, unit_price: 35, amount: 35 },
      { description: "disc", qty: null, unit_price: null, amount: -1.2 },
    ],
  });
  assert.equal(validate(r, today).itemsCheck, "total");
});

test("items check: fails when items match neither", () => {
  const r = receipt({ line_items: [{ description: "A", qty: 1, unit_price: 5, amount: 5 }] });
  assert.equal(validate(r, today).itemsCheck, "fail");
});

test("items check: skipped when no item has an amount", () => {
  const r = receipt({ line_items: [{ description: "A", qty: 1, unit_price: null, amount: null }] });
  assert.equal(validate(r, today).itemsCheck, "skipped");
});

test("tax sanity: tax above 30% of subtotal is a reason", () => {
  const r = receipt({ taxes: [{ label: "GST", rate: null, amount: 200 }], total: 611.51 });
  assert.ok(validate(r, today).reasons.some((x) => x.startsWith("check tax: 200.00 is over 30% of subtotal 411.50")));
});

test("tax sanity: negative tax is a reason", () => {
  const r = receipt({ taxes: [{ label: "GST", rate: null, amount: -1 }] });
  assert.ok(validate(r, today).reasons.some((x) => x.startsWith("check tax: -1.00 is negative")));
});

test("date: valid past date is ok", () => {
  assert.equal(validate(receipt(), today).dateOk, true);
});

test("date: impossible calendar date fails", () => {
  const v = validate(receipt({ date: "2018-02-30" }), today);
  assert.equal(v.dateOk, false);
  assert.ok(v.reasons.includes("check date: 2018-02-30 is not a valid date"));
});

test("date: future date fails", () => {
  const v = validate(receipt({ date: "2027-01-01" }), today);
  assert.equal(v.dateOk, false);
  assert.ok(v.reasons.includes("check date: 2027-01-01 is in the future"));
});

test("date: null date is not checked", () => {
  assert.equal(validate(receipt({ date: null }), today).dateOk, null);
});

test("currency: derived from symbol when model left it null", () => {
  const v = validate(receipt({ currency: null, currency_symbol_seen: "RM" }), today);
  assert.equal(v.currency, "MYR");
  assert.deepEqual(v.reasons.filter((x) => x.includes("currency")), []);
});

test("currency: symbol wins over a mismatching model code, with a reason", () => {
  const v = validate(receipt({ currency: "SGD", currency_symbol_seen: "RM" }), today);
  assert.equal(v.currency, "MYR");
  assert.ok(v.reasons.includes("check currency: read as SGD but symbol RM means MYR"));
});

test("currency: no symbol seen keeps model code and notes it was inferred", () => {
  const v = validate(receipt({ currency: "MYR", currency_symbol_seen: null }), today);
  assert.equal(v.currency, "MYR");
  assert.ok(v.reasons.includes("currency inferred"));
});

test("currency: unrecognised symbol (e.g. tax code read as symbol) counts as inferred", () => {
  const v = validate(receipt({ currency: "MYR", currency_symbol_seen: "SR" }), today);
  assert.equal(v.currency, "MYR");
  assert.deepEqual(v.reasons.filter((x) => x.includes("currency")), ["currency inferred"]);
});

test("items check: skipped when an item amount is illegible", () => {
  const r = receipt({ line_items: [{ description: "A", qty: 1, unit_price: 400, amount: 400, illegible: false }, { description: "B", qty: 1, unit_price: 11.5, amount: null, illegible: true }] });
  assert.equal(validate(r, today).itemsCheck, "skipped");
});

test("computed subtotal and the items check take rounding and adjustments out of the total", () => {
  const r = receipt({ subtotal: null, missing: [{ field: "subtotal", reason: "absent" }], taxes: [], adjustments: [{ label: "Discount", amount: -1 }], rounding: -0.02, total: 65.15, line_items: [item(60), item(6.17)] });
  const v = validate(r, new Date("2026-09-30T00:00:00Z"));
  assert.equal(v.subtotal, 66.17);
  assert.equal(v.itemsCheck, "subtotal");
});
