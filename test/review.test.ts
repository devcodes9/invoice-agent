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

test("empty values say check; reasons listed; text is escaped", () => {
  const html = renderReview([row({ status: "LOW", total: null, reasons: ['check total: read as 1.00 or 2.00 ("<b>TOTAL</b>")'] })], [], "../images");
  assert.match(html, /<dt>total<\/dt><dd class="check">check<\/dd>/);
  assert.match(html, /<li>check total: read as 1\.00 or 2\.00 \(&quot;&lt;b&gt;TOTAL&lt;\/b&gt;&quot;\)<\/li>/);
});

test("agreed line items are shown in a collapsed section", () => {
  const html = renderReview([row({ itemsAgreed: true })], [{ file: "a.jpg", description: "Tea", qty: 2, unit_price: 1.5, amount: 3 }], "../images");
  assert.match(html, /<details><summary>1 line item<\/summary>/);
  assert.match(html, /<td>Tea<\/td><td>2<\/td><td>1\.50<\/td><td>3\.00<\/td>/);
});

test("status counts appear on the filter buttons", () => {
  const html = renderReview([row({}), row({ file: "b.jpg", status: "LOW" })], [], "../images");
  assert.match(html, /<button data-filter="LOW">LOW 1<\/button>/);
  assert.match(html, /<button data-filter="HIGH">HIGH 1<\/button>/);
});
