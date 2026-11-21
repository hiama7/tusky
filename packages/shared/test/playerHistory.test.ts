import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ManualImportFileSchema, PlayerHistorySchema } from "../src/index.ts";

describe("ManualImportFileSchema", () => {
  it("accepts the bundled sample file", () => {
    const raw = JSON.parse(readFileSync(new URL("../../../data/sample-players.json", import.meta.url), "utf8"));
    const parsed = ManualImportFileSchema.parse(raw);
    expect(parsed[0]!.history.confidence).toBe(1); // defaulted
    expect(parsed[0]!.history.sources).toEqual([]);
  });

  it("fills defaults for a minimal entry and validates against PlayerHistorySchema", () => {
    const [entry] = ManualImportFileSchema.parse([
      { player: { provider: "api-sports", externalId: "276" }, history: { summary: "Minimal" } },
    ]);
    expect(PlayerHistorySchema.safeParse(entry!.history).success).toBe(true);
  });

  it("rejects an out-of-range confidence", () => {
    const res = ManualImportFileSchema.safeParse([
      { player: { name: "X", sport: "football" }, history: { summary: "s", confidence: 3 } },
    ]);
    expect(res.success).toBe(false);
  });
});
