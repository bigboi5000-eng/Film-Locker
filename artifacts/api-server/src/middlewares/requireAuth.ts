import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export interface AuthedRequest extends Request {
  clerkUserId: string;
}

/**
 * Middleware that verifies the Clerk JWT and populates `req.clerkUserId`.
 * Returns 401 JSON if the request is unauthenticated.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthedRequest).clerkUserId = userId;
  next();
}
