import type { Endpoint } from "../types/endpoint.js";
import type { TypeDefinition } from "../parser/type-inferrer.js";
import {
  pathToMethodName,
  pathToTypeName,
  singularize,
} from "../utils/naming.js";

/** A single path-parameter segment with its position index and derived name. */
interface PathParamSegment {
  index: number;
  paramName: string;
}

/**
 * Holds all computed signature information for a single endpoint method.
 */
interface MethodInfo {
  methodName: string;
  paramStr: string;
  returnType: string;
  pathParamSegments: PathParamSegment[];
  hasBody: boolean;
  pathExpr: string;
}

/**
 * Extracts path parameter segments from a normalized API path,
 * deriving meaningful names from the preceding path segment.
 * @param normalizedPath - the normalized path with :id placeholders
 * @returns the extracted path parameter segments with names and indices
 */
function extractPathParams(normalizedPath: string): PathParamSegment[] {
  const pathSegments = normalizedPath.split("/");

  const raw = pathSegments.flatMap<PathParamSegment>((seg, i) =>
    seg === ":id"
      ? [
          {
            index: i,
            paramName: `${singularize(i > 0 ? pathSegments[i - 1] : "item")}Id`,
          },
        ]
      : []
  );

  return raw.reduce<{ seen: Set<string>; result: PathParamSegment[] }>(
    ({ seen, result }, pp) => {
      const name = seen.has(pp.paramName)
        ? `${pp.paramName}${seen.size + 1}`
        : pp.paramName;
      return {
        seen: new Set([...seen, name]),
        result: [...result, { index: pp.index, paramName: name }],
      };
    },
    { seen: new Set(), result: [] }
  ).result;
}

/**
 * Computes the full method signature info for an endpoint, including
 * parameter string, return type, and path expression.
 * @param endpoint - the API endpoint
 * @param types - inferred response types
 * @param requestTypes - inferred request types
 * @returns the computed method info
 */
function computeMethodInfo(
  endpoint: Endpoint,
  types: TypeDefinition[],
  requestTypes: TypeDefinition[]
): MethodInfo {
  const methodName = pathToMethodName(endpoint.method, endpoint.normalizedPath);
  const responseTypeName = pathToTypeName(
    endpoint.method,
    endpoint.normalizedPath
  );
  const requestTypeName = responseTypeName.replace(/Response$/, "Request");

  const hasResponseType = types.some(t => t.name === responseTypeName);
  const hasRequestType = requestTypes.some(t => t.name === requestTypeName);
  const responseType = hasResponseType ? responseTypeName : "unknown";

  const responseTypeDef = types.find(t => t.name === responseTypeName);
  const actualReturnType =
    responseTypeDef?.isArray && responseTypeDef.properties.length > 0
      ? `${responseTypeName}[]`
      : responseTypeDef?.isArray
        ? "unknown[]"
        : responseType;

  const pathParamSegments = extractPathParams(endpoint.normalizedPath);

  const pathParams = pathParamSegments.map(pp => `${pp.paramName}: string`);
  const hasBody = ["POST", "PUT", "PATCH"].includes(endpoint.method);
  const bodyParam = hasBody
    ? [`body: ${hasRequestType ? requestTypeName : "Record<string, unknown>"}`]
    : [];
  const queryParam =
    endpoint.queryParams.length > 0
      ? [
          `options?: { ${endpoint.queryParams.map(qp => `${qp.name}${qp.required ? "" : "?"}: string`).join("; ")} }`,
        ]
      : [];

  const paramStr = [...pathParams, ...bodyParam, ...queryParam].join(", ");

  const pathSegments = endpoint.normalizedPath.split("/");
  const pathExpr =
    pathParamSegments.length > 0
      ? `\`${pathSegments
          .map((seg, i) => {
            const pp = pathParamSegments.find(p => p.index === i);
            return pp ? `\${${pp.paramName}}` : seg;
          })
          .join("/")}\``
      : `'${endpoint.normalizedPath}'`;

  return {
    methodName,
    paramStr,
    returnType: actualReturnType,
    pathParamSegments,
    hasBody,
    pathExpr,
  };
}

/**
 * Emits lines for query-param handling at the start of a method body.
 * @param endpoint - the API endpoint with query parameters
 * @param pathExpr - the path expression string for the fetch call
 * @returns lines that set up URLSearchParams and the fetch call opening
 */
function emitQueryParamLines(endpoint: Endpoint, pathExpr: string): string[] {
  return [
    "    const params = new URLSearchParams();",
    "    if (options) {",
    ...endpoint.queryParams.map(
      qp =>
        `      if (options.${qp.name} !== undefined) params.set('${qp.name}', options.${qp.name});`
    ),
    "    }",
    "    const qs = params.toString() ? `?${params.toString()}` : '';",
    `    const response = await this._fetch(${pathExpr} + qs, {`,
  ];
}

/**
 * Emits a single endpoint method on the API client class, handling
 * path params, query params, body, and response typing.
 * @param endpoint - the API endpoint
 * @param types - inferred response types
 * @param requestTypes - inferred request types
 * @returns the generated source lines for this endpoint method
 */
export function emitEndpointMethod(
  endpoint: Endpoint,
  types: TypeDefinition[],
  requestTypes: TypeDefinition[]
): string[] {
  const info = computeMethodInfo(endpoint, types, requestTypes);

  const fetchLines =
    endpoint.queryParams.length > 0
      ? emitQueryParamLines(endpoint, info.pathExpr)
      : [`    const response = await this._fetch(${info.pathExpr}, {`];

  return [
    `  async ${info.methodName}(${info.paramStr}): Promise<${info.returnType}> {`,
    ...fetchLines,
    `      method: '${endpoint.method}',`,
    ...(info.hasBody
      ? [
          "      headers: { 'Content-Type': 'application/json' },",
          "      body: JSON.stringify(body),",
        ]
      : []),
    "    });",
    "",
    "    if (!response.ok) {",
    "      const errorBody = await response.text().catch(() => '');",
    "      throw new ApiError(response.status, errorBody);",
    "    }",
    "",
    "    return response.json();",
    "  }",
    "",
  ];
}

/**
 * Selects the best GET endpoint path to use as a health-check probe,
 * preferring the endpoint seen across the most original URLs.
 * @param endpoints - all API endpoints
 * @returns the normalized path (with :id replaced by "1") to probe
 */
function pickHealthCheckPath(endpoints: Endpoint[]): string {
  const getEndpoints = endpoints.filter(e => e.method === "GET");
  if (getEndpoints.length === 0) return "/";
  const best = getEndpoints.reduce(
    (b, ep) => (ep.originalUrls.length > b.originalUrls.length ? ep : b),
    getEndpoints[0]
  );
  return best.normalizedPath.replace(/:id/g, "1");
}

/**
 * Emits the healthCheck method on the API client class, picking
 * the most commonly observed GET endpoint for the probe.
 * @param endpoints - the API endpoints
 * @returns the generated source lines for the healthCheck method
 */
export function emitHealthCheck(endpoints: Endpoint[]): string[] {
  const safePath = pickHealthCheckPath(endpoints);
  return [
    "  async healthCheck(): Promise<HealthCheckResult> {",
    "    try {",
    `      const response = await this._fetch('${safePath}', { method: 'HEAD' });`,
    "      if (response.status === 401 || response.status === 403) {",
    "        return { valid: false, status: response.status, message: SESSION_HELP };",
    "      }",
    "      return {",
    "        valid: response.ok,",
    "        status: response.status,",
    "        message: response.ok ? 'OK' : `Unexpected status ${response.status}`,",
    "      };",
    "    } catch (error) {",
    "      return {",
    "        valid: false,",
    "        status: 0,",
    "        message: error instanceof Error ? error.message : String(error),",
    "      };",
    "    }",
    "  }",
    "",
  ];
}
