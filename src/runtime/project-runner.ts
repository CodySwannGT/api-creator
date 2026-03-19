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
import type { ProjectManifest, ManifestEndpoint } from "./project-manager.js";
import { parseAuthFromCurl } from "./curl-parser.js";
import type { AuthConfig } from "./curl-parser.js";
import { httpRequest, HttpError } from "./http-client.js";
import { captureAuth } from "../recorder/auth-capture.js";

/**
 * Register a subcommand for every project found in ~/.api-creator/projects/.
 * @param program
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
 *
 * @param projectCmd
 * @param projectName
 * @param manifest
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
      // File or explicit --stdin: parse cURL
      if (
        options.file ||
        options.stdin ||
        (!process.stdin.isTTY && options.file !== undefined)
      ) {
        let input: string;
        if (options.file) {
          const { readFileSync } = await import("node:fs");
          input = readFileSync(options.file, "utf-8");
        } else {
          const chunks: string[] = [];
          process.stdin.setEncoding("utf8");
          for await (const chunk of process.stdin) {
            chunks.push(chunk as string);
          }
          input = chunks.join("");
        }

        if (!input.trim()) {
          console.error("No input provided.");
          process.exit(1);
        }

        const parsed = parseAuthFromCurl(input);
        if (parsed) {
          saveAuth(projectName, parsed);
          printAuthSummary(parsed);
        } else {
          console.error(
            "Could not parse auth from input. Make sure it is a valid cURL command."
          );
          process.exit(1);
        }
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

// ── Endpoint commands ───────────────────────────────────────────────────

/**
 *
 * @param projectCmd
 * @param projectName
 * @param manifest
 * @param endpoint
 */
function registerEndpointCommand(
  projectCmd: Command,
  projectName: string,
  manifest: ProjectManifest,
  endpoint: ManifestEndpoint
): void {
  const cmd = projectCmd
    .command(endpoint.commandName)
    .description(endpoint.description);

  // Path params as required arguments
  for (const pp of endpoint.pathParams) {
    cmd.argument(`<${pp}>`, `${pp} path parameter`);
  }

  if (endpoint.isGraphQL) {
    // Individual variable fields as options
    if (endpoint.variables) {
      for (const vf of endpoint.variables) {
        const truncExample =
          vf.exampleValue.length > 50
            ? `${vf.exampleValue.substring(0, 47)}...`
            : vf.exampleValue;
        const safeExample = truncExample.replace(/'/g, "\\'");
        cmd.option(
          `--${vf.kebabName} <value>`,
          `${vf.camelName} variable (e.g. "${safeExample}")`
        );
      }
    }

    // Escape hatch: raw --variables JSON
    cmd.option(
      "--variables <json>",
      "Raw variables JSON (overrides individual variable options)"
    );
  }

  // Query params as options
  for (const qp of endpoint.queryParams) {
    if (qp.defaultValue !== undefined) {
      cmd.option(
        `--${qp.name} <value>`,
        `${qp.name} query parameter`,
        qp.defaultValue
      );
    } else {
      cmd.option(`--${qp.name} <value>`, `${qp.name} query parameter`);
    }
  }

  // Body options for POST/PUT/PATCH
  if (endpoint.hasBody) {
    cmd.option("--body <json>", "Request body as JSON string");
    cmd.option(
      "--json <json>",
      "Request body as JSON string (alias for --body)"
    );
  }

  cmd.option("--raw", "Output compact JSON instead of pretty-printed");

  cmd.action(async (...actionArgs: unknown[]) => {
    // Commander passes positional args first, then options, then the Command object
    const pathArgValues: string[] = endpoint.pathParams.map(
      (_, i) => actionArgs[i] as string
    );
    const options = actionArgs[endpoint.pathParams.length] as Record<
      string,
      string | boolean | undefined
    >;

    // Get auth
    const auth = loadAuth(projectName);
    if (!auth) {
      console.error(
        chalk.red(
          `No auth configured. Run: api-creator ${projectName} auth setup`
        )
      );
      process.exit(1);
    }

    // Build the path with substituted path params
    let resolvedPath = endpoint.path;
    for (let i = 0; i < endpoint.pathParams.length; i++) {
      resolvedPath = resolvedPath.replace(":id", pathArgValues[i]);
    }

    // Build query params
    const queryParams: Record<string, string> = {};

    if (endpoint.isGraphQL) {
      // Bake in operationName and extensions
      if (endpoint.operationName) {
        queryParams.operationName = endpoint.operationName;
      }
      if (endpoint.extensions) {
        queryParams.extensions = endpoint.extensions;
      }

      // Build variables from individual options or raw JSON
      let variables: Record<string, unknown> = {};
      if (typeof options.variables === "string") {
        try {
          variables = JSON.parse(options.variables);
        } catch {
          console.error("Invalid JSON for --variables.");
          process.exit(1);
        }
      } else if (endpoint.variables) {
        for (const vf of endpoint.variables) {
          const optionAccessor = kebabToCamel(vf.kebabName);
          const val = options[optionAccessor];
          if (val !== undefined) {
            variables[vf.camelName] = val;
          }
        }
      }
      queryParams.variables = JSON.stringify(variables);
    }

    // Non-GraphQL query params (or remaining params like locale/currency)
    for (const qp of endpoint.queryParams) {
      const val = options[qp.name];
      if (val !== undefined && typeof val === "string") {
        queryParams[qp.name] = val;
      }
    }

    // Body for POST/PUT/PATCH
    let body: unknown;
    if (endpoint.hasBody) {
      const bodyData = (options.body || options.json || "") as string;
      if (bodyData) {
        try {
          body = JSON.parse(bodyData);
        } catch {
          console.error(
            "Invalid JSON body. Provide valid JSON via --body or --json."
          );
          process.exit(1);
        }
      }
    }

    try {
      const result = await httpRequest({
        baseUrl: manifest.baseUrl,
        path: resolvedPath,
        method: endpoint.httpMethod,
        auth,
        queryParams,
        body,
      });

      const output = options.raw
        ? JSON.stringify(result)
        : JSON.stringify(result, null, 2);
      console.log(output);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 401 || error.status === 403) {
          console.error(
            chalk.red(
              `Authentication failed (${error.status}). Run: api-creator ${projectName} auth setup`
            )
          );
        } else {
          console.error(
            chalk.red(`HTTP ${error.status}: ${error.body || error.message}`)
          );
        }
        process.exit(1);
      }
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error))
      );
      process.exit(1);
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 *
 * @param auth
 */
function printAuthSummary(auth: AuthConfig): void {
  const parts: string[] = [];
  if (auth.cookie) parts.push("cookie");
  if (auth.token) parts.push("bearer token");
  if (auth.apiKey) parts.push("API key");
  if (auth.extraHeaders)
    parts.push(`${Object.keys(auth.extraHeaders).length} extra header(s)`);
  console.log(`${chalk.green("Auth saved.")} Extracted: ${parts.join(", ")}`);
}

/**
 *
 * @param str
 */
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
