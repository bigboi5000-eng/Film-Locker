import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import journal from "@workspace/db/journal";
import app from "./app";
import { logger } from "./lib/logger";

const execFileAsync = promisify(execFile);

/**
 * Logs yt-dlp's own dependency report on startup — specifically whether
 * curl_cffi (needed for TikTok's browser-impersonation requirement) is
 * actually available in this exact deployed container. `yt-dlp -v` prints
 * this before it even looks at its arguments, so passing none is enough:
 * it always exits non-zero ("You must provide at least one URL"), but the
 * debug preamble we want is on stderr regardless. This exists because
 * repeated TikTok "no impersonate target available" reports were
 * indistinguishable from a stale deployment without checking this by hand
 * on Railway each time.
 */
async function logYtDlpDiagnostics(): Promise<void> {
  const bin = process.env["YT_DLP_PATH"] ?? "yt-dlp";
  try {
    await execFileAsync(bin, ["-v"], { timeout: 10_000 });
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? "");
    const lines = stderr.split("\n");
    const libLine = lines.find((l) => l.includes("Optional libraries")) ?? null;
    const handlersLine = lines.find((l) => l.includes("Request Handlers")) ?? null;
    logger.info(
      {
        curlCffiAvailable: handlersLine?.includes("curl_cffi") ?? false,
        optionalLibraries: libLine,
        requestHandlers: handlersLine,
      },
      "yt-dlp dependency check",
    );
  }
}

/**
 * Which Clerk instance this deployment will accept tokens from.
 *
 * A publishable key is base64 of the instance's frontend API host, and is not
 * a secret — it ships inside the app binary by design — so decoding it for
 * the logs is safe. The secret key is only ever reported as present or
 * missing, never printed.
 *
 * This exists because the failure it diagnoses is invisible from the outside:
 * if the server holds one instance's keys and a build holds another's, the
 * app signs in perfectly well against Clerk and then every API call 401s.
 * Without this you cannot tell from the logs which instance the server is on.
 */
function describeClerkInstance(): Record<string, unknown> {
  const publishable = process.env["CLERK_PUBLISHABLE_KEY"];
  const secret = process.env["CLERK_SECRET_KEY"];

  let host: string | null = null;
  const encoded = publishable?.replace(/^pk_(test|live)_/, "");
  if (encoded) {
    try {
      host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "") || null;
    } catch {
      host = null;
    }
  }

  return {
    clerkEnv: publishable?.startsWith("pk_live_")
      ? "production"
      : publishable?.startsWith("pk_test_")
        ? "development"
        : "unknown",
    clerkFrontendApi: host,
    clerkSecretKeySet: Boolean(secret),
    // Both keys must belong to the same instance, so a mismatch here is the
    // thing to look at first when authenticated requests start failing.
    clerkSecretKeyEnv: secret?.startsWith("sk_live_")
      ? "production"
      : secret?.startsWith("sk_test_")
        ? "development"
        : "unknown",
  };
}

/**
 * Whether the database has actually had every migration in the repo applied.
 *
 * This exists because the failure it catches is silent and expensive. The
 * container is supposed to run migrations before serving, but that step can
 * be bypassed without any error at all — a start command overridden in the
 * host's dashboard, or a pnpm filter that matches no package and exits 0.
 * The server then boots happily against a schema the code does not match,
 * and the first symptom is a 500 on whichever endpoint touches the new
 * column, several test rounds later.
 *
 * Drizzle records applied migrations with the same epoch-millisecond stamp
 * the journal uses, so the newest journal entry and the newest applied row
 * should agree. The migrations table lives in its own schema by default but
 * older setups put it in public, so both are checked rather than assumed.
 *
 * Deliberately logs rather than refusing to boot: a wrong query here would
 * take down a healthy service, which is worse than the problem it reports.
 * The log line is loud enough to find.
 */
async function checkSchemaVersion(): Promise<Record<string, unknown>> {
  const entries = journal.entries ?? [];
  const expected = entries.length ? entries[entries.length - 1] : null;
  const expectedAt = expected?.when ?? null;

  let appliedAt: number | null = null;
  try {
    const result = await db.execute<{ created_at: string | number }>(sql`
      select created_at
      from (
        select created_at from drizzle.__drizzle_migrations
        union all
        select created_at from public.__drizzle_migrations
      ) all_migrations
      order by created_at desc
      limit 1
    `);
    const raw = result.rows[0]?.created_at;
    appliedAt = raw == null ? null : Number(raw);
  } catch {
    // Either table may not exist; a union over a missing one throws. Fall
    // back to whichever does exist rather than reporting "no migrations".
    for (const table of [sql`drizzle.__drizzle_migrations`, sql`public.__drizzle_migrations`]) {
      try {
        const result = await db.execute<{ created_at: string | number }>(
          sql`select created_at from ${table} order by created_at desc limit 1`,
        );
        const raw = result.rows[0]?.created_at;
        if (raw != null) { appliedAt = Number(raw); break; }
      } catch {
        // try the next location
      }
    }
  }

  const upToDate = expectedAt != null && appliedAt != null && appliedAt >= expectedAt;

  if (!upToDate) {
    logger.error(
      {
        expectedMigration: expected?.tag ?? null,
        expectedAt,
        latestAppliedAt: appliedAt,
        migrationsInRepo: entries.length,
      },
      "DATABASE SCHEMA IS BEHIND THE CODE — migrations have not been applied. " +
        "Endpoints touching new columns will fail with 500s until they are.",
    );
  }

  return { schemaUpToDate: upToDate, latestMigration: expected?.tag ?? null };
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  // Railway injects these automatically for GitHub-connected deployments —
  // logging them on startup makes it possible to confirm from the deploy
  // logs alone which commit is actually running, instead of inferring it
  // from stack-trace line numbers after the fact.
  logger.info(
    {
      port,
      commit: process.env["RAILWAY_GIT_COMMIT_SHA"] ?? null,
      commitMessage: process.env["RAILWAY_GIT_COMMIT_MESSAGE"] ?? null,
      branch: process.env["RAILWAY_GIT_BRANCH"] ?? null,
      ...describeClerkInstance(),
    },
    "Server listening",
  );

  void logYtDlpDiagnostics();
  void checkSchemaVersion().then((schema) => {
    logger.info(schema, "database schema check");
  });
});
