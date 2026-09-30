import { test } from "node:test";
import assert from "node:assert/strict";
import { sameValue } from "../src/compare";

test("vendor with a trailing registration number in brackets matches the bare name", () => {
  assert.equal(sameValue("99 SPEED MART S/B (519537-X)", "99 SPEED MART S/B"), true);
});

test("different vendor names still differ", () => {
  assert.equal(sameValue("TED HENG STATIONERY", "TEO HENG STATIONERY"), false);
});

test("line items with the same total but different line amounts disagree", async () => {
  const { compare } = await import("../src/compare");
  const { receipt, item } = await import("./fixtures");
  const d = compare(receipt({ line_items: [item(400), item(11.5)] }), receipt({ line_items: [item(300), item(111.5)] })).find((x) => x.field === "items")!;
  assert.equal(d.agree, false);
});

test("line items in a different order but the same amounts agree", async () => {
  const { compare } = await import("../src/compare");
  const { receipt, item } = await import("./fixtures");
  const d = compare(receipt({ line_items: [item(400), item(11.5)] }), receipt({ line_items: [item(11.5), item(400)] })).find((x) => x.field === "items")!;
  assert.equal(d.agree, true);
});
