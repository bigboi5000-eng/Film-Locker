import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { UpdatePushTokenBody } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// ── PUT /users/push-token ─────────────────────────────────────────────────────
// Stores or updates the Expo push token for the authenticated user.

router.put("/users/push-token", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const body = UpdatePushTokenBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { expoPushToken } = body.data;

  await db
    .update(usersTable)
    .set({ expoPushToken })
    .where(eq(usersTable.clerkId, clerkUserId));

  res.status(204).send();
});

export default router;
