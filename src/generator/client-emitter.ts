import type { Endpoint } from "../types/endpoint.js";
import type { AuthInfo } from "../types/auth.js";
import type { TypeDefinition } from "../parser/type-inferrer.js";
import { pathToTypeName } from "../utils/naming.js";
import {
  emitEndpointMethod,
  emitHealthCheck,
} from "./client-method-emitter.js";

/** Bearer-token auth header lines, reused by both specific and fallback auth. */
const AUTH_TOKEN_LINES = [
  "    if (this.auth.token) {",
  "      headers.set('Authorization', `Bearer ${this.auth.token}`);",
  "    }",
] as const;

/**
 * Options controlling what client code gets generated.
 */
export interface EmitClientOptions {
  /** All API endpoints to generate methods for. */
  endpoints: Endpoint[];
  /** Inferred response type definitions. */
  types: TypeDefinition[];
  /** Inferred request body type definitions. */
  requestTypes: TypeDefinition[];
  /** Authentication strategies detected in captured traffic. */
  auth: AuthInfo[];
  /** Base URL of the target API. */
  baseUrl: string;
  /** Optional class name override; defaults to "ApiClient". */
  name?: string;
  /** The original URL the spec was captured from, used in JSDoc. */
  originalUrl?: string;
}

/**
 * Returns the static boilerplate lines that appear before the main class declaration.
 * @returns source lines for SESSION_HELP, ApiError, AuthConfig, and HealthCheckResult
 */
function emitBoilerplate(): string[] {
  return [
    "export const SESSION_HELP =",
    "  'Your session token may have expired. ' +",
    "  'To renew: log in to the web application in your browser, ' +",
    "  'copy the new token from the request headers (or cookies), ' +",
    "  'and pass it to the client constructor.';",
    "",
    "export class ApiError extends Error {",
    "  status: number;",
    "  body: unknown;",
    "",
    "  constructor(status: number, body: unknown) {",
    "    const hint = status === 401 || status === 403 ? ` — ${SESSION_HELP}` : '';",
    "    super(`API request failed with status ${status}${hint}`);",
    "    this.name = 'ApiError';",
    "    this.status = status;",
    "    this.body = body;",
    "  }",
    "}",
    "",
    "export interface AuthConfig {",
    "  token?: string;",
    "  cookie?: string;",
    "  apiKey?: string;",
    "  extraHeaders?: Record<string, string>;",
    "}",
    "",
    "export interface HealthCheckResult {",
    "  valid: boolean;",
    "  status: number;",
    "  message: string;",
    "}",
    "",
  ];
}

/**
 * Generates the full TypeScript client source file as a string.
 * @param options - configuration for the client to generate
 * @returns the complete generated TypeScript source text
 */
export function emitClient(options: EmitClientOptions): string {
  const { endpoints, types, requestTypes, auth, baseUrl, name, originalUrl } =
    options;
  const className = name ?? "ApiClient";
  const primaryAuth = auth.length > 0 ? auth[0] : null;
  const urlNote = originalUrl
    ? ` Originally captured from ${originalUrl}.`
    : "";

  const typeNames = collectTypeImports(endpoints, types, requestTypes);
  const importLines =
    typeNames.length > 0
      ? [`import type { ${typeNames.join(", ")} } from './types.js';`, ""]
      : [];

  const authJsDoc = primaryAuth
    ? [
        ` * Authentication: ${primaryAuth.type} (${primaryAuth.location}: ${primaryAuth.key})`,
        " *",
      ]
    : [];

  const classJsDoc = [
    "/**",
    ` * ${className} — auto-generated typed API client.${urlNote}`,
    " *",
    ...authJsDoc,
    " * If you receive 401/403 errors, your session token has likely expired.",
    " * To renew: log in to the web application in your browser, copy the",
    " * updated token from the request headers (or cookies), and pass it to",
    " * the constructor.",
    " */",
  ];

  return [
    ...importLines,
    ...emitBoilerplate(),
    ...classJsDoc,
    `export class ${className} {`,
    "  private baseUrl: string;",
    "  private auth: AuthConfig;",
    "",
    `  constructor(baseUrl: string = '${baseUrl}', auth: AuthConfig = {}) {`,
    "    this.baseUrl = baseUrl.replace(/\\/+$/, '');",
    "    this.auth = auth;",
    "  }",
    "",
    ...emitFetchHelper(primaryAuth),
    ...emitHealthCheck(endpoints),
    ...endpoints.flatMap(ep => emitEndpointMethod(ep, types, requestTypes)),
    "}",
    "",
  ].join("\n");
}

/**
 * Collects all type names that need to be imported from the types module,
 * including nested types referenced by response and request type properties.
 * @param endpoints - the API endpoints to scan for type references
 * @param types - all available response type definitions
 * @param requestTypes - all available request type definitions
 * @returns a sorted list of type names to import
 */
function collectTypeImports(
  endpoints: Endpoint[],
  types: TypeDefinition[],
  requestTypes: TypeDefinition[]
): string[] {
  const allTypeNames = new Set([
    ...types.map(t => t.name),
    ...requestTypes.map(t => t.name),
  ]);

  const collected = endpoints.reduce<string[]>((acc, endpoint) => {
    const responseTypeName = pathToTypeName(
      endpoint.method,
      endpoint.normalizedPath
    );
    const requestTypeName = responseTypeName.replace(/Response$/, "Request");

    const withResponse = allTypeNames.has(responseTypeName)
      ? [
          ...acc,
          responseTypeName,
          ...gatherNested(responseTypeName, types, acc),
        ]
      : acc;
    return allTypeNames.has(requestTypeName)
      ? [
          ...withResponse,
          requestTypeName,
          ...gatherNested(requestTypeName, requestTypes, withResponse),
        ]
      : withResponse;
  }, []);

  return [...new Set(collected)].sort((a, b) => a.localeCompare(b));
}

/**
 * Recursively gathers nested type names referenced by a given type's properties,
 * skipping names already in the already-collected list.
 * @param typeName - the type whose nested references to walk
 * @param allTypes - all type definitions to search within
 * @param already - names already accumulated (used to skip duplicates)
 * @returns a flat list of newly discovered nested type names
 */
function gatherNested(
  typeName: string,
  allTypes: TypeDefinition[],
  already: string[]
): string[] {
  const typeDef = allTypes.find(t => t.name === typeName);
  if (!typeDef) return [];

  return typeDef.properties.flatMap(prop => {
    if (!prop.nestedType || already.includes(prop.nestedType.name)) return [];
    return [
      prop.nestedType.name,
      ...gatherNested(prop.nestedType.name, allTypes, [
        ...already,
        prop.nestedType.name,
      ]),
    ];
  });
}

/**
 * Returns the auth header lines for a specific auth type.
 * @param authType - the auth scheme ("bearer", "cookie", or "api-key")
 * @param authKey - the header key name for api-key schemes
 * @returns source lines that set the appropriate request header
 */
function getSpecificAuthLines(authType: string, authKey: string): string[] {
  switch (authType) {
    case "cookie":
      return [
        "    if (this.auth.cookie) {",
        "      headers.set('Cookie', this.auth.cookie);",
        "    }",
      ];
    case "api-key":
      return [
        "    if (this.auth.apiKey) {",
        `      headers.set('${authKey}', this.auth.apiKey);`,
        "    }",
      ];
    default:
      return [...AUTH_TOKEN_LINES];
  }
}

/**
 * Generates the private `_fetch` helper method source lines for the client class,
 * wiring up auth headers based on the detected primary auth strategy.
 * @param primaryAuth - the primary auth info, or null if none detected
 * @returns source lines for the _fetch method
 */
function emitFetchHelper(primaryAuth: AuthInfo | null): string[] {
  const authLines = primaryAuth
    ? getSpecificAuthLines(primaryAuth.type, primaryAuth.key)
    : [
        ...AUTH_TOKEN_LINES,
        "    if (this.auth.cookie) {",
        "      headers.set('Cookie', this.auth.cookie);",
        "    }",
        "    if (this.auth.apiKey) {",
        "      headers.set('X-API-Key', this.auth.apiKey);",
        "    }",
      ];

  return [
    "  private async _fetch(path: string, init: RequestInit = {}): Promise<Response> {",
    "    const headers = new Headers(init.headers);",
    "",
    ...authLines,
    "",
    "    // Apply any extra headers from auth config",
    "    if (this.auth.extraHeaders) {",
    "      for (const [key, value] of Object.entries(this.auth.extraHeaders)) {",
    "        headers.set(key, value);",
    "      }",
    "    }",
    "",
    "    const response = await fetch(`${this.baseUrl}${path}`, {",
    "      ...init,",
    "      headers,",
    "    });",
    "",
    "    return response;",
    "  }",
    "",
  ];
}
