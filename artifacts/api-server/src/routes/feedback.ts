import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, feedbackTable, usersTable } from "@workspace/db";
import { SubmitFeedbackBody, SubmitFeedbackResponse } from "@workspace/api-zod";
import { requireAuth, type AuthedRequest } from "../middlewares/requireAuth";
import { sendFeedbackEmail } from "../lib/email";

const router: IRouter = Router();

// ── POST /feedback ─────────────────────────────────────────────────────────────
// Always saved to the database first — the email notification is best-effort
// on top of that, so a submission is never lost even if it can't be sent.

router.post("/feedback", requireAuth, async (req, res): Promise<void> => {
  const { clerkUserId } = req as AuthedRequest;

  const body = SubmitFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [user] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId));

  const userEmail = user?.email ?? "unknown";

  const [inserted] = await db
    .insert(feedbackTable)
    .values({ userId: clerkUserId, userEmail, message: body.data.message })
    .returning();

  void sendFeedbackEmail({ fromUserEmail: userEmail, message: body.data.message });

  res.status(201).json(
    SubmitFeedbackResponse.parse({ id: inserted.id, createdAt: inserted.createdAt })
  );
});

export default router;
