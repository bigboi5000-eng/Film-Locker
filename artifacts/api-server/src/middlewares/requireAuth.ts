import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export interface AuthedRequest extends Request {
  clerkUserId: string;
}

/**
 * What a rejected request can tell us about itself, without trusting it.
 *
 * A 401 used to say only "Unauthorized", which left the two possible
 * causes indistinguishable from the outside: the app never managed to get
 * a token, or it got one and the server would not accept it. Those need
 * opposite fixes and we spent days unable to tell them apart.
 *
 * The payload is read WITHOUT verifying the signature. That is safe
 * because nothing here is trusted or acted on — it is written to a log and
 * discarded, and the request is rejected either way. Verification is
 * Clerk's job and has already failed by the time this runs.
 *
 * The token itself is never logged. It is a bearer credential: anything
 * that writes it down hands a session to whoever can read the logs.
 */
function describeToken(header: string | undefined): Record<string, unknown> {
  if (!header) return { authHeader: "absent" };

  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return { authHeader: "present-but-empty" };

  const base: Record<string, unknown> = { authHeader: "present", length: token.length };

  try {
    const payload = token.split(".")[1];
    if (!payload) return { ...base, decode: "not-a-jwt" };

    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
      iat?: number;
      nbf?: number;
      iss?: string;
      azp?: string;
      sub?: string;
    };

    const now = Math.floor(Date.now() / 1000);
    return {
      ...base,
      iss: json.iss,
      sub: json.sub ? `${json.sub.slice(0, 12)}…` : undefined,
      // The one that matters. Clerk mints exp from ITS clock, so a token
      // arriving already expired means the device believed it was still
      // fresh — which is what a device clock running behind looks like
      // from here. A few seconds is ordinary latency; minutes is skew.
      expiredBySeconds: typeof json.exp === "number" ? now - json.exp : undefined,
      issuedSecondsAgo: typeof json.iat === "number" ? now - json.iat : undefined,
      notYetValidBySeconds: typeof json.nbf === "number" ? json.nbf - now : undefined,
    };
  } catch {
    return { ...base, decode: "unreadable" };
  }
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
    logger.warn(
      { url: req.originalUrl.split("?")[0], ...describeToken(req.headers.authorization) },
      "rejected an unauthenticated request",
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthedRequest).clerkUserId = userId;
  next();
}
