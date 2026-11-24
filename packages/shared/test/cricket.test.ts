import { describe, expect, it } from "vitest";
import { cricketTeamKey, splitCricketGender } from "../src/index.ts";

// Same cases as ml-service/tests/test_cricsheet.py::test_team_key_normalizes_and_resolves_renames.
// If these diverge, Cricsheet history and live fixtures stop sharing team rows.
describe("cricketTeamKey (parity with the Python importer)", () => {
  it.each([
    ["Kings XI Punjab", "male", "m:punjab kings"],
    ["Punjab Kings", "male", "m:punjab kings"],
    ["India", "female", "f:india"],
    ["St. Lucia Kings", "male", "m:st lucia kings"],
  ] as const)("%s (%s) -> %s", (name, gender, key) => {
    expect(cricketTeamKey(name, gender)).toBe(key);
  });
});

describe("splitCricketGender", () => {
  it("detects women's team suffixes", () => {
    expect(splitCricketGender("India Women")).toEqual({ name: "India", gender: "female" });
    expect(splitCricketGender("Australia W")).toEqual({ name: "Australia", gender: "female" });
    expect(splitCricketGender("West Indies")).toEqual({ name: "West Indies", gender: "male" });
  });
});
