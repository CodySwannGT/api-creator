import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMocks = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
};

vi.mock("node:fs", () => ({
  default: fsMocks,
  ...fsMocks,
}));

vi.mock("../../src/importer/format-detector.js", () => ({
  detectFormat: vi.fn(),
}));

vi.mock("../../src/importer/paste-parser.js", () => ({
  parseInput: vi.fn(),
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

import { detectFormat } from "../../src/importer/format-detector.js";
import { parseInput } from "../../src/importer/paste-parser.js";

const mockExistsSync = fsMocks.existsSync;
const mockReadFileSync = fsMocks.readFileSync;
const mockDetectFormat = detectFormat as ReturnType<typeof vi.fn>;
const mockParseInput = parseInput as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("importCommand", () => {
  it("can be imported with correct name", async () => {
    const { importCommand } = await import("../../src/commands/import.js");
    expect(importCommand.name()).toBe("import");
    expect(importCommand.description()).toContain("Import");
  });

  it("reads from file when --file is provided", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "curl -H 'Cookie: c=1' https://api.example.com/users"
    );
    mockDetectFormat.mockReturnValue("curl");
    mockParseInput.mockReturnValue([
      {
        request: {
          method: "GET",
          url: "https://api.example.com/users",
          headers: [],
          queryString: [],
          httpVersion: "HTTP/1.1",
          cookies: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: 200,
          statusText: "OK",
          headers: [],
          content: { size: 0, mimeType: "application/json" },
          redirectURL: "",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headersSize: -1,
          bodySize: -1,
        },
        startedDateTime: "2026-01-01T00:00:00Z",
        time: 100,
        cache: {},
        timings: { send: 0, wait: 100, receive: 0 },
      },
    ]);

    const { importCommand } = await import("../../src/commands/import.js");

    await importCommand.parseAsync(["--file", "/tmp/curl.txt"], {
      from: "user",
    });

    expect(mockDetectFormat).toHaveBeenCalled();
    expect(mockParseInput).toHaveBeenCalled();
  });

  it("exits when file not found", async () => {
    mockExistsSync.mockReturnValue(false);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { importCommand } = await import("../../src/commands/import.js");

    await expect(
      importCommand.parseAsync(["--file", "/nonexistent.txt"], {
        from: "user",
      })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("exits when format is unknown", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("random gibberish");
    mockDetectFormat.mockReturnValue("unknown");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { importCommand } = await import("../../src/commands/import.js");

    await expect(
      importCommand.parseAsync(["--file", "/tmp/test.txt"], { from: "user" })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("exits when no requests could be parsed", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("curl https://example.com");
    mockDetectFormat.mockReturnValue("curl");
    mockParseInput.mockReturnValue([]);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { importCommand } = await import("../../src/commands/import.js");

    await expect(
      importCommand.parseAsync(["--file", "/tmp/test.txt"], { from: "user" })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });
});
