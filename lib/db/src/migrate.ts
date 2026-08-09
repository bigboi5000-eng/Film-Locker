/**
 * Applies all pending Drizzle migrations to the database.
 * Run with: pnpm --filter @workspace/db run migrate
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../migrations");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

console.log("Running migrations from:", migrationsFolder);

await migrate(db, { migrationsFolder });

console.log("Migrations applied successfully.");
await pool.end();
