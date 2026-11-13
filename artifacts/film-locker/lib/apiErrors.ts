/**
 * Turning a failed request into something worth reading.
 *
 * Every call site used to write its own catch, and they nearly all landed
 * on the same sentence: "Could not do the thing. Please try again." That
 * is the correct answer to roughly one failure in five. The other four
 * know exactly what went wrong — you are signed out, you are not Film
 * Pals, the list is full, your phone has no signal — and said nothing,
 * which is how a plain "error" came to mean "something, somewhere".
 *
 * ApiError.message already carries the server's words, but prefixed with
 * `HTTP 400 Bad Request: `, which is not a thing to put in front of
 * somebody. This pulls the sentence back out and classifies the rest.
 */
import { ApiError, TimeoutError } from '@workspace/api-client-react';

export interface DescribedError {
  /** Alert title — short, and never the word "Error" alone. */
  title: string;
  /** One sentence saying what happened, and where possible what to do. */
  message: string;
  /**
   * True when the only thing wrong is that nobody is signed in, so the
   * caller can offer the account prompt instead of an Alert that just
   * tells somebody off.
   */
  needsSignIn: boolean;
  /** The HTTP status, where there was a response at all. */
  status?: number;
}

/** The server's own `error` field, without the HTTP noise in front of it. */
function serverMessage(err: ApiError<unknown>): string | null {
  const data = err.data;
  if (data && typeof data === 'object' && 'error' in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  // Fall back to parsing it off the message, for a body shape this does
  // not know. Everything after the first ": " is the server's sentence.
  const colon = err.message.indexOf(': ');
  if (colon !== -1) {
    const tail = err.message.slice(colon + 2).trim();
    if (tail) return tail;
  }
  return null;
}

export interface DescribeOptions {
  /** What was being attempted, e.g. "add this film". Used in fallbacks. */
  action?: string;
  /**
   * What a 404 means for THIS call.
   *
   * A 404 is ambiguous in a way the others are not: it can mean the thing
   * is gone, or that the server does not have the endpoint at all — which
   * is what an app talking to a server older than itself looks like, and
   * is worth saying plainly rather than reporting as a missing record.
   */
  notFound?: string;
}

export function describeApiError(err: unknown, options: DescribeOptions = {}): DescribedError {
  const { action, notFound } = options;
  const doing = action ? `Could not ${action}` : 'Something went wrong';

  if (err instanceof TimeoutError) {
    return {
      title: 'No response',
      message: 'The server took too long to answer. Check your connection and try again.',
      needsSignIn: false,
    };
  }

  if (err instanceof ApiError) {
    const fromServer = serverMessage(err);

    if (err.status === 401) {
      return {
        title: 'Sign in needed',
        message: action
          ? `You need an account to ${action}.`
          : 'You need to be signed in to do that.',
        needsSignIn: true,
        status: 401,
      };
    }

    if (err.status === 403) {
      return {
        title: 'Not allowed',
        message: fromServer ?? 'You do not have permission to do that.',
        needsSignIn: false,
        status: 403,
      };
    }

    if (err.status === 404) {
      return {
        title: 'Not found',
        message: notFound ?? fromServer ?? 'That no longer exists.',
        needsSignIn: false,
        status: 404,
      };
    }

    if (err.status === 429) {
      return {
        title: 'Too many requests',
        message: 'Give it a minute and try again.',
        needsSignIn: false,
        status: 429,
      };
    }

    if (err.status >= 500) {
      return {
        title: 'Server problem',
        message: 'This is our end, not yours. Please try again shortly.',
        needsSignIn: false,
        status: err.status,
      };
    }

    // 400 and the rest: the server has usually said something specific and
    // actionable here, which is exactly the case that was being thrown away.
    return {
      title: doing,
      message: fromServer ?? 'Please try again.',
      needsSignIn: false,
      status: err.status,
    };
  }

  // No response at all — aeroplane mode, no signal, DNS. fetch rejects
  // with a bare TypeError, which says "Network request failed" and
  // nothing a person can act on.
  return {
    title: 'No connection',
    message: 'Check your signal and try again.',
    needsSignIn: false,
  };
}
