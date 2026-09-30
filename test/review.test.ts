import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReview } from "../src/review";
import { emptyRow, type Row } from "../src/score";

const row = (over: Partial<Row>): Row => ({ ...emptyRow("a.jpg", "HIGH", []), vendor: "ACME", date: "2018-01-02", currency: "MYR", subtotal: 10, tax: 0.6, total: 10.6, ...over });

test("one card per row, image linked, status as a filterable badge", () => {
  const html = renderReview([row({})], [], "../images");
  assert.match(html, /<section class="card HIGH" data-status="HIGH">/);
  assert.match(html, /<a href="\.\.\/images\/a\.jpg" target="_blank"><img src="\.\.\/images\/a\.jpg"/);
  assert.match(html, /<span class="badge HIGH">HIGH<\/span>/);
});

test("empty flagged values say check with both readings; reasons listed; text is escaped", () => {
  const html = renderReview([row({ status: "LOW", total: null, flagged_fields: ["total"], readAs: { total: ["1.00", "2.00"] }, reasons: ['check total: read as 1.00 or 2.00 ("<b>TOTAL</b>")'] })], [], "../images");
  assert.match(html, /<dt>total<\/dt><dd class="check">check <span class="read">\(read 1\.00 \/ 2\.00\)<\/span><\/dd>/);
  assert.match(html, /<li>check total: read as 1\.00 or 2\.00 \(&quot;&lt;b&gt;TOTAL&lt;\/b&gt;&quot;\)<\/li>/);
});

test("agreed line items are shown in a collapsed section", () => {
  const html = renderReview([row({ lineItems: [] })], [{ file: "a.jpg", description: "Tea", qty: 2, unit_price: 1.5, amount: 3 }], "../images");
  assert.match(html, /<details><summary>1 line item<\/summary>/);
  assert.match(html, /<td>Tea<\/td><td>2<\/td><td>1\.50<\/td><td>3\.00<\/td>/);
});

test("status counts appear on the filter buttons", () => {
  const html = renderReview([row({}), row({ file: "b.jpg", status: "LOW" })], [], "../images");
  assert.match(html, /<button data-filter="LOW">LOW 1<\/button>/);
  assert.match(html, /<button data-filter="HIGH">HIGH 1<\/button>/);
});

test("filtered-out cards are really hidden (the card's display:flex would otherwise override [hidden])", () => {
  assert.match(renderReview([row({})], [], "../images"), /\.card\[hidden\]\{display:none\}/);
});

test("empty and not flagged means not printed: a dash, not check", () => {
  assert.match(renderReview([row({ tax: null })], [], "../images"), /<dt>tax<\/dt><dd class="none" title="not printed">—<\/dd>/);
});

test("a settled value shows both readings next to it", () => {
  const html = renderReview([row({ status: "MEDIUM", total: 8.5, flagged_fields: ["total"], readAs: { total: ["6.50", "8.50"] } })], [], "../images");
  assert.match(html, /<dt>total<\/dt><dd class="flag">8\.50 <span class="read">\(read 6\.50 \/ 8\.50\)<\/span><\/dd>/);
});

test("common notes become tags on the value, not bullets", () => {
  const html = renderReview([row({ reasons: ["subtotal computed (not printed)", "currency inferred"] })], [], "../images");
  assert.match(html, /<dt>subtotal<\/dt><dd>10\.00 <span class="tag">computed<\/span><\/dd>/);
  assert.match(html, /<dt>currency<\/dt><dd>MYR <span class="tag">inferred<\/span><\/dd>/);
  assert.doesNotMatch(html, /<li>/);
});

test("opens on Needs review (UNREADABLE, LOW, MEDIUM)", () => {
  const html = renderReview([row({}), row({ file: "b.jpg", status: "LOW" }), row({ file: "c.jpg", status: "MEDIUM" })], [], "../images");
  assert.match(html, /<button data-filter="UNREADABLE LOW MEDIUM" class="on">Needs review 2<\/button><button data-filter="">All 3<\/button>/);
});

test("a legend says what each level asks the reviewer to do", () => {
  assert.match(renderReview([row({})], [], "../images"), /<p class="legend">LOW: a value is missing, read it from the image · MEDIUM: all filled, confirm the highlighted value · HIGH: nothing to check<\/p>/);
});
