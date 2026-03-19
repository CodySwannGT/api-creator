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
 *
 * @param url
 */
export async function captureAuth(url: string): Promise<AuthConfig | null> {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "api-creator-auth-")
  );

  const spinner = ora("Launching browser...").start();

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
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

  spinner.succeed("Browser launched");

  const page = context.pages()[0] ?? (await context.newPage());

  const fullHost = new URL(url).hostname;
  const hostParts = fullHost.replace(/^www\./, "").split(".");
  const rootDomain =
    hostParts.length >= 2 ? hostParts.slice(-2).join(".") : fullHost;

  console.log(chalk.blue(`\nNavigating to ${url}...`));
  page.goto(url).catch(() => {});

  // Step 1: Wait for user to confirm they're logged in
  console.log(chalk.white.bold("\n  Log in to your account in the browser."));
  console.log(
    chalk.white.bold("  Once logged in, press Enter here to capture auth.\n")
  );

  await new Promise<void>(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => {
      resolve();
    });
  });

  console.log(
    chalk.gray(
      "  Capturing auth... Click around in the browser to trigger API calls.\n"
    )
  );

  // Step 2: Now listen for API requests and capture headers
  let capturedCookie = "";
  let capturedToken = "";
  const capturedExtraHeaders: Record<string, string> = {};
  let capturedCount = 0;
  let resolved = false;

  const auth = await new Promise<AuthConfig | null>(resolve => {
    const finish = (auth: AuthConfig | null) => {
      if (resolved) return;
      resolved = true;
      resolve(auth);
    };

    context.on("request", (request: PwRequest) => {
      void (async () => {
        if (resolved) return;
        if (!API_RESOURCE_TYPES.has(request.resourceType())) return;

        let reqHost: string;
        try {
          reqHost = new URL(request.url()).hostname;
        } catch {
          return;
        }
        if (!reqHost.endsWith(rootDomain)) return;

        let headers: Record<string, string>;
        try {
          headers = await request.allHeaders();
        } catch {
          return;
        }

        if (resolved) return;

        const cookie = headers["cookie"] || "";
        if (cookie.length > 100) {
          capturedCookie = cookie;
        }

        const authHeader = headers["authorization"];
        if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
          capturedToken = authHeader.replace(/^[Bb]earer\s+/, "");
        }

        for (const [name, value] of Object.entries(headers)) {
          const lower = name.toLowerCase();
          if (SKIP_HEADERS.has(lower)) continue;
          if (lower.startsWith("sec-")) continue;
          if (
            lower.startsWith("x-") &&
            value &&
            !lower.startsWith("x-client-") &&
            lower !== "x-csrf-without-token" &&
            lower !== "x-requested-with"
          ) {
            capturedExtraHeaders[name] = value;
          }
        }

        if (capturedCookie || capturedToken) {
          capturedCount++;
          const shortPath = new URL(request.url()).pathname.slice(0, 60);
          console.log(
            chalk.cyan(
              `  ✓ ${request.method()} ${shortPath} (${capturedCount}/${MIN_CAPTURE_REQUESTS})`
            )
          );

          if (capturedCount >= MIN_CAPTURE_REQUESTS) {
            console.log(chalk.green("\n  Auth captured!"));
            const auth: AuthConfig = {};
            if (capturedCookie) auth.cookie = capturedCookie;
            if (capturedToken) auth.token = capturedToken;
            if (Object.keys(capturedExtraHeaders).length > 0) {
              auth.extraHeaders = { ...capturedExtraHeaders };
            }
            finish(auth);
          }
        }
      })();
    });

    // Timeout after 60 seconds of no captures
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.log(
          chalk.yellow(
            "\n  Timed out waiting for API requests. Try clicking around more."
          )
        );
        const auth: AuthConfig = {};
        if (capturedCookie) auth.cookie = capturedCookie;
        if (capturedToken) auth.token = capturedToken;
        if (Object.keys(capturedExtraHeaders).length > 0)
          auth.extraHeaders = { ...capturedExtraHeaders };
        finish(capturedCount > 0 ? auth : null);
      }
    }, 60000);

    context.on("close", () => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        const auth: AuthConfig = {};
        if (capturedCookie) auth.cookie = capturedCookie;
        if (capturedToken) auth.token = capturedToken;
        if (Object.keys(capturedExtraHeaders).length > 0)
          auth.extraHeaders = { ...capturedExtraHeaders };
        resolve(capturedCount > 0 ? auth : null);
      }
    });
  });

  // Step 3: Close browser
  if (!resolved) resolved = true;
  process.stdin.pause();
  console.log("");
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

  return auth;
}
