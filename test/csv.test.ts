import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../src/csv";

test("quotes cells with commas, quotes or newlines; nulls are empty; arrays joined with '; '", () => {
  const out = toCsv(["a", "b", "c", "d"], [{ a: 'say "hi", ok', b: null, c: 1.5, d: ["x", "y"] }]);
  assert.equal(out, 'a,b,c,d\n"say ""hi"", ok",,1.5,x; y\n');
});
