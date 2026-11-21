import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "@tusky/shared";
import { closeDb, db } from "./client.ts";
import { seedSports } from "./seed.ts";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

await migrate(db, { migrationsFolder });
await seedSports();
logger.info("migrations applied + sports seeded");
await closeDb();
