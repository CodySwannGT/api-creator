/**
 * Launch a Playwright browser to capture auth credentials.
 *
 * Flow:
 * 1. Open browser, navigate to URL
 * 2. User logs in manually
 * 3. User presses Enter to confirm they're logged in
 * 4. Capture cookies + headers from the next few API requests
 * 5. Auto-close browser and return auth
 */

import { chromium } from "playwright";
import type { BrowserContext, Request as PwRequest } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import chalk from "chalk";
import ora from "ora";
import type { AuthConfig } from "../runtime/curl-parser.js";

const SKIP_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-cache",
  "connection",
  "content-length",
  "content-type",
  "host",
  "origin",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "upgrade-insecure-requests",
  "user-agent",
  "pragma",
  "dnt",
  "if-none-match",
  "if-modified-since",
  "sec-ch-ua-platform-version",
  "sec-ch-device-memory",
  "sec-ch-dpr",
  "sec-ch-viewport-width",
  "ect",
  "priority",
  "cache-control",
]);

const API_RESOURCE_TYPES = new Set(["xhr", "fetch"]);

const MIN_CAPTURE_REQUESTS = 8;

/**
 * Mutable state for the auth capture process, using `.value` pattern
 * to satisfy functional/immutable-data rule
 */
interface CaptureState {
  value: {
    cookie: string;
    token: string;
    extraHeaders: Record<string, string>;
    count: number;
    resolved: boolean;
  };
}

/**
 * Builds an AuthConfig from captured credentials, returning null if nothing useful was captured.
 * @param state - the capture state with cookie, token, extraHeaders, and count
 * @returns the built AuthConfig or null if insufficient data
 */
function buildCapturedAuth(state: CaptureState): AuthConfig | null {
  const { cookie, token, extraHeaders, count } = state.value;
  if (count === 0) return null;
  return {
    ...(cookie ? { cookie } : {}),
    ...(token ? { token } : {}),
    ...(Object.keys(extraHeaders).length > 0
      ? { extraHeaders: { ...extraHeaders } }
      : {}),
  };
}

/**
 * Extracts extra x-* headers from a request header map, filtering out known skip headers.
 * @param headers - the full request headers map
 * @param existing - the existing captured extra headers to merge into
 * @returns the updated extra headers record
 */
function extractExtraHeaders(
  headers: Record<string, string>,
  existing: Record<string, string>
): Record<string, string> {
  return Object.entries(headers).reduce<Record<string, string>>(
    (acc, [name, value]) => {
      const lower = name.toLowerCase();
      if (SKIP_HEADERS.has(lower)) return acc;
      if (lower.startsWith("sec-")) return acc;
      if (
        lower.startsWith("x-") &&
        value &&
        !lower.startsWith("x-client-") &&
        lower !== "x-csrf-without-token" &&
        lower !== "x-requested-with"
      ) {
        return { ...acc, [name]: value };
      }
      return acc;
    },
    existing
  );
}

/**
 * Launches a persistent browser context and returns it, handling the "no chromium" error case.
 * @param userDataDir - temp directory for browser profile data
 * @param spinner - the ora spinner to update on failure
 * @returns the launched BrowserContext
 */
async function launchContext(
  userDataDir: string,
  spinner: ReturnType<typeof ora>
): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      headless: false,
    });
  } catch (err) {
    spinner.fail("Failed to launch browser");
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Executable doesn't exist")) {
      console.log(
        chalk.yellow("\nChromium browser is not installed for Playwright.")
      );
      console.log(chalk.white("Run this to install it:\n"));
      console.log(chalk.cyan("  npx playwright install chromium\n"));
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Waits for the user to press Enter in stdin.
 * @returns a promise that resolves when Enter is pressed
 */
async function waitForEnter(): Promise<void> {
  return new Promise<void>(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => {
      resolve();
    });
  });
}

/**
 * Extracts the hostname from a URL, returning null on failure
 * @param url - the URL string to parse
 * @returns the hostname or null
 */
function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Processes a single captured request, updating the capture state
 * @param request - the Playwright request to process
 * @param headers - the resolved headers from the request
 * @param state - the mutable capture state
 */
function processCapturedRequest(
  request: PwRequest,
  headers: Record<string, string>,
  state: CaptureState
): void {
  const cookie = headers["cookie"] ?? "";
  if (cookie.length > 100) {
    state.value = { ...state.value, cookie };
  }

  const authHeader = headers["authorization"];
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    state.value = {
      ...state.value,
      token: authHeader.replace(/^[Bb]earer\s+/, ""),
    };
  }

  state.value = {
    ...state.value,
    extraHeaders: extractExtraHeaders(headers, state.value.extraHeaders),
  };

  if (state.value.cookie || state.value.token) {
    state.value = { ...state.value, count: state.value.count + 1 };
    const shortPath = new URL(request.url()).pathname.slice(0, 60);
    console.log(
      chalk.cyan(
        `  ✓ ${request.method()} ${shortPath} (${state.value.count}/${MIN_CAPTURE_REQUESTS})`
      )
    );
  }
}

/**
 * Captures authentication credentials by monitoring API requests in a browser session.
 * @param context - the Playwright browser context to monitor
 * @param rootDomain - the root domain to filter requests by
 * @returns the captured AuthConfig or null if capture timed out with no data
 */
function captureFromRequests(
  context: BrowserContext,
  rootDomain: string
): Promise<AuthConfig | null> {
  const state: CaptureState = {
    value: {
      cookie: "",
      token: "",
      extraHeaders: {},
      count: 0,
      resolved: false,
    },
  };

  return new Promise<AuthConfig | null>(resolve => {
    const finish = (auth: AuthConfig | null) => {
      if (state.value.resolved) return;
      state.value = { ...state.value, resolved: true };
      resolve(auth);
    };

    context.on("request", (request: PwRequest) => {
      void (async () => {
        if (state.value.resolved) return;
        if (!API_RESOURCE_TYPES.has(request.resourceType())) return;

        const reqHost = safeHostname(request.url());
        if (!reqHost || !reqHost.endsWith(rootDomain)) return;

        const headers = await request.allHeaders().catch(() => null);
        if (!headers || state.value.resolved) return;

        processCapturedRequest(request, headers, state);

        if (state.value.count >= MIN_CAPTURE_REQUESTS) {
          console.log(chalk.green("\n  Auth captured!"));
          finish(buildCapturedAuth(state));
        }
      })();
    });

    const timeout = setTimeout(() => {
      if (!state.value.resolved) {
        console.log(
          chalk.yellow(
            "\n  Timed out waiting for API requests. Try clicking around more."
          )
        );
        finish(buildCapturedAuth(state));
      }
    }, 60000);

    context.on("close", () => {
      clearTimeout(timeout);
      if (!state.value.resolved) {
        state.value = { ...state.value, resolved: true };
        resolve(buildCapturedAuth(state));
      }
    });
  });
}

/**
 * Extracts the root domain from a full hostname (e.g. "www.example.com" → "example.com")
 * @param url - the full URL to extract root domain from
 * @returns the root domain string
 */
function extractRootDomain(url: string): string {
  const fullHost = new URL(url).hostname;
  const hostParts = fullHost.replace(/^www\./, "").split(".");
  return hostParts.length >= 2 ? hostParts.slice(-2).join(".") : fullHost;
}

/**
 * Closes the browser and cleans up temp files
 * @param context - the browser context to close
 * @param userDataDir - the temp directory to remove
 */
async function closeBrowser(
  context: BrowserContext,
  userDataDir: string
): Promise<void> {
  const closeSpinner = ora("Closing browser...").start();
  try {
    await context.close();
    closeSpinner.succeed("Browser closed");
  } catch {
    closeSpinner.warn("Browser closed");
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Launches a Playwright browser and captures auth credentials from API traffic.
 * The user logs in manually and the function captures cookies, tokens, and extra headers.
 * @param url - the URL to navigate to for login
 * @returns the captured AuthConfig, or null if no auth was detected
 */
export async function captureAuth(url: string): Promise<AuthConfig | null> {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "api-creator-auth-")
  );
  const spinner = ora("Launching browser...").start();
  const context = await launchContext(userDataDir, spinner);
  const page = context.pages()[0] ?? (await context.newPage());
  const rootDomain = extractRootDomain(url);
  const auth = await promptAndCapture(url, page, context, rootDomain, spinner);

  process.stdin.pause();
  console.log("");
  await closeBrowser(context, userDataDir);

  return auth;
}

/**
 * Guides the user through login and captures auth from subsequent API traffic
 * @param url - the URL to navigate to
 * @param page - the Playwright page to navigate
 * @param context - the browser context to capture requests from
 * @param rootDomain - the root domain to filter requests by
 * @param spinner - the spinner to mark as succeeded
 * @returns the captured AuthConfig or null
 */
async function promptAndCapture(
  url: string,
  page: Awaited<ReturnType<BrowserContext["newPage"]>>,
  context: BrowserContext,
  rootDomain: string,
  spinner: ReturnType<typeof ora>
): Promise<AuthConfig | null> {
  spinner.succeed("Browser launched");
  console.log(chalk.blue(`\nNavigating to ${url}...`));
  page.goto(url).catch(() => {});
  console.log(chalk.white.bold("\n  Log in to your account in the browser."));
  console.log(
    chalk.white.bold("  Once logged in, press Enter here to capture auth.\n")
  );
  await waitForEnter();
  console.log(
    chalk.gray(
      "  Capturing auth... Click around in the browser to trigger API calls.\n"
    )
  );

  return captureFromRequests(context, rootDomain);
}
