import { apiRoot } from "./config.ts";

/** An API error envelope from Keryx. */
export class ApiError extends Error {
  /**
   * @param message - Human-readable error.
   * @param status - HTTP status.
   * @param type - Keryx error type, if present.
   */
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Options for one HTTP call. */
export interface ApiRequestOptions {
  /** HTTP method. */
  method: string;
  /** Path under `/api`, starting with `/`. */
  path: string;
  /** Query string params (GET). */
  query?: Record<string, unknown>;
  /** JSON body. */
  body?: unknown;
  /** Session cookie value. */
  sessionCookie?: string;
}

/**
 * Call the Botholomew HTTP API.
 *
 * Checks Keryx's `{ error: { message } }` envelope, not only HTTP status — the
 * same rule as the website client.
 * @param origin - API origin (no `/api`).
 * @param options - Method, path, query, body, cookie.
 * @returns The parsed JSON body.
 */
export async function apiRequest(
  origin: string,
  options: ApiRequestOptions,
): Promise<unknown> {
  const { payload } = await apiRequestRaw(origin, options);
  return payload;
}

/**
 * Sign in and capture the session cookie from `Set-Cookie`.
 * @param origin - API origin.
 * @param email - Account email.
 * @param password - Account password.
 * @returns The session payload and cookie value.
 */
export async function loginRequest(
  origin: string,
  email: string,
  password: string,
): Promise<{ payload: unknown; sessionCookie: string }> {
  const { payload, sessionCookie } = await apiRequestRaw(origin, {
    method: "PUT",
    path: "/session",
    body: { email, password },
  });
  if (!sessionCookie) {
    throw new ApiError("Sign-in did not return a session cookie", 401);
  }
  return { payload, sessionCookie };
}

/**
 * Perform the fetch, parse JSON, and throw on a Keryx error envelope.
 * @param origin - API origin.
 * @param options - Request options.
 * @returns Payload and any session cookie.
 */
async function apiRequestRaw(
  origin: string,
  options: ApiRequestOptions,
): Promise<{ payload: unknown; sessionCookie?: string }> {
  const url = new URL(`${apiRoot(origin)}${options.path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.sessionCookie) {
    headers.Cookie = `__session=${options.sessionCookie}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const sessionCookie = readSessionCookie(setCookieHeaders(response.headers));
  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: text } };
    }
  }

  const envelope = payload as { error?: { message?: string; type?: string } };
  if (envelope?.error) {
    throw new ApiError(
      envelope.error.message || String(envelope.error),
      response.status,
      envelope.error.type,
    );
  }
  if (!response.ok) {
    throw new ApiError(
      `HTTP ${response.status} ${response.statusText}`,
      response.status,
    );
  }
  return { payload, sessionCookie };
}

/**
 * Read `Set-Cookie` values from a fetch `Headers` object.
 *
 * `Headers.getSetCookie` exists on Node 18.14+ and undici; `engines.node` is
 * `>=18`, so older 18.x would throw on login. Fall back to `get("set-cookie")`,
 * which is enough for the single `__session` cookie this client stores.
 * @param headers - Response headers.
 * @returns Each Set-Cookie value.
 */
export function setCookieHeaders(headers: Headers): string[] {
  const getter = headers.getSetCookie;
  if (typeof getter === "function") {
    return getter.call(headers);
  }
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

/**
 * Pull the `__session` cookie out of `Set-Cookie` headers.
 * @param setCookies - Raw Set-Cookie values.
 * @returns The cookie value, or undefined.
 */
export function readSessionCookie(setCookies: string[]): string | undefined {
  for (const header of setCookies) {
    const match = header.match(/^__session=([^;]+)/);
    if (match) return match[1];
  }
  return undefined;
}
