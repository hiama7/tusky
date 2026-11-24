import { env, type SportCode } from "@tusky/shared";
import { BasketballAdapter } from "./apiSports/basketball.ts";
import { FootballAdapter } from "./apiSports/football.ts";
import { ApiSportsClient } from "./apiSports/client.ts";
import { CricketDataAdapter, CricketDataClient } from "./cricketData/adapter.ts";
import type { SportAdapter } from "./types.ts";

const adapters = new Map<SportCode, SportAdapter>();

export function getAdapter(sport: SportCode): SportAdapter {
  let adapter = adapters.get(sport);
  if (!adapter) {
    switch (sport) {
      case "football":
        adapter = new FootballAdapter(new ApiSportsClient("football"), env.FOOTBALL_LEAGUE_IDS);
        break;
      case "basketball":
        adapter = new BasketballAdapter(new ApiSportsClient("basketball"), env.BASKETBALL_LEAGUE_IDS);
        break;
      case "cricket":
        adapter = new CricketDataAdapter(new CricketDataClient(), env.CRICKET_FORMATS);
        break;
      default:
        throw new Error(`No adapter for sport '${sport satisfies never}'`);
    }
    adapters.set(sport, adapter);
  }
  return adapter;
}

export function enabledAdapters(): SportAdapter[] {
  return env.ENABLED_SPORTS.map(getAdapter);
}
