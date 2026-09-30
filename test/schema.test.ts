import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Receipt } from "../src/schema";

// Some OpenRouter backends (Azure) reject structured-output schemas with more than 16 nullable/union fields.
test("schema stays within 16 nullable fields", () => {
  const s = JSON.stringify(z.toJSONSchema(Receipt));
  const unions = (s.match(/"anyOf"/g) ?? []).length + (s.match(/"type":\[/g) ?? []).length;
  assert.ok(unions <= 16, `${unions} nullable fields`);
});
