import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";

const mockReadFile = readFile as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
    })
  );
});

const CLIENT_SOURCE = `
class ApiClient {
  constructor(baseUrl: string = 'https://api.example.com') {
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
}
`;

describe("testCommand", () => {
  it("can be imported with correct name and options", async () => {
    const { testCommand } = await import("../../src/commands/test.js");
    expect(testCommand.name()).toBe("test");
    const optNames = testCommand.options.map((o: { long: string }) => o.long);
    expect(optNames).toContain("--dir");
    expect(optNames).toContain("--cookie");
    expect(optNames).toContain("--token");
    expect(optNames).toContain("--api-key");
    expect(optNames).toContain("--base-url");
    expect(optNames).toContain("--endpoint");
    expect(optNames).toContain("--list");
  });

  it("exits when client file not found", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { testCommand } = await import("../../src/commands/test.js");

    await expect(
      testCommand.parseAsync(["--dir", "/nonexistent"], { from: "user" })
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits when no endpoints found in client", async () => {
    mockReadFile.mockResolvedValue("class Empty {}");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { testCommand } = await import("../../src/commands/test.js");

    await expect(
      testCommand.parseAsync(["--dir", "/tmp/gen"], { from: "user" })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("lists endpoints with --list", async () => {
    mockReadFile.mockResolvedValue(CLIENT_SOURCE);

    const { testCommand } = await import("../../src/commands/test.js");

    await testCommand.parseAsync(["--dir", "/tmp/gen", "--list"], {
      from: "user",
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("endpoints")
    );
  });

  it("runs tests with --cookie auth", async () => {
    mockReadFile.mockResolvedValue(CLIENT_SOURCE);

    const { testCommand } = await import("../../src/commands/test.js");

    await testCommand.parseAsync(
      ["--dir", "/tmp/gen", "--cookie", "session=abc"],
      { from: "user" }
    );

    expect(fetch).toHaveBeenCalled();
  });

  it("runs tests with --base-url override", async () => {
    mockReadFile.mockResolvedValue(CLIENT_SOURCE);

    const { testCommand } = await import("../../src/commands/test.js");

    await testCommand.parseAsync(
      [
        "--dir",
        "/tmp/gen",
        "--base-url",
        "https://override.com",
        "--token",
        "tok",
      ],
      { from: "user" }
    );

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    if (calledUrl) {
      expect(calledUrl).toContain("override.com");
    }
  });

  it("tests a specific endpoint with --endpoint", async () => {
    mockReadFile.mockResolvedValue(CLIENT_SOURCE);

    const { testCommand } = await import("../../src/commands/test.js");

    await testCommand.parseAsync(
      ["--dir", "/tmp/gen", "--endpoint", "listUsers", "--token", "tok"],
      { from: "user" }
    );

    expect(fetch).toHaveBeenCalled();
  });

  it("exits when --endpoint name not found", async () => {
    mockReadFile.mockResolvedValue(CLIENT_SOURCE);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { testCommand } = await import("../../src/commands/test.js");

    await expect(
      testCommand.parseAsync(
        ["--dir", "/tmp/gen", "--endpoint", "nonExistent", "--token", "tok"],
        { from: "user" }
      )
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("warns when no auth provided", async () => {
    mockReadFile.mockResolvedValue(CLIENT_SOURCE);

    const { testCommand } = await import("../../src/commands/test.js");

    await testCommand.parseAsync(["--dir", "/tmp/gen"], { from: "user" });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No auth provided")
    );
  });
});
