/**
 * Applies all pending Drizzle migrations to the database.
 * Run with: pnpm -C lib/db run migrate
 *
 * This does not use drizzle's own `migrate()`, for one specific reason.
 *
 * This database's schema was, at some point, evolved with `drizzle-kit push`
 * rather than by running migrations. Push applies the schema directly and
 * records nothing, so the objects from 0004 onwards exist in the database
 * while drizzle's ledger still says the last applied migration is 0003. The
 * moment migrations actually ran, drizzle replayed 0004 and died on
 * `relation "conversation_messages" already exists`, taking the container
 * with it — and because every later migration was equally unrecorded, the
 * runtime column from 0009 had never been applied either, which is what
 * broke adding films.
 *
 * So this migrator reconciles rather than replays. It runs each pending
 * statement inside a savepoint and treats "this object already exists" as
 * success — the object is there, which is all the migration was asking for —
 * while any other error still aborts. Every skip is logged, so a database
 * that has drifted says so out loud instead of quietly diverging.
 *
 * That tolerance is safe for this repo's history, where every migration from
 * 0004 on is purely additive: CREATE TABLE, ADD COLUMN, ADD CONSTRAINT,
 * CREATE INDEX. Nothing drops or rewrites data, so re-running a statement
 * that already took effect cannot lose anything. A future migration that
 * drops or transforms data would not be idempotent in that way and must not
 * rely on this behaviour — write those to be safely re-runnable, or apply
 * them deliberately by hand.
 */
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { readMigrationFiles } from "drizzle-orm/migrator";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, "../migrations");

/**
 * Postgres error codes meaning "the thing this statement creates is already
 * there". Anything outside this set is a real failure and stops the run.
 */
const ALREADY_EXISTS = new Set([
  "42P07", // duplicate_table (also a duplicate index name)
  "42701", // duplicate_column
  "42710", // duplicate_object (constraint, type)
  "42P06", // duplicate_schema
]);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log("Running migrations from:", migrationsFolder);

const migrations = readMigrationFiles({ migrationsFolder });
const client = await pool.connect();

let applied = 0;
let skippedStatements = 0;

try {
  // Same location and shape drizzle uses, so its own migrate() stays
  // interchangeable with this one.
  await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const { rows } = await client.query<{ created_at: string | null }>(
    `select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1`,
  );
  const lastApplied = rows[0]?.created_at == null ? null : Number(rows[0].created_at);

  for (const migration of migrations) {
    if (lastApplied !== null && lastApplied >= migration.folderMillis) continue;

    await client.query("BEGIN");
    try {
      for (const statement of migration.sql) {
        const trimmed = statement.trim();
        if (!trimmed) continue;

        // A savepoint per statement: in Postgres a failed statement poisons
        // the whole transaction, so tolerating one means being able to roll
        // back just that statement and carry on.
        await client.query("SAVEPOINT stmt");
        try {
          await client.query(trimmed);
          await client.query("RELEASE SAVEPOINT stmt");
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code && ALREADY_EXISTS.has(code)) {
            await client.query("ROLLBACK TO SAVEPOINT stmt");
            await client.query("RELEASE SAVEPOINT stmt");
            skippedStatements++;
            console.log(
              `  [${migration.folderMillis}] already present (${code}) — ${trimmed.split("\n")[0]}`,
            );
          } else {
            throw err;
          }
        }
      }

      await client.query(
        `insert into "drizzle"."__drizzle_migrations" (hash, created_at) values ($1, $2)`,
        [migration.hash, migration.folderMillis],
      );
      await client.query("COMMIT");
      applied++;
      console.log(`  applied migration ${migration.folderMillis}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
} finally {
  client.release();
}

console.log(
  `Migrations applied successfully. ${applied} migration(s) recorded, ` +
    `${skippedStatements} statement(s) already present.`,
);
await pool.end();
