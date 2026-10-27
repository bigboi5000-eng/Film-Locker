export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);

/**
 * How long a request may hang before it is given up on.
 *
 * React Native's fetch has NO default timeout, and that is not a detail: a
 * socket that stalls — a Wi-Fi to mobile handover, a dozing device, a
 * connection a middlebox dropped without telling either end — leaves the
 * promise unsettled for ever. React Query then sits in `pending` with no
 * error and no retry, which on screen is every spinner in the app turning
 * until the process is killed. An error is recoverable; a hang is not.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * And a shorter one for the auth token, because that one hangs EVERYTHING.
 *
 * The getter is Clerk's getToken(), which is itself a network call to
 * refresh a short-lived token. Every authenticated request waits on it
 * before it is even sent, so one stalled refresh is not one dead screen, it
 * is all of them at once — the whole app spinning while not a single
 * request has left the device. Ten seconds is already far longer than a
 * token refresh takes.
 */
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Thrown when a request runs out of time.
 *
 * Only the request itself can raise this now. A token that does not
 * arrive is no longer fatal — see the note where it is fetched — so there
 * is nothing left to distinguish, and `phase` stays only because callers
 * read it.
 */
export class TimeoutError extends Error {
  readonly phase: "request";
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
    this.phase = "request";
  }
}

/**
 * An abort signal that fires on a timer, on the caller's own signal, or
 * both.
 *
 * React Query passes its own signal so it can cancel on unmount, and that
 * has to keep working — so this listens to it rather than replacing it.
 */
function signalWithTimeout(
  caller: AbortSignal | null | undefined,
  ms: number,
): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController();
  let didTimeOut = false;

  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, ms);

  const onCallerAbort = () => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    done: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _authStateDescriber: (() => string) | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Supplies a short description of the client's own auth state, sent as a
 * header ONLY on requests that end up with no token.
 *
 * There is no other way to see this. When the token getter comes back
 * empty the request still goes out, the server answers 401, and from the
 * server that is indistinguishable from a signed-out user browsing —
 * while on the device the app may believe it is perfectly well signed in.
 * Those are different bugs. Carrying a few words of client state over
 * with the failed request is the only way to read, from a log the owner
 * can actually see, which one is happening.
 *
 * Never put a token or anything else secret in here: it is a plain header
 * and it is written to the logs on purpose.
 */
export function setAuthStateDescriber(fn: (() => string) | null): void {
  _authStateDescriber = fn;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    // Not being able to get a token NEVER stops the request.
    //
    // It used to. The getter is Clerk's getToken(), and when a refresh
    // fails that rejects — the rejection came straight back out of here
    // and the fetch was never made, so a broken sign-in took down every
    // screen in the app including the ones that need no sign-in at all.
    // Trending and new releases are public; they were failing purely
    // because the app could not answer a question nobody had asked. The
    // giveaway was that they started working again once the session had
    // properly ended, because a signed-out getToken() returns null
    // instead of throwing.
    //
    // Sending it unauthenticated is strictly better: a public endpoint
    // answers normally, and a private one replies 401 — which is a real
    // answer the UI can show and the user can act on.
    let tokenTimer: ReturnType<typeof setTimeout> | undefined;
    let tokenError: string | null = null;
    try {
      const token = await Promise.race([
        Promise.resolve(_authTokenGetter()).catch((err: unknown) => {
          // Recorded rather than thrown. The request still goes — see
          // above — but which of "no session" and "the call failed" this
          // was is the difference between two unrelated bugs.
          tokenError = `threw:${err instanceof Error ? `${err.name}:${err.message}` : String(err)}`;
          return null;
        }),
        new Promise<null>((resolve) => {
          tokenTimer = setTimeout(() => {
            tokenError = "timed-out";
            resolve(null);
          }, TOKEN_TIMEOUT_MS);
        }),
      ]);
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      } else {
        // No token, so say what happened instead. The server logs this
        // beside the 401 it is about to send.
        const why = tokenError ?? "returned-null";
        let state = "";
        try {
          state = _authStateDescriber?.() ?? "";
        } catch {
          state = "describer-threw";
        }
        headers.set("x-auth-debug", `${why}${state ? `; ${state}` : ""}`.slice(0, 200));
      }
    } finally {
      clearTimeout(tokenTimer);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  const timeout = signalWithTimeout(init.signal, REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(input, { ...init, method, headers, signal: timeout.signal });
  } catch (err) {
    // An abort reads as a plain AbortError, so the only way to tell the
    // timer firing from React Query cancelling the query is to have kept
    // track ourselves.
    if (timeout.timedOut()) throw new TimeoutError(REQUEST_TIMEOUT_MS);
    throw err;
  } finally {
    timeout.done();
  }

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  return (await parseSuccessBody(response, responseType, requestInfo)) as T;
}
