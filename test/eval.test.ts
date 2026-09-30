import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, type EvalRow } from "../src/eval";
import type { Label } from "../src/labels";

const label = (file: string): Label => ({ file, vendor: "ACME SDN BHD", date: "2018-01-02", total: 10, set: "random", notes: "" });
const row = (file: string, over: Partial<EvalRow> = {}): EvalRow => ({
  file, status: "HIGH", vendor: "Acme Sdn. Bhd", date: "2018-01-02", total: 10, flagged_fields: [], ...over,
});

test("counts per-field accuracy, all-3 per status, flag recall and false flags per signal", () => {
  const labels = ["a", "b", "c", "d"].map(label);
  const rows = [
    row("a"),                                                        // HIGH, right
    row("b", { status: "LOW", date: "2016-01-02", flagged_fields: ["date"] }), // LOW, wrong date, caught
    row("c", { status: "MEDIUM", flagged_fields: ["items"] }),       // MEDIUM, right → false flag on items
    row("d", { total: 10.5 }),                                       // HIGH, wrong total, missed
  ];
  const r = evaluate(rows, labels);
  assert.deepEqual(r.field, { vendor: 4, date: 3, total: 3, n: 4 });
  assert.deepEqual(r.byStatus, { LOW: { n: 1, correct: 0 }, MEDIUM: { n: 1, correct: 1 }, HIGH: { n: 2, correct: 1 } });
  assert.deepEqual(r.recall, { wrong: 2, flagged: 1, missed: ["d"] });
  assert.deepEqual(r.signals, { date: { fired: 1, falseFlags: 0 }, items: { fired: 1, falseFlags: 1 } });
});

test("rows without a label are ignored; a labelled file with no row counts as wrong and missed", () => {
  const r = evaluate([row("a"), row("z")], [label("a"), label("b")]);
  assert.equal(r.field.n, 2);
  assert.deepEqual(r.recall, { wrong: 1, flagged: 0, missed: ["b"] });
});
