import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import chalk from "chalk";

export const testCommand = new Command("test")
  .description("Test the generated API client by calling its endpoints")
  .option(
    "--dir <path>",
    "Directory containing the generated client",
    "./generated"
  )
  .option("--cookie <cookie>", "Cookie string for authentication")
  .option("--token <token>", "Bearer token for authentication")
  .option("--api-key <key>", "API key for authentication")
  .option("--base-url <url>", "Base URL override")
  .option("--endpoint <name>", "Test a specific endpoint method by name")
  .option("--list", "List all available endpoints without calling them")
  .action(async options => {
    try {
      const dir = resolve(options.dir);
      const clientPath = join(dir, "client.ts");

      let clientSource: string;
      try {
        clientSource = await readFile(clientPath, "utf-8");
      } catch {
        console.error(
          chalk.red(`\n  No generated client found at ${clientPath}`)
        );
        console.error(chalk.gray("  Run `api-creator generate` first.\n"));
        process.exit(1);
      }

      // Parse endpoints from the generated client source
      const endpoints = parseEndpoints(clientSource);

      if (endpoints.length === 0) {
        console.error(
          chalk.red("\n  No endpoints found in the generated client.\n")
        );
        process.exit(1);
      }

      // --list mode: just show what's available
      if (options.list) {
        console.log(
          chalk.blue.bold(
            `\n  ${endpoints.length} endpoints in ${clientPath}:\n`
          )
        );
        for (const ep of endpoints) {
          const params =
            ep.params.length > 0 ? chalk.gray(`(${ep.params.join(", ")})`) : "";
          console.log(
            `  ${chalk.white(ep.method.padEnd(7))} ${chalk.cyan(ep.name)}${params}`
          );
        }
        console.log("");
        return;
      }

      // Extract base URL and auth type from the generated source
      const baseUrl = options.baseUrl ?? extractBaseUrl(clientSource);
      if (!baseUrl) {
        console.error(
          chalk.red(
            "\n  Could not determine base URL. Use --base-url to specify one.\n"
          )
        );
        process.exit(1);
      }

      const authConfig = buildAuthHeaders(clientSource, options);
      if (!authConfig.hasAuth) {
        console.log(
          chalk.yellow("\n  No auth provided. Requests may fail with 401/403.")
        );
        console.log(
          chalk.gray("  Use --cookie, --token, or --api-key to authenticate.\n")
        );
      }

      // Run health check first
      console.log(chalk.blue.bold("\n  Testing API client\n"));
      console.log(chalk.gray(`  Base URL: ${baseUrl}`));
      console.log(chalk.gray(`  Auth: ${authConfig.description}\n`));

      // Pick endpoints to test
      const toTest = options.endpoint
        ? endpoints.filter(e => e.name === options.endpoint)
        : selectTestEndpoints(endpoints);

      if (options.endpoint && toTest.length === 0) {
        console.error(chalk.red(`  Endpoint "${options.endpoint}" not found.`));
        console.log(
          chalk.gray("  Run with --list to see available endpoints.\n")
        );
        process.exit(1);
      }

      // Health check
      const healthEndpoint = findHealthCheckEndpoint(endpoints);
      if (healthEndpoint) {
        await testEndpoint(
          baseUrl,
          healthEndpoint,
          authConfig.headers,
          "health check"
        );
      }

      // Test selected endpoints
      console.log(chalk.blue(`  Testing ${toTest.length} endpoint(s)...\n`));

      let passed = 0;
      let failed = 0;

      for (const ep of toTest) {
        const ok = await testEndpoint(baseUrl, ep, authConfig.headers);
        if (ok) passed++;
        else failed++;
      }

      // Summary
      console.log("");
      if (failed === 0) {
        console.log(
          chalk.green.bold(
            `  All ${passed} endpoint(s) responded successfully.`
          )
        );
      } else {
        console.log(chalk.yellow(`  ${passed} passed, ${failed} failed.`));
      }
      console.log("");
    } catch (error) {
      console.error(
        chalk.red(
          `  Error: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

/**
 *
 */
interface ParsedEndpoint {
  name: string;
  method: string;
  path: string;
  params: string[];
  hasBody: boolean;
  hasQueryParams: boolean;
}

/**
 *
 * @param source
 */
function parseEndpoints(source: string): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];

  // Match method definitions: async methodName(params): Promise<Type> {
  const methodRegex = /async (\w+)\(([^)]*)\):\s*Promise<[^>]+>\s*\{/g;
  // Match the fetch call inside to get path and HTTP method
  const fetchRegex = /this\._fetch\(([^,]+),\s*\{[^}]*method:\s*'(\w+)'/gs;

  let match;
  while ((match = methodRegex.exec(source)) !== null) {
    const name = match[1];
    const paramsStr = match[2];

    // Skip private methods and healthCheck
    if (name.startsWith("_") || name === "healthCheck") continue;

    // Find the corresponding fetch call after this method declaration
    const methodStart = match.index;
    const nextMethodMatch = methodRegex.exec(source);
    const methodEnd = nextMethodMatch ? nextMethodMatch.index : source.length;
    // Reset regex to where it was
    methodRegex.lastIndex = nextMethodMatch
      ? nextMethodMatch.index
      : source.length;

    const methodBody = source.slice(methodStart, methodEnd);

    const fetchMatch = fetchRegex.exec(methodBody);
    fetchRegex.lastIndex = 0;

    let httpMethod = "GET";
    let path = "/";

    if (fetchMatch) {
      httpMethod = fetchMatch[2];
      // Extract path from the first argument
      const pathArg = fetchMatch[1].trim();
      // Could be a template literal or string
      path = pathArg.replace(/[`'"]/g, "").replace(/\$\{[^}]+\}/g, ":param");
    }

    const params = paramsStr.trim()
      ? paramsStr
          .split(",")
          .map(p => p.trim().split(":")[0].trim())
          .filter(Boolean)
      : [];
    const hasBody = params.includes("body");
    const hasQueryParams =
      params.some(p => p === "options?") || paramsStr.includes("options?");

    endpoints.push({
      name,
      method: httpMethod,
      path,
      params,
      hasBody,
      hasQueryParams,
    });
  }

  return endpoints;
}

/**
 *
 * @param source
 */
function extractBaseUrl(source: string): string | null {
  // Look for default base URL in constructor: constructor(baseUrl: string = 'https://...'
  const match = source.match(/constructor\(baseUrl:\s*string\s*=\s*'([^']+)'/);
  return match ? match[1] : null;
}

/**
 *
 * @param source
 * @param options
 * @param options.cookie
 * @param options.token
 * @param options.apiKey
 */
function buildAuthHeaders(
  source: string,
  options: { cookie?: string; token?: string; apiKey?: string }
): { headers: Record<string, string>; hasAuth: boolean; description: string } {
  const headers: Record<string, string> = {};

  if (options.cookie) {
    headers["Cookie"] = options.cookie;
    return { headers, hasAuth: true, description: "cookie" };
  }

  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
    return { headers, hasAuth: true, description: "bearer token" };
  }

  if (options.apiKey) {
    // Try to detect the header name from the source
    const apiKeyMatch = source.match(
      /headers\.set\('(X-[^']+)',\s*this\.auth\.apiKey\)/
    );
    const headerName = apiKeyMatch ? apiKeyMatch[1] : "X-API-Key";
    headers[headerName] = options.apiKey;
    return { headers, hasAuth: true, description: `API key (${headerName})` };
  }

  return { headers, hasAuth: false, description: "none" };
}

/**
 *
 * @param endpoints
 */
function findHealthCheckEndpoint(
  endpoints: ParsedEndpoint[]
): ParsedEndpoint | null {
  // Find a simple GET with no params — good for a health check
  return (
    endpoints.find(
      e => e.method === "GET" && e.params.length === 0 && !e.hasBody
    ) ?? null
  );
}

/**
 *
 * @param endpoints
 */
function selectTestEndpoints(endpoints: ParsedEndpoint[]): ParsedEndpoint[] {
  // Pick up to 5 GET endpoints that don't require path params (safest to call)
  const safe = endpoints.filter(
    e => e.method === "GET" && !e.params.some(p => p.endsWith("Id"))
  );

  if (safe.length > 0) return safe.slice(0, 5);

  // Fallback: just pick the first 5 GET endpoints
  const gets = endpoints.filter(e => e.method === "GET");
  return gets.slice(0, 5);
}

/**
 *
 * @param baseUrl
 * @param endpoint
 * @param authHeaders
 * @param label
 */
async function testEndpoint(
  baseUrl: string,
  endpoint: ParsedEndpoint,
  authHeaders: Record<string, string>,
  label?: string
): Promise<boolean> {
  const displayName = label ?? endpoint.name;

  // Build the URL — replace :param with a placeholder
  const path = endpoint.path;
  if (
    path.includes(":param") ||
    path.includes(":id") ||
    path.includes(":hash")
  ) {
    console.log(
      chalk.gray(`  skip  `) +
        chalk.white(displayName) +
        chalk.gray(" (requires path parameters)")
    );
    return true; // Don't count as failure
  }

  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method: endpoint.method === "GET" ? "GET" : "HEAD",
      headers: {
        ...authHeaders,
        Accept: "application/json",
      },
      redirect: "follow",
    });

    const status = response.status;
    const statusColor =
      status < 300 ? chalk.green : status < 400 ? chalk.yellow : chalk.red;

    console.log(
      `  ${statusColor(String(status).padEnd(4))} ${chalk.white(displayName)} ${chalk.gray(`${endpoint.method} ${path}`)}`
    );

    if (status === 401 || status === 403) {
      console.log(
        chalk.yellow(
          "        ^ Session expired or invalid auth. Use --cookie or --token."
        )
      );
      return false;
    }

    return status < 400;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(
      `  ${chalk.red("ERR ")} ${chalk.white(displayName)} ${chalk.gray(msg)}`
    );
    return false;
  }
}
