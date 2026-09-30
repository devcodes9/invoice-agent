import { test } from "node:test";
import assert from "node:assert/strict";
import { sameValue } from "../src/compare";

test("vendor with a trailing registration number in brackets matches the bare name", () => {
  assert.equal(sameValue("99 SPEED MART S/B (519537-X)", "99 SPEED MART S/B"), true);
});

test("different vendor names still differ", () => {
  assert.equal(sameValue("TED HENG STATIONERY", "TEO HENG STATIONERY"), false);
});
