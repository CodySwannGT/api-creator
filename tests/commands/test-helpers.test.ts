import { describe, it, expect } from "vitest";
import {
  parseEndpoints,
  extractBaseUrl,
  buildAuthHeaders,
  findHealthCheckEndpoint,
  selectTestEndpoints,
} from "../../src/commands/test-helpers.js";
import type { ParsedEndpoint } from "../../src/commands/test-helpers.js";

const SAMPLE_CLIENT_SOURCE = `
class ApiClient {
  constructor(baseUrl: string = 'https://api.example.com/v1') {
    this.baseUrl = baseUrl;
  }

  async _fetch(path: string, opts: any): Promise<any> {
    return fetch(path, opts);
  }

  async listUsers(options?: any): Promise<any> {
    return this._fetch('/users', { method: 'GET' });
  }

  async getUser(userId: string): Promise<any> {
    return this._fetch(\`/users/\${userId}\`, { method: 'GET' });
  }

  async createUser(body: any): Promise<any> {
    return this._fetch('/users', { method: 'POST', body });
  }

  async healthCheck(): Promise<any> {
    return this._fetch('/health', { method: 'GET' });
  }
}
`;

describe("parseEndpoints", () => {
  it("extracts endpoint names from client source", () => {
    const endpoints = parseEndpoints(SAMPLE_CLIENT_SOURCE);
    const names = endpoints.map(e => e.name);
    expect(names).toContain("listUsers");
    expect(names).toContain("getUser");
    expect(names).toContain("createUser");
  });

  it("excludes methods starting with underscore", () => {
    const endpoints = parseEndpoints(SAMPLE_CLIENT_SOURCE);
    const names = endpoints.map(e => e.name);
    expect(names).not.toContain("_fetch");
  });

  it("excludes healthCheck method", () => {
    const endpoints = parseEndpoints(SAMPLE_CLIENT_SOURCE);
    const names = endpoints.map(e => e.name);
    expect(names).not.toContain("healthCheck");
  });

  it("detects HTTP methods", () => {
    const endpoints = parseEndpoints(SAMPLE_CLIENT_SOURCE);
    const createUser = endpoints.find(e => e.name === "createUser");
    expect(createUser?.method).toBe("POST");
  });

  it("detects body parameter", () => {
    const endpoints = parseEndpoints(SAMPLE_CLIENT_SOURCE);
    const createUser = endpoints.find(e => e.name === "createUser");
    expect(createUser?.hasBody).toBe(true);
  });

  it("detects params", () => {
    const endpoints = parseEndpoints(SAMPLE_CLIENT_SOURCE);
    const getUser = endpoints.find(e => e.name === "getUser");
    expect(getUser?.params).toContain("userId");
  });

  it("returns empty array for source with no methods", () => {
    expect(parseEndpoints("class Empty {}")).toEqual([]);
  });
});

describe("extractBaseUrl", () => {
  it("extracts base URL from constructor", () => {
    expect(extractBaseUrl(SAMPLE_CLIENT_SOURCE)).toBe(
      "https://api.example.com/v1"
    );
  });

  it("returns null if no constructor match", () => {
    expect(extractBaseUrl("class Foo {}")).toBeNull();
  });
});

describe("buildAuthHeaders", () => {
  it("returns cookie auth headers", () => {
    const result = buildAuthHeaders("", { cookie: "session=abc" });
    expect(result).toEqual({
      headers: { Cookie: "session=abc" },
      hasAuth: true,
      description: "cookie",
    });
  });

  it("returns bearer token auth headers", () => {
    const result = buildAuthHeaders("", { token: "my-token" });
    expect(result).toEqual({
      headers: { Authorization: "Bearer my-token" },
      hasAuth: true,
      description: "bearer token",
    });
  });

  it("returns API key auth headers with default header name", () => {
    const result = buildAuthHeaders("", { apiKey: "key123" });
    expect(result).toEqual({
      headers: { "X-API-Key": "key123" },
      hasAuth: true,
      description: "API key (X-API-Key)",
    });
  });

  it("extracts custom API key header name from source", () => {
    const source = "headers.set('X-Custom-Key', this.auth.apiKey)";
    const result = buildAuthHeaders(source, { apiKey: "key123" });
    expect(result).toEqual({
      headers: { "X-Custom-Key": "key123" },
      hasAuth: true,
      description: "API key (X-Custom-Key)",
    });
  });

  it("returns empty when no auth provided", () => {
    const result = buildAuthHeaders("", {});
    expect(result).toEqual({
      headers: {},
      hasAuth: false,
      description: "none",
    });
  });

  it("prioritizes cookie over token", () => {
    const result = buildAuthHeaders("", {
      cookie: "c=1",
      token: "tok",
    });
    expect(result.description).toBe("cookie");
  });
});

describe("findHealthCheckEndpoint", () => {
  const endpoints: ParsedEndpoint[] = [
    {
      name: "getUser",
      method: "GET",
      path: "/users/:id",
      params: ["userId"],
      hasBody: false,
      hasQueryParams: false,
    },
    {
      name: "listItems",
      method: "GET",
      path: "/items",
      params: [],
      hasBody: false,
      hasQueryParams: false,
    },
    {
      name: "createUser",
      method: "POST",
      path: "/users",
      params: [],
      hasBody: true,
      hasQueryParams: false,
    },
  ];

  it("returns a GET endpoint with no params and no body", () => {
    const result = findHealthCheckEndpoint(endpoints);
    expect(result?.name).toBe("listItems");
  });

  it("returns null if no suitable endpoint", () => {
    const noMatch: ParsedEndpoint[] = [
      {
        name: "getUser",
        method: "GET",
        path: "/users/:id",
        params: ["userId"],
        hasBody: false,
        hasQueryParams: false,
      },
    ];
    expect(findHealthCheckEndpoint(noMatch)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(findHealthCheckEndpoint([])).toBeNull();
  });
});

describe("selectTestEndpoints", () => {
  it("selects safe GET endpoints without Id params", () => {
    const endpoints: ParsedEndpoint[] = [
      {
        name: "listUsers",
        method: "GET",
        path: "/users",
        params: [],
        hasBody: false,
        hasQueryParams: false,
      },
      {
        name: "getUser",
        method: "GET",
        path: "/users/:id",
        params: ["userId"],
        hasBody: false,
        hasQueryParams: false,
      },
      {
        name: "createUser",
        method: "POST",
        path: "/users",
        params: [],
        hasBody: true,
        hasQueryParams: false,
      },
    ];
    const result = selectTestEndpoints(endpoints);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("listUsers");
  });

  it("limits to 5 results", () => {
    const endpoints: ParsedEndpoint[] = Array.from({ length: 10 }, (_, i) => ({
      name: `list${i}`,
      method: "GET",
      path: `/${i}`,
      params: [],
      hasBody: false,
      hasQueryParams: false,
    }));
    expect(selectTestEndpoints(endpoints)).toHaveLength(5);
  });

  it("falls back to any GET when no safe endpoints", () => {
    const endpoints: ParsedEndpoint[] = [
      {
        name: "getUser",
        method: "GET",
        path: "/users/:id",
        params: ["userId"],
        hasBody: false,
        hasQueryParams: false,
      },
      {
        name: "createUser",
        method: "POST",
        path: "/users",
        params: [],
        hasBody: true,
        hasQueryParams: false,
      },
    ];
    const result = selectTestEndpoints(endpoints);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("getUser");
  });

  it("returns empty if no GET endpoints", () => {
    const endpoints: ParsedEndpoint[] = [
      {
        name: "createUser",
        method: "POST",
        path: "/users",
        params: [],
        hasBody: true,
        hasQueryParams: false,
      },
    ];
    expect(selectTestEndpoints(endpoints)).toEqual([]);
  });
});
