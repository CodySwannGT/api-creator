import { describe, it, expect } from "vitest";
import { emitCommandsModule } from "../../src/generator/commands-emitter.js";
import type { Endpoint } from "../../src/types/endpoint.js";

/**
 *
 * @param method
 * @param path
 * @param queryParams
 */
function makeEndpoint(
  method: string,
  path: string,
  queryParams: {
    name: string;
    observedValues: string[];
    required: boolean;
  }[] = []
): Endpoint {
  return {
    method,
    normalizedPath: path,
    originalUrls: [`https://api.example.com${path}`],
    queryParams,
    requestBodies: [],
    responseBodies: [],
    responseStatuses: [200],
    headers: {},
  };
}

describe("emitCommandsModule", () => {
  it("includes import lines", () => {
    const code = emitCommandsModule([], []);
    expect(code).toContain("import { Command } from 'commander';");
    expect(code).toContain(
      "import { loadAuth, AUTH_TYPE, CLI_NAME } from './auth.js';"
    );
    expect(code).toContain("import { ApiClient } from './client.js';");
  });

  it("includes getClient helper", () => {
    const code = emitCommandsModule([], []);
    expect(code).toContain("function getClient(baseUrl?: string): ApiClient {");
    expect(code).toContain("const auth = loadAuth();");
  });

  it("includes handleError helper", () => {
    const code = emitCommandsModule([], []);
    expect(code).toContain("function handleError(error: unknown): void {");
  });

  it("exports registerEndpointCommands function", () => {
    const code = emitCommandsModule([], []);
    expect(code).toContain(
      "export function registerEndpointCommands(program: Command): void {"
    );
  });

  it("generates a GET command", () => {
    const endpoints = [makeEndpoint("GET", "/users")];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain(".command('users')");
    expect(code).toContain(".description('GET /users')");
    expect(code).toContain("client.getUsers(");
  });

  it("generates a POST command with body options", () => {
    const endpoints = [makeEndpoint("POST", "/users")];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain("--body <json>");
    expect(code).toContain("--json <json>");
    expect(code).toContain("JSON.parse(bodyData)");
  });

  it("generates path parameter arguments for :id segments", () => {
    const endpoints = [makeEndpoint("GET", "/users/:id")];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain(".argument('<userId>', 'userId path parameter')");
  });

  it("generates query parameter options", () => {
    const endpoints = [
      makeEndpoint("GET", "/search", [
        { name: "q", observedValues: ["test"], required: true },
        { name: "page", observedValues: ["1"], required: false },
      ]),
    ];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain("--q <value>");
    expect(code).toContain("--page <value>");
    expect(code).toContain("queryOpts.q = options.q");
  });

  it("includes --raw option for all commands", () => {
    const endpoints = [makeEndpoint("GET", "/users")];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain("--raw");
    expect(code).toContain("JSON.stringify(result)");
  });

  it("generates PUT command with body", () => {
    const endpoints = [makeEndpoint("PUT", "/users/:id")];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain("--body <json>");
    expect(code).toContain("parsedBody");
  });

  it("generates PATCH command with body", () => {
    const endpoints = [makeEndpoint("PATCH", "/users/:id")];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain("--body <json>");
  });

  it("handles GraphQL endpoints with operationName and extensions", () => {
    const endpoints = [
      makeEndpoint("GET", "/api/graphql", [
        { name: "operationName", observedValues: ["GetUser"], required: true },
        {
          name: "extensions",
          observedValues: ['{"persistedQuery":{}}'],
          required: true,
        },
        {
          name: "variables",
          observedValues: ['{"id":"123"}'],
          required: false,
        },
      ]),
    ];
    const code = emitCommandsModule(endpoints, []);
    expect(code).toContain("operationName");
    expect(code).toContain("variables");
  });
});
