import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicates } from "../src/dedupe";

test("second copy of identical bytes points at the first file (sorted order)", () => {
  const files = [
    { file: "b.jpg", bytes: Buffer.from("same") },
    { file: "a.jpg", bytes: Buffer.from("same") },
    { file: "c.jpg", bytes: Buffer.from("other") },
  ];
  assert.deepEqual(findDuplicates(files), new Map([["b.jpg", "a.jpg"]]));
});
