import { describe, it, expect } from "vitest";
import {
  emitProjectPackageJson,
  emitProjectTsconfig,
  emitProjectGitignore,
  emitProjectBinEntry,
  emitProjectReadme,
} from "../../src/generator/cli-project-emitter.js";
import type { Endpoint } from "../../src/types/endpoint.js";
import type { AuthInfo } from "../../src/types/auth.js";

/**
 *
 * @param method
 * @param path
 */
function makeEndpoint(method: string, path: string): Endpoint {
  return {
    method,
    normalizedPath: path,
    originalUrls: [`https://api.example.com${path}`],
    queryParams: [],
    requestBodies: [],
    responseBodies: [],
    responseStatuses: [200],
    headers: {},
  };
}

describe("emitProjectPackageJson", () => {
  it("generates valid package.json with project name", () => {
    const output = emitProjectPackageJson("my-api");
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("my-api");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.type).toBe("module");
    expect(parsed.bin["my-api"]).toBe("./bin/cli.js");
    expect(parsed.scripts.build).toBe("tsc");
    expect(parsed.dependencies.commander).toBe("^14.0.0");
  });

  it("ends with a newline", () => {
    const output = emitProjectPackageJson("test");
    expect(output.endsWith("\n")).toBe(true);
  });
});

describe("emitProjectTsconfig", () => {
  it("generates valid tsconfig with expected compiler options", () => {
    const output = emitProjectTsconfig();
    const parsed = JSON.parse(output);
    expect(parsed.compilerOptions.target).toBe("ES2022");
    expect(parsed.compilerOptions.module).toBe("NodeNext");
    expect(parsed.compilerOptions.strict).toBe(true);
    expect(parsed.compilerOptions.outDir).toBe("dist");
    expect(parsed.compilerOptions.rootDir).toBe("src");
    expect(parsed.include).toEqual(["src"]);
  });
});

describe("emitProjectGitignore", () => {
  it("includes node_modules, dist, and .auth", () => {
    const output = emitProjectGitignore();
    expect(output).toContain("node_modules");
    expect(output).toContain("dist");
    expect(output).toContain(".auth");
  });
});

describe("emitProjectBinEntry", () => {
  it("generates a shebang script importing dist/cli.js", () => {
    const output = emitProjectBinEntry("my-cli");
    expect(output).toContain("#!/usr/bin/env node");
    expect(output).toContain("import '../dist/cli.js';");
  });
});

describe("emitProjectReadme", () => {
  const endpoints: Endpoint[] = [
    makeEndpoint("GET", "/users"),
    makeEndpoint("POST", "/users"),
    makeEndpoint("GET", "/users/:id"),
  ];

  it("includes project name as heading", () => {
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("# my-cli");
  });

  it("includes original URL", () => {
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("https://api.example.com");
  });

  it("includes setup section", () => {
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("## Setup");
    expect(output).toContain("npm install");
    expect(output).toContain("npm run build");
  });

  it("shows bearer auth description", () => {
    const auth: AuthInfo[] = [
      {
        type: "bearer",
        location: "header",
        key: "Authorization",
        value: "Bearer tok",
        confidence: 1,
      },
    ];
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      auth,
      "https://api.example.com"
    );
    expect(output).toContain("bearer token authentication");
  });

  it("shows cookie auth description", () => {
    const auth: AuthInfo[] = [
      {
        type: "cookie",
        location: "cookie",
        key: "session",
        value: "sess",
        confidence: 0.8,
      },
    ];
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      auth,
      "https://api.example.com"
    );
    expect(output).toContain("cookie-based authentication");
  });

  it("shows api-key auth description", () => {
    const auth: AuthInfo[] = [
      {
        type: "api-key",
        location: "header",
        key: "X-API-Key",
        value: "key",
        confidence: 0.7,
      },
    ];
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      auth,
      "https://api.example.com"
    );
    expect(output).toContain("API key authentication");
  });

  it("shows default auth description when no auth", () => {
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("Configure authentication by running:");
  });

  it("includes endpoint examples", () => {
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("## Commands");
    expect(output).toContain("GET /users");
  });

  it("shows overflow count when more than 5 endpoints", () => {
    const manyEndpoints = Array.from({ length: 7 }, (_, i) =>
      makeEndpoint("GET", `/resource${i}`)
    );
    const output = emitProjectReadme(
      "my-cli",
      manyEndpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("... and 2 more");
  });

  it("includes auth setup command", () => {
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("my-cli auth setup");
  });

  it("includes api-creator attribution", () => {
    const output = emitProjectReadme(
      "my-cli",
      endpoints,
      [],
      "https://api.example.com"
    );
    expect(output).toContain("api-creator");
  });
});
