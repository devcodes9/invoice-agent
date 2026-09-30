import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, type EvalRow } from "../src/eval";
import type { Label } from "../src/labels";

const label = (file: string): Label => ({ file, vendor: "ACME SDN BHD", date: "2018-01-02", total: 10, set: "random", notes: "" });
const row = (file: string, over: Partial<EvalRow> = {}): EvalRow => ({
  file, status: "HIGH", vendor: "Acme Sdn. Bhd", date: "2018-01-02", total: 10, flagged_fields: [], ...over,
});

test("per field: right, empty (left for review) and wrong (filled but wrong); rows, recall and signals", () => {
  const labels = ["a", "b", "c", "d"].map(label);
  const rows = [
    row("a"),                                                                   // HIGH, all right
    row("b", { status: "LOW", date: null, flagged_fields: ["date"] }),          // date left empty
    row("c", { status: "MEDIUM", flagged_fields: ["subtotal"] }),               // flag on a field not labelled
    row("d", { total: 10.5 }),                                                  // HIGH, filled but wrong
  ];
  const r = evaluate(rows, labels);
  assert.deepEqual(r.field, {
    vendor: { right: 4, empty: 0, wrong: 0 },
    date: { right: 3, empty: 1, wrong: 0 },
    total: { right: 3, empty: 0, wrong: 1 },
  });
  assert.equal(r.n, 4);
  assert.deepEqual(r.byStatus, { HIGH: { n: 2, wrong: 1 }, LOW: { n: 1, wrong: 0 }, MEDIUM: { n: 1, wrong: 0 } });
  assert.deepEqual(r.recall, { wrong: 1, flagged: 0, missed: ["d"] });
  assert.deepEqual(r.signals, { date: 1, subtotal: 1 });
});

test("a labelled file with no row counts every field as empty", () => {
  const r = evaluate([row("z")], [label("b")]);
  assert.deepEqual(r.field.total, { right: 0, empty: 1, wrong: 0 });
  assert.deepEqual(r.recall, { wrong: 0, flagged: 0, missed: [] });
});
