import chalk from "chalk";

/**
 * Represents a parsed endpoint extracted from a generated client source file.
 */
export interface ParsedEndpoint {
  name: string;
  method: string;
  path: string;
  params: string[];
  hasBody: boolean;
  hasQueryParams: boolean;
}

/**
 * Extracts HTTP method and path from a method body by finding the _fetch call
 * @param methodBody - the source code of the method body
 * @returns the HTTP method and path, or defaults if not found
 */
function extractFetchInfo(methodBody: string): {
  httpMethod: string;
  path: string;
} {
  const fetchMatch = /this\._fetch\(([^,]+),\s*\{[^}]*method:\s*'(\w+)'/s.exec(
    methodBody
  );
  const httpMethod = fetchMatch ? fetchMatch[2] : "GET";
  const path = fetchMatch
    ? fetchMatch[1]
        .trim()
        .replace(/[`'"]/g, "")
        .replace(/\$\{[^}]+\}/g, ":param")
    : "/";
  return { httpMethod, path };
}

/**
 * Parse endpoint method definitions from the generated client source code.
 * @param source - the generated client TypeScript source code
 * @returns the parsed endpoints
 */
export function parseEndpoints(source: string): ParsedEndpoint[] {
  const methodRegex = /async (\w+)\(([^)]*)\):\s*Promise<[^>]+>\s*\{/g;
  const matches = [...source.matchAll(methodRegex)];

  return matches.flatMap((methodMatch, i) => {
    const name = methodMatch[1];
    const paramsStr = methodMatch[2];

    if (name.startsWith("_") || name === "healthCheck") return [];

    const methodStart = methodMatch.index;
    const methodEnd =
      i + 1 < matches.length ? matches[i + 1].index : source.length;
    const methodBody = source.slice(methodStart, methodEnd);

    const { httpMethod, path } = extractFetchInfo(methodBody);

    const params = paramsStr.trim()
      ? paramsStr
          .split(",")
          .map(p => p.trim().split(":")[0].trim())
          .filter(Boolean)
      : [];

    return [
      {
        name,
        method: httpMethod,
        path,
        params,
        hasBody: params.includes("body"),
        hasQueryParams:
          params.some(p => p === "options?") || paramsStr.includes("options?"),
      },
    ];
  });
}

/**
 * Extract the default base URL from the generated client constructor.
 * @param source - the generated client TypeScript source code
 * @returns the base URL or null if not found
 */
export function extractBaseUrl(source: string): string | null {
  const match = /constructor\(baseUrl:\s*string\s*=\s*'([^']+)'/.exec(source);
  return match ? match[1] : null;
}

/**
 * Build auth headers from command-line options and the generated client source.
 * @param source - the generated client TypeScript source code
 * @param options - the CLI options with auth credentials
 * @param options.cookie optional cookie string for cookie-based auth
 * @param options.token optional bearer token string
 * @param options.apiKey optional API key string
 * @returns auth headers, flag, and description
 */
export function buildAuthHeaders(
  source: string,
  options: { cookie?: string; token?: string; apiKey?: string }
): { headers: Record<string, string>; hasAuth: boolean; description: string } {
  if (options.cookie) {
    return {
      headers: { Cookie: options.cookie },
      hasAuth: true,
      description: "cookie",
    };
  }

  if (options.token) {
    return {
      headers: { Authorization: `Bearer ${options.token}` },
      hasAuth: true,
      description: "bearer token",
    };
  }

  if (options.apiKey) {
    const apiKeyMatch =
      /headers\.set\('(X-[^']+)',\s*this\.auth\.apiKey\)/.exec(source);
    const headerName = apiKeyMatch ? apiKeyMatch[1] : "X-API-Key";
    return {
      headers: { [headerName]: options.apiKey },
      hasAuth: true,
      description: `API key (${headerName})`,
    };
  }

  return { headers: {}, hasAuth: false, description: "none" };
}

/**
 * Find a simple GET endpoint with no parameters for use as a health check.
 * @param endpoints - the parsed endpoints
 * @returns a suitable health check endpoint or null
 */
export function findHealthCheckEndpoint(
  endpoints: ParsedEndpoint[]
): ParsedEndpoint | null {
  return (
    endpoints.find(
      e => e.method === "GET" && e.params.length === 0 && !e.hasBody
    ) ?? null
  );
}

/**
 * Select up to 5 safe GET endpoints for testing.
 * @param endpoints - the parsed endpoints
 * @returns the selected endpoints
 */
export function selectTestEndpoints(
  endpoints: ParsedEndpoint[]
): ParsedEndpoint[] {
  const safe = endpoints.filter(
    e => e.method === "GET" && !e.params.some(p => p.endsWith("Id"))
  );

  if (safe.length > 0) return safe.slice(0, 5);

  const gets = endpoints.filter(e => e.method === "GET");
  return gets.slice(0, 5);
}

/**
 * Test a single endpoint by making an HTTP request and reporting the result.
 * @param baseUrl - the API base URL
 * @param endpoint - the endpoint to test
 * @param authHeaders - the auth headers to include
 * @param label - optional display label
 * @returns true if the test passed
 */
export async function testEndpoint(
  baseUrl: string,
  endpoint: ParsedEndpoint,
  authHeaders: Record<string, string>,
  label?: string
): Promise<boolean> {
  const displayName = label ?? endpoint.name;

  const { path } = endpoint;
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
    return true;
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

    const { status } = response;
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
