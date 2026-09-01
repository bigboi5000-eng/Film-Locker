import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
    },
    "Server listening",
  );

  void logYtDlpDiagnostics();
});
