import app from "./app";
import { logger } from "./lib/logger";

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
});
