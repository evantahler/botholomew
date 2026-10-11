/** Base URL of the Botholomew backend API (override with `VITE_API_URL`). */
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

/**
 * Where the backend publishes its API reference: the OpenAPI 3 document the
 * `swagger` action serves, every route with its inputs and responses. The API
 * serves no files of its own, so this is the JSON document itself rather than a
 * browser page over it.
 *
 * It is the backend's origin, not the frontend's, so this is a whole URL rather
 * than a router path — and the trailing slashes are normalized here because a
 * `VITE_API_URL` written with a trailing slash is just as valid as one without.
 * @param base - The backend origin; defaults to {@link API_URL}.
 * @returns An absolute URL a browser can open.
 */
export function apiReferenceUrl(base: string = API_URL): string {
  return `${base.replace(/\/+$/, "")}/api/swagger`;
}

/**
 * Call a backend action over HTTP under the `/api` prefix, sending the session
 * cookie and parsing the JSON response.
 *
 * Keryx reports action failures in an `{ error: { message } }` envelope, which
 * it can return alongside a 200, so the envelope — not the HTTP status — is the
 * thing worth checking.
 * @param path - Action route beneath `/api` (e.g. `"/status"`).
 * @param options - Standard `fetch` options; a JSON `Content-Type` is added for string bodies.
 * @returns The parsed response body typed as `T`.
 * @throws {Error} If the response carries an `error` envelope.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_URL}/api${path}`;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] ??= "application/json";
  }

  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers,
  });

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error.message || String(payload.error));
  }
  return payload as T;
}
