import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * When this process started. Captured at module load, which is close
 * enough to boot for the only question it answers: how long has this
 * deployment been the live one.
 */
const STARTED_AT = new Date().toISOString();

/**
 * Health, plus which commit is answering.
 *
 * The commit was already logged at boot, which meant the only way to tell
 * whether a merge had actually reached production was to open the deploy
 * logs and read them — and when the deploy list showed an older commit at
 * the top, there was no way to tell a skipped build from a stalled one
 * without guessing. That is exactly how yesterday's collaborator 404s went
 * unexplained for a day: the app was calling routes the running server had
 * never had, and nothing short of a stack trace would say so.
 *
 * Railway injects these for GitHub-connected deployments. They are null
 * anywhere that does not, which is a true answer rather than a missing one.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    commit: process.env["RAILWAY_GIT_COMMIT_SHA"] ?? null,
    branch: process.env["RAILWAY_GIT_BRANCH"] ?? null,
    startedAt: STARTED_AT,
  });
  res.json(data);
});

export default router;
