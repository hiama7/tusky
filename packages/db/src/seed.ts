import { db } from "./client.ts";
import { sports } from "./schema/index.ts";

export const SPORT_SEED = [
  { code: "football", name: "Football" },
  { code: "basketball", name: "Basketball" },
  { code: "cricket", name: "Cricket" },
];

export async function seedSports(): Promise<void> {
  await db.insert(sports).values(SPORT_SEED).onConflictDoNothing({ target: sports.code });
}

// Allow `tsx src/seed.ts` directly.
if (process.argv[1]?.endsWith("seed.ts")) {
  const { closeDb } = await import("./client.ts");
  await seedSports();
  await closeDb();
}
