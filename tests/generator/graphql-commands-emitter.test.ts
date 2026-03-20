import { describe, it, expect } from "vitest";
import { emitGraphQLEndpoint } from "../../src/generator/graphql-commands-emitter.js";
import type { Endpoint } from "../../src/types/endpoint.js";

/**
 *
 * @param operationName
 * @param extensions
 * @param variables
 * @param extraParams
 */
function makeGraphQLEndpoint(
  operationName: string,
  extensions: string,
  variables?: string,
  extraParams: {
    name: string;
    observedValues: string[];
    required: boolean;
  }[] = []
): Endpoint {
  const queryParams = [
    { name: "operationName", observedValues: [operationName], required: true },
    { name: "extensions", observedValues: [extensions], required: true },
    ...(variables
      ? [{ name: "variables", observedValues: [variables], required: false }]
      : []),
    ...extraParams,
  ];

  return {
    method: "GET",
    normalizedPath: "/api/graphql",
    originalUrls: ["https://api.example.com/api/graphql"],
    queryParams,
    requestBodies: [],
    responseBodies: [],
    responseStatuses: [200],
    headers: {},
  };
}

describe("emitGraphQLEndpoint", () => {
  it("emits a command with the operation name baked in", () => {
    const endpoint = makeGraphQLEndpoint("GetUser", '{"persistedQuery":{}}');
    const lines = emitGraphQLEndpoint(
      endpoint,
      [],
      "getApiGraphql",
      "api-graphql",
      false
    );
    const code = lines.join("\n");
    expect(code).toContain(".command('api-graphql')");
    expect(code).toContain('queryOpts.operationName = "GetUser"');
  });

  it("emits baked-in extensions value", () => {
    const extensions = '{"persistedQuery":{"sha256Hash":"abc123"}}';
    const endpoint = makeGraphQLEndpoint("GetUser", extensions);
    const lines = emitGraphQLEndpoint(
      endpoint,
      [],
      "getApiGraphql",
      "api-graphql",
      false
    );
    const code = lines.join("\n");
    expect(code).toContain("queryOpts.extensions =");
    expect(code).toContain("persistedQuery");
  });

  it("emits variable options from parsed variables JSON", () => {
    const variables = '{"userId":"123","includeDetails":true}';
    const endpoint = makeGraphQLEndpoint("GetUser", "{}", variables);
    const lines = emitGraphQLEndpoint(
      endpoint,
      [],
      "getApiGraphql",
      "api-graphql",
      false
    );
    const code = lines.join("\n");
    expect(code).toContain("--user-id <value>");
    expect(code).toContain("--include-details <value>");
    expect(code).toContain("--variables <json>");
  });

  it("emits --raw option", () => {
    const endpoint = makeGraphQLEndpoint("GetUser", "{}");
    const lines = emitGraphQLEndpoint(
      endpoint,
      [],
      "getApiGraphql",
      "api-graphql",
      false
    );
    const code = lines.join("\n");
    expect(code).toContain("--raw");
  });

  it("includes path parameter arguments", () => {
    const endpoint = makeGraphQLEndpoint("GetUser", "{}");
    const pathParams = [{ name: "userId", index: 1 }];
    const lines = emitGraphQLEndpoint(
      endpoint,
      pathParams,
      "getApiGraphql",
      "api-graphql",
      false
    );
    const code = lines.join("\n");
    expect(code).toContain(".argument('<userId>'");
  });

  it("includes body parsing in action handler for POST-like endpoints", () => {
    const endpoint = makeGraphQLEndpoint("CreateUser", "{}");
    const lines = emitGraphQLEndpoint(
      endpoint,
      [],
      "createApiGraphql",
      "create-api-graphql",
      true
    );
    const code = lines.join("\n");
    expect(code).toContain("parsedBody");
    expect(code).toContain("JSON.parse(bodyData)");
  });

  it("handles extra query params with defaults", () => {
    const endpoint = makeGraphQLEndpoint("GetUser", "{}", undefined, [
      { name: "locale", observedValues: ["en"], required: false },
      { name: "currency", observedValues: ["USD"], required: false },
    ]);
    const lines = emitGraphQLEndpoint(
      endpoint,
      [],
      "getApiGraphql",
      "api-graphql",
      false
    );
    const code = lines.join("\n");
    expect(code).toContain("--locale <value>");
    expect(code).toContain("'en'");
    expect(code).toContain("--currency <value>");
    expect(code).toContain("'USD'");
  });

  it("handles variables override via --variables flag", () => {
    const endpoint = makeGraphQLEndpoint("GetUser", "{}", '{"id":"1"}');
    const lines = emitGraphQLEndpoint(
      endpoint,
      [],
      "getApiGraphql",
      "api-graphql",
      false
    );
    const code = lines.join("\n");
    expect(code).toContain("if (options.variables)");
    expect(code).toContain("variables = JSON.parse(options.variables)");
  });
});
