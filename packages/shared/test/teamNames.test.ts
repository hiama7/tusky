import { describe, expect, it } from "vitest";
import { normalizeTeamName } from "../src/index.ts";

// Same cases as ml-service/tests/test_openfootball.py (test_normalize_team), with the exact
// strings the Python implementation produces. If these diverge, the two languages stop agreeing
// on which clubs are the same.
describe("normalizeTeamName (parity with the Python importer)", () => {
  it.each([
    ["AFC Bournemouth", "bournemouth"],
    ["Bournemouth", "bournemouth"],
    ["FC Bayern München", "bayern munchen"],
    ["Bayern Munchen", "bayern munchen"],
    ["1. FC Köln", "koln"],
    ["Koln", "koln"],
    ["Brighton & Hove Albion FC", "brighton hove albion"],
    ["Sunderland AFC", "sunderland"],
    ["ES Troyes AC", "es troyes"],
    ["Estac Troyes", "estac troyes"],
    ["SV 07 Elversberg", "07 elversberg"],
    ["Paris Saint Germain", "paris saint germain"],
  ])("%s -> %s", (name, expected) => {
    expect(normalizeTeamName(name)).toBe(expected);
  });

  it("treats a missing name as empty", () => {
    expect(normalizeTeamName("FC")).toBe("");
  });
});
