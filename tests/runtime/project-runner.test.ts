import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

vi.mock("../../src/runtime/project-manager.js", () => ({
  listProjects: vi.fn(),
  loadManifest: vi.fn(),
  loadAuth: vi.fn(),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
}));

vi.mock("../../src/runtime/curl-parser.js", () => ({
  parseAuthFromCurl: vi.fn(),
}));

vi.mock("../../src/recorder/auth-capture.js", () => ({
  captureAuth: vi.fn(),
}));

vi.mock("../../src/runtime/endpoint-command-builder.js", () => ({
  registerEndpointCommand: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import {
  listProjects,
  loadManifest,
  loadAuth,
  saveAuth,
  clearAuth,
} from "../../src/runtime/project-manager.js";
import { parseAuthFromCurl } from "../../src/runtime/curl-parser.js";
import { captureAuth } from "../../src/recorder/auth-capture.js";
import { registerEndpointCommand } from "../../src/runtime/endpoint-command-builder.js";
import { registerProjectCommands } from "../../src/runtime/project-runner.js";
import type { ProjectManifest } from "../../src/runtime/project-manager.js";

const mockListProjects = listProjects as ReturnType<typeof vi.fn>;
const mockLoadManifest = loadManifest as ReturnType<typeof vi.fn>;
const mockLoadAuth = loadAuth as ReturnType<typeof vi.fn>;
const mockSaveAuth = saveAuth as ReturnType<typeof vi.fn>;
const mockClearAuth = clearAuth as ReturnType<typeof vi.fn>;
const mockParseAuthFromCurl = parseAuthFromCurl as ReturnType<typeof vi.fn>;
const mockCaptureAuth = captureAuth as ReturnType<typeof vi.fn>;
const mockRegisterEndpointCommand = registerEndpointCommand as ReturnType<
  typeof vi.fn
>;

const sampleManifest: ProjectManifest = {
  name: "myapi",
  baseUrl: "https://api.example.com",
  originalUrl: "https://example.com",
  createdAt: "2026-01-01",
  authType: "cookie",
  endpoints: [
    {
      commandName: "users",
      description: "List users",
      methodName: "getUsers",
      httpMethod: "GET",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: false,
    },
    {
      commandName: "create-user",
      description: "Create user",
      methodName: "createUser",
      httpMethod: "POST",
      path: "/users",
      pathParams: [],
      isGraphQL: false,
      queryParams: [],
      hasBody: true,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("registerProjectCommands", () => {
  it("does nothing when no projects exist", () => {
    mockListProjects.mockReturnValue([]);

    const program = new Command();
    registerProjectCommands(program);

    expect(program.commands).toHaveLength(0);
  });

  it("skips projects with no manifest", () => {
    mockListProjects.mockReturnValue(["broken"]);
    mockLoadManifest.mockReturnValue(null);

    const program = new Command();
    registerProjectCommands(program);

    expect(program.commands).toHaveLength(0);
  });

  it("registers a project command with description", () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);

    const program = new Command();
    registerProjectCommands(program);

    const projectCmd = program.commands.find(c => c.name() === "myapi");
    expect(projectCmd).toBeDefined();
    expect(projectCmd?.description()).toContain("https://example.com");
    expect(projectCmd?.description()).toContain("2 endpoints");
  });

  it("registers auth subcommands", () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);

    const program = new Command();
    registerProjectCommands(program);

    const projectCmd = program.commands.find(c => c.name() === "myapi");
    const authCmd = projectCmd?.commands.find(c => c.name() === "auth");
    expect(authCmd).toBeDefined();

    const authSubcommands = authCmd?.commands.map(c => c.name()) ?? [];
    expect(authSubcommands).toContain("setup");
    expect(authSubcommands).toContain("status");
    expect(authSubcommands).toContain("clear");
  });

  it("calls registerEndpointCommand for each endpoint", () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);

    const program = new Command();
    registerProjectCommands(program);

    expect(mockRegisterEndpointCommand).toHaveBeenCalledTimes(2);
    expect(mockRegisterEndpointCommand).toHaveBeenCalledWith(
      expect.any(Command),
      "myapi",
      sampleManifest,
      sampleManifest.endpoints[0]
    );
    expect(mockRegisterEndpointCommand).toHaveBeenCalledWith(
      expect.any(Command),
      "myapi",
      sampleManifest,
      sampleManifest.endpoints[1]
    );
  });

  it("registers multiple projects", () => {
    const manifest2: ProjectManifest = {
      ...sampleManifest,
      name: "other",
      originalUrl: "https://other.com",
      endpoints: [],
    };

    mockListProjects.mockReturnValue(["myapi", "other"]);
    mockLoadManifest.mockImplementation((name: string) =>
      name === "myapi" ? sampleManifest : manifest2
    );

    const program = new Command();
    registerProjectCommands(program);

    const names = program.commands.map(c => c.name());
    expect(names).toContain("myapi");
    expect(names).toContain("other");
  });
});

describe("auth status command", () => {
  it("shows not configured when no auth exists", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockLoadAuth.mockReturnValue(null);

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(["myapi", "auth", "status"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Not configured")
    );
  });

  it("shows auth details when configured with cookie", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockLoadAuth.mockReturnValue({ cookie: "session=abc" });

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(["myapi", "auth", "status"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith("Auth is configured.");
    expect(console.log).toHaveBeenCalledWith("  Type: cookie");
  });

  it("shows auth details when configured with token", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockLoadAuth.mockReturnValue({ token: "tok123" });

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(["myapi", "auth", "status"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith("  Type: bearer token");
  });

  it("shows auth details when configured with apiKey", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockLoadAuth.mockReturnValue({ apiKey: "key123" });

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(["myapi", "auth", "status"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith("  Type: API key");
  });

  it("shows extra headers count", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockLoadAuth.mockReturnValue({
      cookie: "c=1",
      extraHeaders: { "x-a": "1", "x-b": "2" },
    });

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(["myapi", "auth", "status"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith("  Extra headers: 2");
  });
});

describe("auth clear command", () => {
  it("calls clearAuth and logs confirmation", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(["myapi", "auth", "clear"], { from: "user" });

    expect(mockClearAuth).toHaveBeenCalledWith("myapi");
    expect(console.log).toHaveBeenCalledWith("Auth cleared.");
  });
});

describe("auth setup command", () => {
  it("uses browser auth by default and saves auth on success", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockCaptureAuth.mockResolvedValue({ cookie: "session=browser" });

    // Make stdin look like a TTY (default browser path)
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(["myapi", "auth", "setup"], { from: "user" });

    expect(mockCaptureAuth).toHaveBeenCalledWith("https://example.com");
    expect(mockSaveAuth).toHaveBeenCalledWith("myapi", {
      cookie: "session=browser",
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Auth saved.")
    );

    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      configurable: true,
    });
  });

  it("uses browser auth and exits when captureAuth returns null", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockCaptureAuth.mockResolvedValue(null);

    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const program = new Command();
    registerProjectCommands(program);

    await expect(
      program.parseAsync(["myapi", "auth", "setup"], { from: "user" })
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      configurable: true,
    });
  });

  it("reads auth from file with --file option", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockParseAuthFromCurl.mockReturnValue({ token: "file-token" });

    // Mock the dynamic import of node:fs inside readCurlAuthInput
    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      "curl -H 'Authorization: Bearer file-token' https://example.com"
    );

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(
      ["myapi", "auth", "setup", "--file", "/tmp/curl.txt"],
      { from: "user" }
    );

    expect(mockParseAuthFromCurl).toHaveBeenCalled();
    expect(mockSaveAuth).toHaveBeenCalledWith("myapi", { token: "file-token" });
  });

  it("exits when curl parsing fails from file", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockParseAuthFromCurl.mockReturnValue(null);

    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
      "not a curl command"
    );

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const program = new Command();
    registerProjectCommands(program);

    await expect(
      program.parseAsync(["myapi", "auth", "setup", "--file", "/tmp/bad.txt"], {
        from: "user",
      })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("prints auth summary with multiple auth types", async () => {
    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(sampleManifest);
    mockParseAuthFromCurl.mockReturnValue({
      cookie: "c=1",
      token: "tok",
      extraHeaders: { "x-key": "val" },
    });

    const { readFileSync } = await import("node:fs");
    (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue("curl ...");

    const program = new Command();
    registerProjectCommands(program);

    await program.parseAsync(
      ["myapi", "auth", "setup", "--file", "/tmp/curl.txt"],
      { from: "user" }
    );

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("cookie"));
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("bearer token")
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("1 extra header(s)")
    );
  });
});
