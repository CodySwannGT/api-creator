import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

vi.mock("../../src/runtime/project-manager.js", () => ({
  loadAuth: vi.fn(),
}));

vi.mock("../../src/runtime/http-client.js", () => ({
  httpRequest: vi.fn(),
  HttpError: class HttpError extends Error {
    status: number;
    body: string;
    /**
     *
     * @param status
     * @param body
     */
    constructor(status: number, body: string) {
      super(`HTTP ${status}`);
      this.name = "HttpError";
      this.status = status;
      this.body = body;
    }
  },
}));

import { loadAuth } from "../../src/runtime/project-manager.js";
import { httpRequest } from "../../src/runtime/http-client.js";
import { registerEndpointCommand } from "../../src/runtime/endpoint-command-builder.js";
import type {
  ProjectManifest,
  ManifestEndpoint,
} from "../../src/runtime/project-manager.js";

const mockLoadAuth = loadAuth as ReturnType<typeof vi.fn>;
const mockHttpRequest = httpRequest as ReturnType<typeof vi.fn>;

const manifest: ProjectManifest = {
  name: "test-api",
  baseUrl: "https://api.example.com",
  originalUrl: "https://example.com",
  createdAt: "2026-01-01",
  authType: "cookie",
  endpoints: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("registerEndpointCommand", () => {
  it("registers a subcommand with the correct name and description", () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "users",
      description: "List users",
      methodName: "getUsers",
      httpMethod: "GET",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    const registered = parent.commands.find(c => c.name() === "users");
    expect(registered).toBeDefined();
    expect(registered?.description()).toBe("List users");
  });

  it("registers path param arguments", () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "user",
      description: "Get user by ID",
      methodName: "getUser",
      httpMethod: "GET",
      path: "/users/:id",
      pathParams: ["userId"],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    const registered = parent.commands.find(c => c.name() === "user");
    const args = registered?.registeredArguments ?? [];
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe("userId");
  });

  it("registers body options for endpoints with hasBody", () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "create-user",
      description: "Create a user",
      methodName: "createUser",
      httpMethod: "POST",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: true,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    const registered = parent.commands.find(c => c.name() === "create-user");
    const optNames = registered?.options.map(o => o.long) ?? [];
    expect(optNames).toContain("--body");
    expect(optNames).toContain("--json");
    expect(optNames).toContain("--raw");
  });

  it("registers query param options", () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "search",
      description: "Search items",
      methodName: "searchItems",
      httpMethod: "GET",
      path: "/search",
      pathParams: [],
      isGraphQL: false,
      queryParams: [{ name: "q" }, { name: "limit", defaultValue: "10" }],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    const registered = parent.commands.find(c => c.name() === "search");
    const optNames = registered?.options.map(o => o.long) ?? [];
    expect(optNames).toContain("--q");
    expect(optNames).toContain("--limit");
  });

  it("registers GraphQL variable options", () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "gql-query",
      description: "GraphQL query",
      methodName: "gqlQuery",
      httpMethod: "GET",
      path: "/graphql",
      pathParams: [],
      isGraphQL: true,
      operationName: "GetData",
      variables: [
        { camelName: "userId", kebabName: "user-id", exampleValue: "123" },
      ],
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    const registered = parent.commands.find(c => c.name() === "gql-query");
    const optNames = registered?.options.map(o => o.long) ?? [];
    expect(optNames).toContain("--user-id");
    expect(optNames).toContain("--variables");
  });

  it("action handler calls httpRequest on success", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "users",
      description: "List users",
      methodName: "getUsers",
      httpMethod: "GET",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ cookie: "c=1" });
    mockHttpRequest.mockResolvedValue({ users: [] });

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await parent.parseAsync(["users"], { from: "user" });

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://api.example.com",
        path: "/users",
        method: "GET",
        auth: { cookie: "c=1" },
      })
    );

    exitSpy.mockRestore();
  });

  it("action handler exits when no auth configured", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "users",
      description: "List users",
      methodName: "getUsers",
      httpMethod: "GET",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue(null);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      parent.parseAsync(["users"], { from: "user" })
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("action handler passes path params correctly", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "user",
      description: "Get user",
      methodName: "getUser",
      httpMethod: "GET",
      path: "/users/:id",
      pathParams: ["userId"],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ token: "tok" });
    mockHttpRequest.mockResolvedValue({ id: "42" });

    await parent.parseAsync(["user", "42"], { from: "user" });

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/users/42",
      })
    );
  });

  it("action handler passes query params", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "search",
      description: "Search",
      methodName: "search",
      httpMethod: "GET",
      path: "/search",
      pathParams: [],
      isGraphQL: false,
      queryParams: [{ name: "q" }],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ token: "tok" });
    mockHttpRequest.mockResolvedValue({ results: [] });

    await parent.parseAsync(["search", "--q", "hello"], { from: "user" });

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: expect.objectContaining({ q: "hello" }),
      })
    );
  });

  it("action handler sends body with --body option", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "create-user",
      description: "Create user",
      methodName: "createUser",
      httpMethod: "POST",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: true,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ token: "tok" });
    mockHttpRequest.mockResolvedValue({ id: 1 });

    await parent.parseAsync(["create-user", "--body", '{"name":"test"}'], {
      from: "user",
    });

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { name: "test" },
      })
    );
  });

  it("action handler outputs compact JSON with --raw", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "users",
      description: "List users",
      methodName: "getUsers",
      httpMethod: "GET",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ cookie: "c=1" });
    mockHttpRequest.mockResolvedValue({ data: [1, 2] });

    await parent.parseAsync(["users", "--raw"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith('{"data":[1,2]}');
  });

  it("action handler handles HttpError from request", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "users",
      description: "List users",
      methodName: "getUsers",
      httpMethod: "GET",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ cookie: "c=1" });

    // Import the mocked HttpError class
    const { HttpError } = await import("../../src/runtime/http-client.js");
    mockHttpRequest.mockRejectedValue(new HttpError(500, "Server Error"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      parent.parseAsync(["users"], { from: "user" })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("action handler builds GraphQL query params", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "gql",
      description: "GraphQL query",
      methodName: "gqlQuery",
      httpMethod: "GET",
      path: "/graphql",
      pathParams: [],
      isGraphQL: true,
      operationName: "GetUser",
      extensions: '{"hash":"abc"}',
      variables: [
        { camelName: "userId", kebabName: "user-id", exampleValue: "123" },
      ],
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ token: "tok" });
    mockHttpRequest.mockResolvedValue({ data: {} });

    await parent.parseAsync(["gql", "--user-id", "42"], { from: "user" });

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: expect.objectContaining({
          operationName: "GetUser",
          extensions: '{"hash":"abc"}',
        }),
      })
    );
  });

  it("action handler uses --variables JSON for GraphQL", async () => {
    const parent = new Command("test-api");
    const endpoint: ManifestEndpoint = {
      commandName: "gql",
      description: "GraphQL query",
      methodName: "gqlQuery",
      httpMethod: "GET",
      path: "/graphql",
      pathParams: [],
      isGraphQL: true,
      operationName: "GetUser",
      variables: [],
      queryParams: [],
      hasBody: false,
    };

    registerEndpointCommand(parent, "test-api", manifest, endpoint);

    mockLoadAuth.mockReturnValue({ token: "tok" });
    mockHttpRequest.mockResolvedValue({ data: {} });

    await parent.parseAsync(["gql", "--variables", '{"id":"99"}'], {
      from: "user",
    });

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: expect.objectContaining({
          variables: '{"id":"99"}',
        }),
      })
    );
  });
});
