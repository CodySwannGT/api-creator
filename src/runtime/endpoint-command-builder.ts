import { Command } from "commander";
import chalk from "chalk";

import { loadAuth } from "./project-manager.js";
import type { ProjectManifest, ManifestEndpoint } from "./project-manager.js";
import type { AuthConfig } from "./curl-parser.js";
import { httpRequest, HttpError } from "./http-client.js";
import { kebabToCamel } from "../utils/naming.js";

/** Union type for Commander action option values. */
type OptionValue = string | boolean | undefined;

/** Options record type for endpoint command actions. */
type ActionOptions = Record<string, OptionValue>;

/**
 * Registers a single endpoint as a Commander subcommand, including
 * all options for path params, query params, body, and GraphQL variables.
 * @param projectCmd - the parent Commander command for this project
 * @param projectName - the project name
 * @param manifest - the project manifest
 * @param endpoint - the endpoint manifest entry
 */
export function registerEndpointCommand(
  projectCmd: Command,
  projectName: string,
  manifest: ProjectManifest,
  endpoint: ManifestEndpoint
): void {
  const cmd = projectCmd
    .command(endpoint.commandName)
    .description(endpoint.description);

  for (const pp of endpoint.pathParams) {
    cmd.argument(`<${pp}>`, `${pp} path parameter`);
  }

  registerGraphQLOptions(cmd, endpoint);
  registerQueryParamOptions(cmd, endpoint);

  if (endpoint.hasBody) {
    cmd.option("--body <json>", "Request body as JSON string");
    cmd.option(
      "--json <json>",
      "Request body as JSON string (alias for --body)"
    );
  }

  cmd.option("--raw", "Output compact JSON instead of pretty-printed");
  cmd.action(buildEndpointAction(projectName, manifest, endpoint));
}

/**
 * Registers GraphQL-specific options (variable flags, --variables) on a command
 * @param cmd - the Commander command to add options to
 * @param endpoint - the endpoint manifest entry with GraphQL metadata
 */
function registerGraphQLOptions(
  cmd: Command,
  endpoint: ManifestEndpoint
): void {
  if (!endpoint.isGraphQL) return;

  for (const vf of endpoint.variables ?? []) {
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

  cmd.option(
    "--variables <json>",
    "Raw variables JSON (overrides individual variable options)"
  );
}

/**
 * Registers query parameter options on a command
 * @param cmd - the Commander command to add options to
 * @param endpoint - the endpoint manifest entry with query param definitions
 */
function registerQueryParamOptions(
  cmd: Command,
  endpoint: ManifestEndpoint
): void {
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
}

/**
 * Builds the async action handler for an endpoint command.
 * @param projectName - the project name used for auth lookup and error messages
 * @param manifest - the project manifest containing base URL and endpoint info
 * @param endpoint - the specific endpoint to build the action for
 * @returns an async action function suitable for Commander .action()
 */
function buildEndpointAction(
  projectName: string,
  manifest: ProjectManifest,
  endpoint: ManifestEndpoint
): (...actionArgs: unknown[]) => Promise<void> {
  return async (...actionArgs: unknown[]) => {
    const pathArgValues = endpoint.pathParams.map(
      (_, i) => actionArgs[i] as string
    );
    const options = actionArgs[endpoint.pathParams.length] as ActionOptions;

    const auth = loadAuth(projectName);
    if (!auth) {
      console.error(
        chalk.red(
          `No auth configured. Run: api-creator ${projectName} auth setup`
        )
      );
      process.exit(1);
    }

    const resolvedPath = buildResolvedPath(
      endpoint.path,
      endpoint.pathParams,
      pathArgValues
    );
    const queryParams = buildQueryParams(endpoint, options);
    const body = parseRequestBody(endpoint, options);

    await executeRequest(
      projectName,
      manifest,
      endpoint,
      resolvedPath,
      auth,
      queryParams,
      body,
      options
    );
  };
}

/**
 * Replaces path parameter placeholders with their actual values.
 * @param pathTemplate - the path template with :param placeholders
 * @param pathParams - the list of parameter names
 * @param pathArgValues - the list of actual values for each parameter
 * @returns the resolved path with all placeholders replaced
 */
function buildResolvedPath(
  pathTemplate: string,
  pathParams: string[],
  pathArgValues: string[]
): string {
  return pathParams.reduce(
    (acc, _param, i) => acc.replace(":id", pathArgValues[i]),
    pathTemplate
  );
}

/**
 * Builds the combined query parameters object for a request.
 * @param endpoint - the endpoint manifest entry
 * @param options - the Commander action options
 * @returns a record of query parameter key-value pairs
 */
function buildQueryParams(
  endpoint: ManifestEndpoint,
  options: ActionOptions
): Record<string, string> {
  const graphql = endpoint.isGraphQL
    ? buildGraphQLQueryParams(endpoint, options)
    : {};
  const rest = buildRestQueryParams(endpoint, options);
  return { ...graphql, ...rest };
}

/**
 * Builds GraphQL-specific query parameters including operationName, extensions, and variables.
 * @param endpoint - the endpoint manifest entry with GraphQL metadata
 * @param options - the Commander action options
 * @returns a record of GraphQL query parameter key-value pairs
 */
function buildGraphQLQueryParams(
  endpoint: ManifestEndpoint,
  options: ActionOptions
): Record<string, string> {
  const base: Record<string, string> = {
    ...(endpoint.operationName
      ? { operationName: endpoint.operationName }
      : {}),
    ...(endpoint.extensions ? { extensions: endpoint.extensions } : {}),
  };

  const variables = buildGraphQLVariables(endpoint, options);
  return { ...base, variables: JSON.stringify(variables) };
}

/**
 * Resolves the variables object for a GraphQL request from options or individual flags.
 * @param endpoint - the endpoint manifest entry with variable definitions
 * @param options - the Commander action options
 * @returns the resolved variables as a plain object
 */
function buildGraphQLVariables(
  endpoint: ManifestEndpoint,
  options: ActionOptions
): Record<string, unknown> {
  if (typeof options.variables === "string") {
    try {
      return JSON.parse(options.variables) as Record<string, unknown>;
    } catch {
      console.error("Invalid JSON for --variables.");
      process.exit(1);
    }
  }

  return (endpoint.variables ?? []).reduce<Record<string, unknown>>(
    (acc, vf) => {
      const optionAccessor = kebabToCamel(vf.kebabName);
      const val = options[optionAccessor];
      return val !== undefined ? { ...acc, [vf.camelName]: val } : acc;
    },
    {}
  );
}

/**
 * Builds the REST query parameters from the endpoint definition and options.
 * @param endpoint - the endpoint manifest entry
 * @param options - the Commander action options
 * @returns a record of REST query parameter key-value pairs
 */
function buildRestQueryParams(
  endpoint: ManifestEndpoint,
  options: ActionOptions
): Record<string, string> {
  return endpoint.queryParams.reduce<Record<string, string>>((acc, qp) => {
    const val = options[qp.name];
    return val !== undefined && typeof val === "string"
      ? { ...acc, [qp.name]: val }
      : acc;
  }, {});
}

/**
 * Parses the request body from Commander options.
 * @param endpoint - the endpoint manifest entry indicating if body is expected
 * @param options - the Commander action options containing body or json fields
 * @returns the parsed body object, or undefined if no body
 */
function parseRequestBody(
  endpoint: ManifestEndpoint,
  options: ActionOptions
): unknown {
  if (!endpoint.hasBody) return undefined;

  const bodyData = (options.body || options.json || "") as string;
  if (!bodyData) return undefined;

  try {
    return JSON.parse(bodyData);
  } catch {
    console.error(
      "Invalid JSON body. Provide valid JSON via --body or --json."
    );
    process.exit(1);
  }
}

/**
 * Executes the HTTP request and prints the result or error.
 * @param projectName - the project name for error messages
 * @param manifest - the project manifest containing the base URL
 * @param endpoint - the endpoint manifest entry with HTTP method
 * @param resolvedPath - the path with all parameters filled in
 * @param auth - the auth configuration for the request
 * @param queryParams - the query parameters to include
 * @param body - the request body, if any
 * @param options - the Commander action options including --raw flag
 * @returns a promise that resolves when the request completes
 */
async function executeRequest(
  projectName: string,
  manifest: ProjectManifest,
  endpoint: ManifestEndpoint,
  resolvedPath: string,
  auth: AuthConfig,
  queryParams: Record<string, string>,
  body: unknown,
  options: ActionOptions
): Promise<void> {
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
}
