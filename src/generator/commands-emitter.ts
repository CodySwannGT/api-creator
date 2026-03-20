import type { Endpoint } from "../types/endpoint.js";
import type { TypeDefinition } from "../parser/type-inferrer.js";
import {
  pathToMethodName,
  methodNameToCliCommand,
  singularize,
} from "../utils/naming.js";
import { emitGraphQLEndpoint } from "./graphql-commands-emitter.js";

/** Generated-code line emitted wherever the CLI must hard-exit with failure. */
const GEN_PROCESS_EXIT_1 = "    process.exit(1);";

/** Shared import header lines for generated commands modules. */
const IMPORT_LINES = [
  "import { Command } from 'commander';",
  "import { loadAuth, AUTH_TYPE, CLI_NAME } from './auth.js';",
  "import { ApiClient } from './client.js';",
  "",
];

/**
 * Generates the commands module source code for a CLI project,
 * registering one subcommand per API endpoint.
 * @param endpoints - the API endpoints to generate commands for
 * @param _types - inferred response types (reserved for future use)
 * @returns the generated commands module source code
 */
export function emitCommandsModule(
  endpoints: Endpoint[],
  _types: TypeDefinition[]
): string {
  return [
    ...IMPORT_LINES,
    ...emitGetClient(),
    ...emitHandleError(),
    "export function registerEndpointCommands(program: Command): void {",
    ...endpoints.flatMap(endpoint => emitEndpoint(endpoint)),
    "}",
    "",
  ].join("\n");
}

/**
 * Extracts path parameters from a normalized path string.
 * @param normalizedPath - the normalized endpoint path (e.g. `/users/:id/posts`)
 * @returns an array of path parameter objects with name and index
 */
function extractPathParams(
  normalizedPath: string
): { name: string; index: number }[] {
  const pathSegments = normalizedPath.split("/");
  return pathSegments.flatMap((seg, i) => {
    if (seg !== ":id") return [];
    const preceding = i > 0 ? pathSegments[i - 1] : "item";
    return [{ name: `${singularize(preceding)}Id`, index: i }];
  });
}

/**
 * Emits the lines for a single endpoint command (GraphQL or REST).
 * @param endpoint - the API endpoint to emit
 * @returns lines of code for this endpoint's command registration
 */
function emitEndpoint(endpoint: Endpoint): string[] {
  const methodName = pathToMethodName(endpoint.method, endpoint.normalizedPath);
  const commandName = methodNameToCliCommand(methodName, endpoint.method);
  const pathParams = extractPathParams(endpoint.normalizedPath);
  const hasBody = ["POST", "PUT", "PATCH"].includes(endpoint.method);
  const isGraphQL =
    endpoint.queryParams.some(qp => qp.name === "operationName") &&
    endpoint.queryParams.some(qp => qp.name === "extensions");

  return isGraphQL
    ? emitGraphQLEndpoint(
        endpoint,
        pathParams,
        methodName,
        commandName,
        hasBody
      )
    : emitRestEndpoint(endpoint, pathParams, methodName, commandName, hasBody);
}

/**
 * Emits the `getClient` helper function lines.
 * @returns lines of code for the getClient function
 */
function emitGetClient(): string[] {
  return [
    "function getClient(baseUrl?: string): ApiClient {",
    "  const auth = loadAuth();",
    "  if (!auth) {",
    "    console.error(`No auth configured. Run: ${CLI_NAME} auth setup`);",
    GEN_PROCESS_EXIT_1,
    "  }",
    "  return new ApiClient(baseUrl, auth);",
    "}",
    "",
  ];
}

/**
 * Emits the `handleError` helper function lines.
 * @returns lines of code for the handleError function
 */
function emitHandleError(): string[] {
  return [
    "function handleError(error: unknown): void {",
    "  if (error instanceof Error && 'status' in error) {",
    "    const status = (error as { status: number }).status;",
    "    if (status === 401 || status === 403) {",
    "      console.error(`Authentication failed (${status}). Run: ${CLI_NAME} auth setup`);",
    GEN_PROCESS_EXIT_1,
    "    }",
    "  }",
    "  console.error(error instanceof Error ? error.message : String(error));",
    GEN_PROCESS_EXIT_1,
    "}",
    "",
  ];
}

/**
 * Emits a REST endpoint as a Commander subcommand.
 * @param endpoint - the API endpoint
 * @param pathParams - extracted path parameters
 * @param methodName - the client method name
 * @param commandName - the CLI command name
 * @param hasBody - whether the endpoint has a request body
 * @returns lines of code for this REST command registration
 */
function emitRestEndpoint(
  endpoint: Endpoint,
  pathParams: { name: string; index: number }[],
  methodName: string,
  commandName: string,
  hasBody: boolean
): string[] {
  const description = `${endpoint.method} ${endpoint.normalizedPath}`;
  const hasQueryParams = endpoint.queryParams.length > 0;

  return [
    "",
    `  program`,
    `    .command('${commandName}')`,
    `    .description('${description}')`,
    ...pathParams.map(
      pp => `    .argument('<${pp.name}>', '${pp.name} path parameter')`
    ),
    ...(hasQueryParams
      ? endpoint.queryParams.map(
          qp =>
            `    .option('--${qp.name} <value>', '${qp.name} query parameter')`
        )
      : []),
    ...(hasBody
      ? [
          "    .option('--body <json>', 'Request body as JSON string')",
          "    .option('--json <json>', 'Request body as JSON string (alias for --body)')",
        ]
      : []),
    "    .option('--raw', 'Output compact JSON instead of pretty-printed')",
    ...emitRestActionHandler(
      pathParams,
      endpoint,
      methodName,
      hasBody,
      hasQueryParams
    ),
  ];
}

/**
 * Emits the `.action(async (...) => { ... })` handler lines for a REST command.
 * @param pathParams - extracted path parameters
 * @param endpoint - the API endpoint
 * @param methodName - the client method name to call
 * @param hasBody - whether the endpoint has a request body
 * @param hasQueryParams - whether the endpoint has query parameters
 * @returns lines of code for the REST action handler block
 */
function emitRestActionHandler(
  pathParams: { name: string; index: number }[],
  endpoint: Endpoint,
  methodName: string,
  hasBody: boolean,
  hasQueryParams: boolean
): string[] {
  const argNames = pathParams.map(pp => pp.name);
  const actionParams =
    argNames.length > 0 ? `${argNames.join(", ")}, options` : "options";

  const bodyLines = hasBody
    ? [
        "        const bodyData = options.body || options.json || '';",
        "        let parsedBody: any;",
        "        try {",
        "          parsedBody = JSON.parse(bodyData);",
        "        } catch {",
        "          console.error('Invalid JSON body. Provide valid JSON via --body or --json.');",
        GEN_PROCESS_EXIT_1,
        "        }",
      ]
    : [];

  const queryLines = hasQueryParams
    ? [
        "        const queryOpts: any = {};",
        ...endpoint.queryParams.map(
          qp =>
            `        if (options.${qp.name} !== undefined) queryOpts.${qp.name} = options.${qp.name};`
        ),
      ]
    : [];

  const callArgs = [
    ...argNames,
    ...(hasBody ? ["parsedBody"] : []),
    ...(hasQueryParams ? ["queryOpts"] : []),
  ];

  return [
    `    .action(async (${actionParams}) => {`,
    "      try {",
    "        const client = getClient();",
    ...bodyLines,
    ...queryLines,
    `        const result = await client.${methodName}(${callArgs.join(", ")});`,
    "        const output = options.raw ? JSON.stringify(result) : JSON.stringify(result, null, 2);",
    "        console.log(output);",
    "      } catch (error) {",
    "        handleError(error);",
    "      }",
    "    });",
  ];
}
