/**
 * Simple fetch wrapper for executing HTTP requests from manifest data.
 */

import type { AuthConfig } from "./curl-parser.js";

/**
 * Options for making an HTTP request via the httpRequest function.
 */
export interface HttpRequestOptions {
  baseUrl: string;
  path: string;
  method: string;
  auth: AuthConfig;
  queryParams?: Record<string, string>;
  body?: unknown;
}

/**
 * Represents an HTTP error response with status code and body text.
 * Provides a helpful hint for 401/403 errors about session expiry.
 */
export class HttpError extends Error {
  status: number;
  body: string;

  /**
   * Creates an HttpError with the given status code and response body.
   * @param status - the HTTP status code (e.g. 401, 404, 500)
   * @param body - the raw response body text
   */
  constructor(status: number, body: string) {
    const hint =
      status === 401 || status === 403
        ? " -- Your session may have expired. Re-run auth setup."
        : "";
    super(`HTTP ${status}${hint}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Builds the request headers from the auth config and optional body.
 * @param auth - the auth configuration with cookie, token, apiKey, or extraHeaders
 * @param hasBody - whether the request has a body (adds Content-Type header)
 * @returns the constructed headers record
 */
function buildHeaders(
  auth: AuthConfig,
  hasBody: boolean
): Record<string, string> {
  return {
    Accept: "application/json",
    ...(auth.cookie ? { Cookie: auth.cookie } : {}),
    ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    ...(auth.apiKey ? { "X-API-Key": auth.apiKey } : {}),
    ...(auth.extraHeaders ?? {}),
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

/**
 * Executes an HTTP request with auth, query params, and optional JSON body.
 * Throws HttpError for non-2xx responses.
 * @param opts - the request options including URL, method, auth, and body
 * @returns the parsed JSON response body
 */
export async function httpRequest(opts: HttpRequestOptions): Promise<unknown> {
  const { baseUrl, path, method, auth, queryParams, body } = opts;

  const url = new URL(path, baseUrl);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers = buildHeaders(auth, body !== undefined);

  const init: RequestInit = {
    method: method.toUpperCase(),
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  const response = await fetch(url.toString(), init);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new HttpError(response.status, errorBody);
  }

  return response.json();
}
