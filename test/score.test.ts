import { test } from "node:test";
import assert from "node:assert/strict";
import { score, scoreReadings } from "../src/score";
import { item, receipt, withEvidence } from "./fixtures";
import type { Receipt } from "../src/schema";

const today = new Date("2026-09-30T00:00:00Z");
const noModelNames = (reasons: string[]) => assert.ok(!reasons.some((r) => /\b(model|A=|B=|haiku|gemini|flash)\b/i.test(r)), reasons.join(" | "));

test("agreeing clean readings are HIGH, all values filled, no reasons", () => {
  const row = score("f.jpg", receipt(), receipt(), today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.confidence, 3);
  assert.deepEqual(row.reasons, []);
  assert.deepEqual([row.vendor, row.date, row.currency, row.subtotal, row.tax, row.total], ["PERNIAGAAN ZHENG HUI", "2018-02-09", "MYR", 411.5, 24.69, 436.2]);
  assert.equal(row.lineItems?.length, 2);
});

test("reader order does not matter", () => {
  const a = receipt({ total: 437.2 }), b = receipt();
  assert.deepEqual(score("f.jpg", a, b, today), score("f.jpg", b, a, today));
});

test("misread: same printed line, different number → LOW, total empty, both readings in the reason", () => {
  // No subtotal and no items: nothing both readings agree on can settle it.
  const a = withEvidence(receipt({ subtotal: null, line_items: [] }), { subtotal: null });
  const row = score("f.jpg", a, withEvidence({ ...a, total: 486.2 }, { total: "Total (RM) : 486.20" }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.total, null);
  assert.deepEqual(row.flagged_fields, ["total"]);
  assert.ok(row.reasons.includes('check total: read as 436.20 or 486.20 ("Total (RM) : 436.20")'));
  noModelNames(row.reasons);
});

test("one reading takes a line that includes tax as the subtotal: dropped, the other's before-tax subtotal settles it, MEDIUM", () => {
  const b = withEvidence(receipt({ subtotal: 436.19 }), { subtotal: "Total Sales (Inclusive of GST) : 436.19" });
  const row = score("f.jpg", receipt(), b, today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.subtotal, 411.5);
});

test("different line: two before-tax subtotals from different printed lines → LOW, subtotal empty", () => {
  const b = withEvidence(receipt({ subtotal: 410.5, total: 435.2 }), { subtotal: "Amount (RM) : 410.50", total: "Total (RM) : 435.20" });
  const a = withEvidence(receipt({ total: 435.2 }), { total: "Total (RM) : 435.20" });
  const row = score("f.jpg", a, b, today);
  assert.equal(row.subtotal, null);
  assert.ok(row.reasons.includes('check subtotal: 410.50 ("Amount (RM) : 410.50") or 411.50 ("(Excluded GST) Sub Total (RM) : 411.50"), different printed lines'), row.reasons.join(" | "));
});

test("one-sided subtotal printed in its quoted line and fitting the agreed sums: filled, MEDIUM (X51005337877: \"Total : 46.00\")", () => {
  const b = withEvidence(receipt({ subtotal: null }), { subtotal: null });
  for (const [x, y] of [[receipt(), b], [b, receipt()]]) {
    const row = score("f.jpg", x, y, today);
    assert.equal(row.status, "MEDIUM");
    assert.equal(row.subtotal, 411.5);
    assert.deepEqual(row.flagged_fields, ["subtotal"]);
    assert.ok(row.reasons.includes('check subtotal: read as 411.50 or none, used 411.50 ("(Excluded GST) Sub Total (RM) : 411.50" fits the total)'), row.reasons.join(" | "));
  }
});

test("a subtotal not in its own quoted line was computed, not printed: dropped, never filled", () => {
  const a = withEvidence(receipt(), { subtotal: "Sub Total (RM) :" });
  const b = withEvidence(receipt({ subtotal: null }), { subtotal: null });
  const row = score("f.jpg", a, b, today);
  assert.equal(row.subtotal, null);
  assert.ok(!row.flagged_fields.includes("subtotal"));
});

test("one-sided subtotal that doesn't fit is LOW, empty, and asks whether that printed line is the subtotal", () => {
  const a = withEvidence(receipt({ subtotal: 400 }), { subtotal: "Total : 400.00" });
  const b = withEvidence(receipt({ subtotal: null }), { subtotal: null });
  const row = score("f.jpg", a, b, today);
  assert.equal(row.status, "LOW");
  assert.equal(row.subtotal, null);
  assert.ok(row.reasons.includes('check subtotal: is "Total : 400.00" the subtotal? (400.00)'), row.reasons.join(" | "));
});

test("a value missing from its own quoted line is flagged as possibly made up", () => {
  const r = withEvidence(receipt(), { total: "Total (RM) :" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes('check total: quoted line "Total (RM) :" doesn\'t show 436.20'));
});

test("a value with no quoted line at all is flagged", () => {
  const r = withEvidence(receipt(), { total: null });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes("check total: 436.20 has no printed line"));
});

test('a number printed without its leading zero still matches: "RM .02" shows 0.02 (X51005268408)', () => {
  const r = withEvidence(receipt({ rounding: 0.02, total: 436.21 }), { rounding: "Rounding Adjustment RM .02", total: "Total (RM) : 436.21" });
  assert.equal(score("f.jpg", r, r, today).status, "HIGH");
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

test("vendor disagreement is LOW, vendor empty", () => {
  const row = score("f.jpg", receipt({ vendor: "TED HENG" }), withEvidence(receipt({ vendor: "TEO HENG" }), { vendor: "TEO HENG" }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.vendor, null);
  assert.deepEqual(row.flagged_fields, ["vendor"]);
});

test("vendor differing only in case, punctuation or a bracketed number is agreement", () => {
  assert.equal(score("f.jpg", receipt({ vendor: "BENS SDN. BHD (913144-A)" }), receipt({ vendor: "Bens Sdn Bhd" }), today).status, "HIGH");
});

test("currency disagreement is LOW, currency empty", () => {
  const row = score("f.jpg", receipt({ currency: "SGD", currency_symbol_seen: "$" }), receipt({ currency: "MYR", currency_symbol_seen: "$" }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.currency, null);
  assert.ok(row.reasons.includes("check currency: read as MYR or SGD"));
});

test("adjustment disagreement is MEDIUM (credit note: one reading has the -0.20 discount)", () => {
  const a = withEvidence(receipt({ adjustments: [{ label: "Item Discount", amount: -0.2 }] }), { adjustments: "Item Discount : RM 0.20" });
  const row = score("f.jpg", a, receipt(), today);
  assert.equal(row.status, "MEDIUM");
  assert.deepEqual(row.flagged_fields, ["adjustments"]);
  assert.ok(row.reasons.includes('check adjustments: is "Item Discount : RM 0.20" an adjustment? (-0.20)'));
});

test("no adjustments vs a printed 0.00 is not a disagreement", () => {
  const row = score("f.jpg", receipt({ adjustments: [{ label: "Discount", amount: 0 }] }), receipt(), today);
  assert.equal(row.status, "HIGH");
});

test("no rounding line vs a printed 0.00 is not a disagreement", () => {
  const r = withEvidence(receipt({ rounding: 0, total: 436.19 }), { rounding: "Rounding : 0.00", total: "Total (RM) : 436.19" });
  assert.equal(score("f.jpg", r, withEvidence({ ...r, rounding: null }, { rounding: null }), today).status, "HIGH");
});

test("line-item totals disagreeing, neither matching an agreed value, is LOW; items not written", () => {
  const row = score("f.jpg", receipt({ line_items: [item(411.5), item(2)] }), receipt({ line_items: [item(411.5), item(1)] }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.lineItems, null);
  assert.ok(row.reasons.includes("check line items: totals read as 412.50 or 413.50"));
});

test("an item amount that could not be read is LOW; items not written (X51005447844: cut off)", () => {
  const row = score("f.jpg", receipt(), receipt({ line_items: [item(400), item(null, true)] }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.lineItems, null);
  assert.ok(row.reasons.includes("check line items: 1 amount could not be read"));
});

test("agreeing readings whose sums fail are LOW", () => {
  const r = withEvidence(receipt({ total: 440 }), { total: "Total (RM) : 440.00" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "LOW");
  assert.ok(row.reasons.includes("check sums: subtotal 411.50 + tax 24.69 + adjustments 0.00 + rounding 0.01 = 436.20, total 440.00"));
});

test("agreeing items that match neither subtotal nor total are LOW (sums fail)", () => {
  const r = receipt({ line_items: [item(5)] });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "LOW");
  assert.ok(row.reasons.includes("check line items: sum 5.00 matches neither subtotal 411.50 nor total 436.20"));
});

test("agreed subtotal not printed stays empty, never computed, not flagged", () => {
  const r = withEvidence(receipt({ subtotal: null, rounding: null, total: 436.19, missing: [{ field: "subtotal", reason: "absent" }] }), { subtotal: null, rounding: null, total: "Total (RM) : 436.19" });
  const row = score("f.jpg", r, r, today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.subtotal, null);
  assert.deepEqual(row.reasons, []);
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
  assert.equal(row.lineItems, null);
  assert.deepEqual(row.reasons, ["could not be read automatically, check all fields"]);
});

test("no reason ever names a model or a reading", () => {
  const a = receipt({ vendor: "X", date: "2016-01-01", total: 1, currency: "SGD", currency_symbol_seen: "$", line_items: [item(null, true)] });
  noModelNames(score("f.jpg", a, receipt(), today).reasons);
});

test("same item total but different line amounts is LOW with a line-level reason", () => {
  const row = score("f.jpg", receipt(), receipt({ line_items: [item(300), item(111.5)] }), today);
  assert.equal(row.status, "LOW");
  assert.equal(row.lineItems, null);
  assert.ok(row.reasons.includes("check line items: same total 411.50, but line amounts differ"));
});

// Normalization: readings that mean the same thing compare equal.

const inclusive = (over: Partial<Receipt> = {}) =>
  withEvidence(receipt({ subtotal: 8.2, taxes: [{ label: "GST", rate: 6, amount: 0.46 }], rounding: null, total: 8.2, line_items: [item(7.1), item(1.1)], ...over }), {
    subtotal: "Total Amount: $8.20",
    total: "Nett Total: $8.20",
    rounding: null,
  });

test("a \"subtotal\" that includes tax (both readings took \"Total Amount\") is not before tax: empty, HIGH (X51005230621)", () => {
  const row = score("f.jpg", inclusive(), inclusive(), today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.subtotal, null);
});

test("one reading takes \"Total Amount\" (includes tax) as the subtotal, the other finds none: agreement, HIGH (X51005442334)", () => {
  const b = withEvidence(inclusive({ subtotal: null, missing: [{ field: "subtotal", reason: "absent" }] }), { subtotal: null });
  const row = score("f.jpg", inclusive(), b, today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.subtotal, null);
});

test("a rounding of 0 with no printed line is not flagged", () => {
  const r = withEvidence(receipt({ rounding: 0, total: 436.19 }), { rounding: null, total: "Total (RM) : 436.19" });
  assert.equal(score("f.jpg", r, r, today).status, "HIGH");
});

test("no currency symbol printed: one reading inferring MYR and one leaving it empty is not a disagreement", () => {
  const row = score("f.jpg", receipt({ currency: "MYR", currency_symbol_seen: null }), receipt({ currency: null, currency_symbol_seen: null }), today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.currency, "MYR");
});

test("printed symbol: a reading with no currency still disagrees", () => {
  const row = score("f.jpg", receipt(), receipt({ currency: null, currency_symbol_seen: null }), today);
  assert.equal(row.status, "LOW");
});

// Arithmetic settles a disagreement between two numbers, by a value both readings agree on.

const nett = (total: number) =>
  withEvidence(receipt({ subtotal: null, taxes: [{ label: "GST", rate: 6, amount: 0.48 }], rounding: null, total, line_items: [item(5.5), item(3)], missing: [{ field: "subtotal", reason: "absent" }] }), {
    subtotal: null,
    rounding: null,
    total: `Nett Total: $${total.toFixed(2)}`,
  });

test("total misread (6.50 vs 8.50): agreed line items settle it, MEDIUM, no line-item false alarm (X51005442375)", () => {
  const row = score("f.jpg", nett(6.5), nett(8.5), today);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.total, 8.5);
  assert.deepEqual(row.flagged_fields, ["total"]);
  assert.deepEqual(row.readAs, { total: ["6.50", "8.50"] });
  assert.deepEqual(row.reasons.filter((r) => r.startsWith("check")), ["check total: read as 6.50 or 8.50, used 8.50 (matches line items 8.50)"]);
});

test("total disagreement no agreed value can settle stays LOW and empty", () => {
  const a = { ...nett(6.5), line_items: [item(6.5)] }, b = { ...nett(8.5), line_items: [item(8.5)] };
  const row = score("f.jpg", a, b, today);
  assert.equal(row.status, "LOW");
  assert.equal(row.total, null);
});

test("item misread (1.887 vs 2.00): the items matching the agreed subtotal are used, MEDIUM (X51005230621)", () => {
  const base = { subtotal: 7.3, taxes: [], rounding: null, total: 7.3 };
  const e = { subtotal: "Subtotal : 7.30", tax: null, rounding: null, total: "Payment : 7.30" };
  const a = withEvidence(receipt({ ...base, line_items: [item(1.887), item(5.3)] }), e), b = withEvidence(receipt({ ...base, line_items: [item(2), item(5.3)] }), e);
  const row = score("f.jpg", a, b, today);
  assert.equal(row.status, "MEDIUM");
  assert.deepEqual(row.lineItems?.map((i) => i.amount), [2, 5.3]);
  assert.ok(row.reasons.includes("check line items: totals read as 7.19 or 7.30, used 7.30 (matches subtotal 7.30)"));
});

test("a discount counted twice: the reading without the extra line matches the agreed total (X51005442366)", () => {
  const base = { subtotal: null, taxes: [], rounding: null, total: 22.6 };
  const a = receipt({ ...base, line_items: [item(10), item(6.5), item(-0.3), item(4.2), item(1.9)] }), b = receipt({ ...base, line_items: [item(10), item(6.5), item(4.2), item(1.9)] });
  const row = score("f.jpg", a, b, today);
  assert.deepEqual(row.lineItems?.map((i) => i.amount), [10, 6.5, 4.2, 1.9]);
});

test("old bug: invented amounts that add up never win over a reading that left them empty", () => {
  const base = { subtotal: null, taxes: [], rounding: null, total: 30 };
  const invented = receipt({ ...base, line_items: [item(10), item(10), item(10)] });
  const honest = receipt({ ...base, line_items: [item(10), { ...item(null), unit_price: 10 }, { ...item(null), unit_price: 10 }] });
  for (const [a, b] of [[invented, honest], [honest, invented]]) {
    const row = score("f.jpg", a, b, today);
    assert.equal(row.lineItems, null);
    assert.equal(row.status, "LOW");
  }
});

test("a total one reading left empty is never filled by arithmetic", () => {
  const b = withEvidence({ ...nett(8.5), total: null, missing: [{ field: "total", reason: "absent" }] }, { total: null });
  const row = score("f.jpg", nett(8.5), b, today);
  assert.equal(row.total, null);
  assert.equal(row.status, "LOW");
});

// Items add up to the total before rounding and adjustments.

const rounded = (over: Partial<Receipt> = {}) =>
  withEvidence(receipt({ subtotal: null, taxes: [], rounding: -0.02, total: 66.15, line_items: [item(60), item(6.17)], missing: [{ field: "subtotal", reason: "absent" }], ...over }), {
    subtotal: null,
    tax: null,
    rounding: "Rounding : -0.02",
    total: "Total : 66.15",
  });

test("agreed items 66.17 with rounding -0.02 reach the total 66.15: HIGH, not a failed sum (X51005444046)", () => {
  const row = score("f.jpg", rounded(), rounded(), today);
  assert.equal(row.status, "HIGH");
  assert.equal(row.subtotal, null);
});

test("settling items uses the total before rounding", () => {
  const row = score("f.jpg", rounded(), rounded({ line_items: [item(60), item(6.15)] }), today);
  assert.deepEqual(row.lineItems?.map((i) => i.amount), [60, 6.17]);
  assert.ok(row.reasons.includes("check line items: totals read as 66.15 or 66.17, used 66.17 (matches total less adjustments and rounding 66.17)"));
});

// Arithmetic never fills what a reading could not read.

test("a total one reading marked illegible stays empty and LOW, even when the other reading adds up", () => {
  const b = withEvidence({ ...nett(8.5), total: null, missing: [{ field: "total", reason: "illegible" }] }, { total: null });
  for (const [x, y] of [[nett(8.5), b], [b, nett(8.5)]]) {
    const row = score("f.jpg", x, y, today);
    assert.equal(row.total, null);
    assert.equal(row.status, "LOW");
  }
});

test("an illegible item amount is never settled by arithmetic: items empty, LOW", () => {
  const base = { subtotal: null, taxes: [], rounding: null, total: 30 };
  const a = receipt({ ...base, line_items: [item(10), item(20)] }), b = receipt({ ...base, line_items: [item(10), item(null, true)] });
  const row = score("f.jpg", a, b, today);
  assert.equal(row.lineItems, null);
  assert.equal(row.status, "LOW");
});

// Levels by action: LOW = a value to fill in, MEDIUM = every value filled, confirm.

test("a doubt that leaves every value filled is MEDIUM (adjustment only one reading found)", () => {
  const a = withEvidence(receipt({ adjustments: [{ label: "Discount", amount: -0.2 }] }), { adjustments: "Discount : 0.20" });
  const row = score("f.jpg", a, receipt(), today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.total !== null && row.subtotal !== null);
});

test("disputed adjustment (a discount counted twice): items still settle on the agreed total, MEDIUM (X51005442366)", () => {
  const base = { subtotal: null, taxes: [], rounding: null, total: 22.6 };
  const a = withEvidence(receipt({ ...base, adjustments: [{ label: "Discount", amount: -0.3 }], line_items: [item(10), item(6.5), item(-0.3), item(4.2), item(1.9)] }), { adjustments: "Discount 0.30" });
  const b = receipt({ ...base, line_items: [item(10), item(6.5), item(4.2), item(1.9)] });
  const row = score("f.jpg", a, b, today);
  assert.deepEqual(row.lineItems?.map((i) => i.amount), [10, 6.5, 4.2, 1.9]);
  assert.equal(row.status, "MEDIUM");
  assert.equal(row.subtotal, null); // not printed, never computed
});

test("set items with no printed price marked illegible by one reading: readable amounts reach the agreed subtotal, filled, MEDIUM (X51005337867)", () => {
  const base = { subtotal: 25.94, taxes: [], rounding: null, total: 25.94 };
  const set = (illegible: boolean) => [item(13.87), item(null, illegible), item(null, illegible), item(12.07), item(null, illegible)];
  const a = receipt({ ...base, subtotal: 25.94, total: 28.53, adjustments: [{ label: "Srv Chg", amount: 2.59 }], line_items: set(true) });
  const b = { ...a, line_items: set(false) };
  const e = { subtotal: "Subtotal: 25.94", total: "Total: 28.53", adjustments: "10% Srv Chg: 2.59" };
  const row = score("f.jpg", withEvidence(a, e), withEvidence(b, e), today);
  assert.equal(row.status, "MEDIUM");
  assert.ok(row.reasons.includes("check line items: 3 lines marked unreadable, but the read amounts already add up to subtotal 25.94"), row.reasons.join(" | "));
  assert.equal(row.lineItems?.length, 5);
  assert.deepEqual(row.lineItems?.map((i) => i.amount), [13.87, null, null, 12.07, null]);
});

test("unreadable amounts whose readable rest falls short of the agreed total stay LOW (cut off)", () => {
  const base = { subtotal: null, taxes: [], rounding: null, total: 30 };
  const r = receipt({ ...base, line_items: [item(10), item(null, true)] });
  const row = score("f.jpg", r, { ...r, line_items: [item(10), item(null)] }, today);
  assert.equal(row.status, "LOW");
  assert.equal(row.lineItems, null);
});

test("vendor output drops the registration number next to the name", () => {
  const r = receipt({ vendor: "99 SPEED MART S/B (519537-X)" });
  assert.equal(score("f.jpg", r, r, today).vendor, "99 SPEED MART S/B");
});

test("unreadable item amounts give one reason, not also a sum over the rest (X51005447844)", () => {
  const row = score("f.jpg", receipt({ line_items: [item(110), item(null, true)] }), receipt({ line_items: [item(null, true), item(null, true)] }), today);
  assert.deepEqual(row.reasons.filter((r) => r.includes("line items")), ["check line items: 2 amounts could not be read"]);
});

test("a subtotal quoted from the same printed line as the total is the total, not a subtotal (X51005442388)", () => {
  const a = withEvidence(receipt({ subtotal: 21.6, taxes: [], rounding: null, total: 21.6, line_items: [item(21.6)] }), { subtotal: "***TOTAL RM 21.60", tax: null, rounding: null, total: "***TOTAL RM 21.60" });
  const b = withEvidence({ ...a, subtotal: null, missing: [{ field: "subtotal", reason: "absent" }] }, { subtotal: null });
  const row = score("f.jpg", a, b, today);
  assert.equal(row.status, "HIGH");
  assert.ok(!row.flagged_fields.includes("subtotal"));
});

test('a number after a run of dots is read whole: "SR @ A......6.00" shows 6.00 (X51005230648)', () => {
  const r = withEvidence(receipt({ subtotal: 6, taxes: [{ label: "GST", rate: 6, amount: 0.36 }], rounding: -0.01, total: 6.35, line_items: [item(6.36)] }), {
    subtotal: "SR @ A...............................6.00",
    tax: "GST 0.36",
    rounding: "Rounding -0.01",
    total: "Total 6.35",
  });
  assert.equal(score("f.jpg", r, r, today).subtotal, 6);
});
