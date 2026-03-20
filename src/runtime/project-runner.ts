/**
 * Dynamically registers project subcommands based on manifest files
 * stored in ~/.api-creator/projects/<name>/.
 */

import { Command } from "commander";
import chalk from "chalk";

import {
  listProjects,
  loadManifest,
  loadAuth,
  saveAuth,
  clearAuth,
} from "./project-manager.js";
import type { ProjectManifest } from "./project-manager.js";
import { parseAuthFromCurl } from "./curl-parser.js";
import type { AuthConfig } from "./curl-parser.js";
import { captureAuth } from "../recorder/auth-capture.js";
import { registerEndpointCommand } from "./endpoint-command-builder.js";

/**
 * Register a subcommand for every project found in ~/.api-creator/projects/.
 * @param program - the root Commander program to register project subcommands on
 */
export function registerProjectCommands(program: Command): void {
  const projects = listProjects();

  for (const projectName of projects) {
    const manifest = loadManifest(projectName);
    if (!manifest) continue;

    const projectCmd = program
      .command(projectName)
      .description(
        `CLI for ${manifest.originalUrl} (${manifest.endpoints.length} endpoints)`
      );

    // Auth subcommands
    registerAuthCommands(projectCmd, projectName, manifest);

    // Endpoint subcommands
    for (const endpoint of manifest.endpoints) {
      registerEndpointCommand(projectCmd, projectName, manifest, endpoint);
    }
  }
}

// ── Auth commands ───────────────────────────────────────────────────────

/**
 * Reads stdin until EOF and returns all data as a string.
 * @returns the full stdin content as a UTF-8 string
 */
async function readStdinChunks(): Promise<string> {
  const chunks: string[] = [];

  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk as string); // eslint-disable-line functional/immutable-data -- collecting stream chunks requires mutation
  }

  return chunks.join("");
}

/**
 * Reads auth from a curl command source (file or stdin).
 * @param options - the auth setup options
 * @param options.file - optional file path to read curl from
 * @returns the parsed AuthConfig or null if parsing fails
 */
async function readCurlAuthInput(options: { file?: string }): Promise<string> {
  if (options.file) {
    const { readFileSync } = await import("node:fs");
    return readFileSync(options.file, "utf-8");
  }
  return readStdinChunks();
}

/**
 * Handles the auth setup action for curl-based auth (file or stdin).
 * @param projectName - the project name to save auth under
 * @param options - the auth setup options with optional file and stdin flags
 * @param options.file optional file path to read curl from
 * @param options.stdin whether to read from piped stdin
 * @returns true if auth was saved, false otherwise
 */
async function handleCurlAuth(
  projectName: string,
  options: { file?: string; stdin?: boolean }
): Promise<boolean> {
  const input = await readCurlAuthInput(options);

  if (!input.trim()) {
    console.error("No input provided.");
    process.exit(1);
  }

  const parsed = parseAuthFromCurl(input);
  if (parsed) {
    saveAuth(projectName, parsed);
    printAuthSummary(parsed);
    return true;
  }

  console.error(
    "Could not parse auth from input. Make sure it is a valid cURL command."
  );
  process.exit(1);
}

/**
 * Registers the auth management subcommands (setup, status, clear) on a project command.
 * @param projectCmd - the parent Commander command for this project
 * @param projectName - the project name used for storage lookups
 * @param manifest - the project manifest containing the original URL for browser auth
 */
function registerAuthCommands(
  projectCmd: Command,
  projectName: string,
  manifest: ProjectManifest
): void {
  const authCmd = projectCmd
    .command("auth")
    .description("Manage authentication");

  // auth setup
  authCmd
    .command("setup")
    .description("Capture auth by logging in via browser")
    .option(
      "-f, --file <path>",
      "Read auth from a cURL command file instead of browser"
    )
    .option(
      "--stdin",
      "Read auth from piped stdin (e.g. pbpaste | api-creator ...)"
    )
    .action(async (options: { file?: string; stdin?: boolean }) => {
      if (
        options.file ||
        options.stdin ||
        (!process.stdin.isTTY && options.file !== undefined)
      ) {
        await handleCurlAuth(projectName, options);
        return;
      }

      // Default: launch browser to capture auth
      console.log("");
      const auth = await captureAuth(manifest.originalUrl);
      if (auth) {
        saveAuth(projectName, auth);
        console.log("");
        printAuthSummary(auth);
      } else {
        console.error(
          chalk.red(
            "No auth detected. Make sure you logged in and browsed around."
          )
        );
        process.exit(1);
      }
    });

  // auth status
  authCmd
    .command("status")
    .description("Check if authentication is configured")
    .action(() => {
      const auth = loadAuth(projectName);
      if (!auth) {
        console.log(
          `Not configured. Run: api-creator ${projectName} auth setup`
        );
        return;
      }
      console.log("Auth is configured.");
      if (auth.cookie) console.log("  Type: cookie");
      if (auth.token) console.log("  Type: bearer token");
      if (auth.apiKey) console.log("  Type: API key");
      if (auth.extraHeaders)
        console.log(
          `  Extra headers: ${Object.keys(auth.extraHeaders).length}`
        );
    });

  // auth clear
  authCmd
    .command("clear")
    .description("Remove stored authentication credentials")
    .action(() => {
      clearAuth(projectName);
      console.log("Auth cleared.");
    });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Prints a summary of the captured auth credentials to stdout.
 * @param auth - the AuthConfig whose contents to summarize
 */
function printAuthSummary(auth: AuthConfig): void {
  const parts = [
    ...(auth.cookie ? ["cookie"] : []),
    ...(auth.token ? ["bearer token"] : []),
    ...(auth.apiKey ? ["API key"] : []),
    ...(auth.extraHeaders
      ? [`${Object.keys(auth.extraHeaders).length} extra header(s)`]
      : []),
  ];
  console.log(`${chalk.green("Auth saved.")} Extracted: ${parts.join(", ")}`);
}
