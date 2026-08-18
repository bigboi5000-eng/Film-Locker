import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Structured request logging
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Clerk proxy — must come BEFORE express.json() (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// CORS — allow credentials so Clerk session cookies work in browser previews
app.use(cors({ credentials: true, origin: true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve publishable key from request host so the same server can serve
// multiple Clerk custom domains; falls back to CLERK_PUBLISHABLE_KEY in dev.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// General rate limit — 120 requests per 15 min per IP
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — please try again later." },
  }),
);

// Stricter limit on AI/Gemini-heavy routes
const heavyLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests to this endpoint — please slow down." },
});

app.use("/api/movies/process-social-link", heavyLimit);
app.use("/api/movies/ai-extract", heavyLimit);
app.use("/api/movies/recommend", heavyLimit);

app.use("/api", router);

// JSON error handler — keeps the API's error shape consistent (matching the
// { error: string } responses routes already return for 4xx) even for
// unhandled exceptions, instead of falling through to Express's default HTML
// error page, which is unreadable to API clients and to error toasts in the app.
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error." });
});

export default app;
