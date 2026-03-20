import { describe, it, expect } from "vitest";
import { emitCli } from "../../src/generator/cli-entrypoint-emitter.js";
import type { Endpoint } from "../../src/types/endpoint.js";
import type { AuthInfo } from "../../src/types/auth.js";

describe("emitCli", () => {
  const endpoints: Endpoint[] = [];
  const authInfos: AuthInfo[] = [];

  it("includes commander imports", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain("import { Command } from 'commander';");
    expect(code).toContain("import { createInterface } from 'node:readline';");
  });

  it("includes auth module imports", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain(
      "import { loadAuth, saveAuth, isAuthConfigured, clearAuth, AUTH_TYPE, ORIGINAL_URL, CLI_NAME } from './auth.js';"
    );
    expect(code).toContain("import type { AuthConfig } from './auth.js';");
  });

  it("includes client and commands imports", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain("import { ApiClient } from './client.js';");
    expect(code).toContain(
      "import { registerEndpointCommands } from './commands.js';"
    );
  });

  it("sets up program with name and version", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://example.com"
    );
    expect(code).toContain("const program = new Command('my-cli');");
    expect(code).toContain("program.version('0.1.0');");
    expect(code).toContain(
      "program.description('Auto-generated CLI for https://example.com');"
    );
  });

  it("includes auth setup command", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain("authCmd.command('setup')");
    expect(code).toContain("Configure authentication from a cURL command");
  });

  it("includes parseAuthFromInput function", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain(
      "function parseAuthFromInput(input: string): AuthConfig | null {"
    );
    expect(code).toContain("const isCurl = /^curl\\s/i.test(joined);");
  });

  it("includes auth status command with base URL", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain("authCmd.command('status')");
    expect(code).toContain("Check if authentication is configured");
    expect(code).toContain("new ApiClient('https://api.example.com', auth)");
  });

  it("includes auth clear command", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain("authCmd.command('clear')");
    expect(code).toContain("clearAuth();");
  });

  it("registers endpoint commands and parses", () => {
    const code = emitCli(
      "my-cli",
      endpoints,
      authInfos,
      "https://api.example.com",
      "https://api.example.com"
    );
    expect(code).toContain("registerEndpointCommands(program);");
    expect(code).toContain("program.parse();");
  });

  it("uses the correct base URL in status health check", () => {
    const code = emitCli(
      "test-cli",
      endpoints,
      authInfos,
      "https://custom-api.com/v2",
      "https://original.com"
    );
    expect(code).toContain("new ApiClient('https://custom-api.com/v2', auth)");
    expect(code).toContain("const program = new Command('test-cli');");
  });
});
