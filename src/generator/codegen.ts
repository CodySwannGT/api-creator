import type {
  ProjectManifest,
  ManifestEndpoint,
  VariableField,
} from "../runtime/project-manager.js";
import type { Endpoint } from "../types/endpoint.js";
import type { AuthInfo } from "../types/auth.js";

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";

import { readHarFile, filterApiRequests } from "../parser/har-reader.js";
import { groupEndpoints } from "../parser/endpoint-grouper.js";
import { detectAuth } from "../parser/auth-detector.js";
import { inferTypes, inferRequestTypes } from "../parser/type-inferrer.js";
import { emitClient } from "./client-emitter.js";
import { emitTypes } from "./types-emitter.js";
import { logSummary } from "./log-summary.js";
import {
  pathToMethodName,
  methodNameToCliCommand,
  singularize,
  camelToKebab,
} from "../utils/naming.js";
import {
  saveManifest,
  getProjectDir,
  loadManifest,
  mergeManifests,
} from "../runtime/project-manager.js";
import { inferGroup } from "../utils/group-inferrer.js";

/**
 * Options for the client generation process
 */
export interface GenerateOptions {
  inputPath: string;
  name?: string;
  baseUrl?: string;
}

/**
 * Result of the generation pipeline containing all computed data
 */
interface PipelineResult {
  entries: { length: number };
  apiEntries: { length: number };
  auth: AuthInfo[];
  resolvedBaseUrl: string;
  endpoints: Endpoint[];
  types: { name: string }[];
  requestTypes: { name: string }[];
  projectName: string;
  projectDir: string;
}

/**
 * Runs the HAR parsing and code generation pipeline without side effects
 * @param options - generation options including input path, name, and base URL
 * @returns the pipeline result or null if no API requests were found
 */
async function runPipeline(
  options: GenerateOptions
): Promise<PipelineResult | null> {
  const { inputPath, name, baseUrl } = options;
  const entries = await readHarFile(inputPath);
  const apiEntries = filterApiRequests(entries);

  if (apiEntries.length === 0) return null;

  const auth = detectAuth(apiEntries);
  const { baseUrl: detectedBaseUrl, endpoints } = groupEndpoints(apiEntries);
  const resolvedBaseUrl = baseUrl ?? detectedBaseUrl;
  const types = inferTypes(endpoints);
  const requestTypes = inferRequestTypes(endpoints);
  const projectName = name ?? "api-client";
  const manifest = buildManifest(
    projectName,
    resolvedBaseUrl,
    detectedBaseUrl,
    auth,
    endpoints
  );
  const projectDir = getProjectDir(projectName);
  const clientSource = emitClient({
    endpoints,
    types,
    requestTypes,
    auth,
    baseUrl: resolvedBaseUrl,
    name: "ApiClient",
    originalUrl: detectedBaseUrl,
  });
  const typesSource = emitTypes(types, requestTypes);

  const existingManifest = loadManifest(projectName);
  const finalManifest = existingManifest
    ? mergeManifests(existingManifest, manifest)
    : manifest;

  saveManifest(projectName, finalManifest);
  await writeFile(join(projectDir, "client.ts"), clientSource, "utf-8");
  await writeFile(join(projectDir, "types.ts"), typesSource, "utf-8");

  return {
    entries,
    apiEntries,
    auth,
    resolvedBaseUrl,
    endpoints,
    types,
    requestTypes,
    projectName,
    projectDir,
  };
}

/**
 * Generates a typed API client project from a HAR file
 * @param options - generation options including input path, name, and base URL
 * @returns a promise that resolves when generation is complete
 */
export async function generateClient(options: GenerateOptions): Promise<void> {
  const result = await runPipeline(options);

  if (!result) {
    console.log(chalk.yellow("  No API requests found in the HAR file."));
    return;
  }

  console.log(
    chalk.gray(`  Read ${result.entries.length} entries from HAR file`)
  );
  console.log(chalk.gray(`  Found ${result.apiEntries.length} API requests`));
  if (result.auth.length > 0) {
    console.log(
      chalk.gray(
        `  Detected auth: ${result.auth[0].type} (${result.auth[0].key})`
      )
    );
  }
  console.log(
    chalk.gray(
      `  Grouped into ${result.endpoints.length} endpoints (base: ${result.resolvedBaseUrl})`
    )
  );
  console.log(
    chalk.gray(
      `  Inferred ${result.types.length} response types, ${result.requestTypes.length} request types`
    )
  );
  logSummary(
    result.projectDir,
    result.endpoints as Endpoint[],
    result.types,
    result.requestTypes,
    result.auth,
    result.projectName
  );
}

/**
 * Builds the project manifest from generation results
 * @param projectName - the CLI project name
 * @param baseUrl - the resolved API base URL
 * @param originalUrl - the original URL the spec was captured from
 * @param authInfos - the detected auth mechanisms
 * @param endpoints - the API endpoints
 * @returns the complete project manifest
 */
function buildManifest(
  projectName: string,
  baseUrl: string,
  originalUrl: string,
  authInfos: AuthInfo[],
  endpoints: Endpoint[]
): ProjectManifest {
  const authType = authInfos.length > 0 ? authInfos[0].type : "none";

  return {
    name: projectName,
    baseUrl,
    originalUrl,
    createdAt: new Date().toISOString(),
    authType,
    endpoints: endpoints.map(buildManifestEndpoint),
  };
}

/**
 * Extracts path parameters from a normalized path with :id placeholders
 * @param normalizedPath - the endpoint path with :id tokens
 * @returns array of derived parameter names like "userId"
 */
function extractPathParams(normalizedPath: string): string[] {
  const pathSegments = normalizedPath.split("/");
  return pathSegments.flatMap((seg, i) => {
    if (seg !== ":id") return [];
    const preceding = i > 0 ? pathSegments[i - 1] : "item";
    return [`${singularize(preceding)}Id`];
  });
}

/**
 * Builds a single manifest endpoint entry from an API endpoint
 * @param endpoint - the API endpoint to convert to manifest format
 * @returns the manifest endpoint entry
 */
function buildManifestEndpoint(endpoint: Endpoint): ManifestEndpoint {
  const methodName = pathToMethodName(endpoint.method, endpoint.normalizedPath);
  const commandName = methodNameToCliCommand(methodName, endpoint.method);
  const description = `${endpoint.method} ${endpoint.normalizedPath}`;
  const pathParams = extractPathParams(endpoint.normalizedPath);
  const hasBody = ["POST", "PUT", "PATCH"].includes(endpoint.method);
  const qpMap = new Map(endpoint.queryParams.map(qp => [qp.name, qp]));
  const isGraphQL = qpMap.has("operationName") && qpMap.has("extensions");
  const operationName = isGraphQL
    ? qpMap.get("operationName")?.observedValues[0]
    : undefined;
  const group = inferGroup(endpoint.normalizedPath, isGraphQL, operationName);

  if (isGraphQL) {
    return buildGraphQLManifestEndpoint(
      endpoint,
      commandName,
      description,
      methodName,
      pathParams,
      hasBody,
      qpMap,
      group
    );
  }

  const queryParams = endpoint.queryParams.map(qp => ({
    name: qp.name,
    defaultValue: undefined as string | undefined,
  }));

  return {
    commandName,
    description,
    methodName,
    httpMethod: endpoint.method,
    path: endpoint.normalizedPath,
    pathParams,
    isGraphQL: false,
    queryParams,
    hasBody,
    group,
  };
}

/**
 * Parses GraphQL variable fields from observed query parameter values
 * @param variablesQp - the variables query parameter with observed values
 * @returns array of parsed variable fields
 */
function parseGraphQLVariables(
  variablesQp: { observedValues: string[] } | undefined
): VariableField[] {
  if (!variablesQp || variablesQp.observedValues.length === 0) return [];
  try {
    const parsed = JSON.parse(variablesQp.observedValues[0]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, val]) => ({
        camelName: key,
        kebabName: camelToKebab(key),
        exampleValue: typeof val === "string" ? val : JSON.stringify(val),
      }));
    }
  } catch {
    // variables is not valid JSON, skip field extraction
  }
  return [];
}

/**
 * Builds a manifest endpoint for a GraphQL persisted query
 * @param endpoint - the API endpoint
 * @param commandName - the CLI command name
 * @param description - the endpoint description
 * @param methodName - the client method name
 * @param pathParams - the path parameter names
 * @param hasBody - whether the endpoint has a request body
 * @param qpMap - map of query parameter names to their definitions
 * @param group - the inferred help group heading
 * @returns the GraphQL manifest endpoint entry
 */
function buildGraphQLManifestEndpoint(
  endpoint: Endpoint,
  commandName: string,
  description: string,
  methodName: string,
  pathParams: string[],
  hasBody: boolean,
  qpMap: Map<
    string,
    { name: string; observedValues: string[]; required: boolean }
  >,
  group: string
): ManifestEndpoint {
  const operationNameQp = qpMap.get("operationName")!;
  const extensionsQp = qpMap.get("extensions")!;

  const operationName = operationNameQp.observedValues[0] ?? commandName;
  const extensions = extensionsQp.observedValues[0] ?? "{}";
  const variables = parseGraphQLVariables(qpMap.get("variables"));

  const graphqlSpecialParams = new Set([
    "operationName",
    "extensions",
    "variables",
  ]);
  const defaultableParams: Record<string, string> = {
    locale: "en",
    currency: "USD",
  };
  const otherParams = endpoint.queryParams
    .filter(qp => !graphqlSpecialParams.has(qp.name))
    .map(qp => ({
      name: qp.name,
      defaultValue: defaultableParams[qp.name] as string | undefined,
    }));

  return {
    commandName,
    description,
    methodName,
    httpMethod: endpoint.method,
    path: endpoint.normalizedPath,
    pathParams,
    isGraphQL: true,
    operationName,
    extensions,
    variables,
    queryParams: otherParams,
    hasBody,
    group,
  };
}
