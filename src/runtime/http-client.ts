/**
 * Simple fetch wrapper for executing HTTP requests from manifest data.
 */

import type { AuthConfig } from "./curl-parser.js";

/**
 *
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
 *
 */
export class HttpError extends Error {
  status: number;
  body: string;

  /**
   *
   * @param status
   * @param body
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
 *
 * @param opts
 */
export async function httpRequest(opts: HttpRequestOptions): Promise<unknown> {
  const { baseUrl, path, method, auth, queryParams, body } = opts;

  // Build URL with query params
  const url = new URL(path, baseUrl);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (auth.cookie) {
    headers["Cookie"] = auth.cookie;
  }
  if (auth.token) {
    headers["Authorization"] = `Bearer ${auth.token}`;
  }
  if (auth.apiKey) {
    headers["X-API-Key"] = auth.apiKey;
  }
  if (auth.extraHeaders) {
    for (const [key, value] of Object.entries(auth.extraHeaders)) {
      headers[key] = value;
    }
  }

  // Build request init
  const init: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), init);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new HttpError(response.status, errorBody);
  }

  return response.json();
}
