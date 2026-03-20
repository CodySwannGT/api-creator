import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("../../src/generator/codegen.js", () => ({
  generateClient: vi.fn(),
}));

import { readdir, stat } from "node:fs/promises";
import { generateClient } from "../../src/generator/codegen.js";

const mockReaddir = readdir as ReturnType<typeof vi.fn>;
const mockStat = stat as ReturnType<typeof vi.fn>;
const mockGenerateClient = generateClient as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Since findMostRecentHar and deriveNameFromHarPath are not exported,
// we test them indirectly through the command action.
describe("generateCommand", () => {
  it("can be imported without errors", async () => {
    const { generateCommand } = await import("../../src/commands/generate.js");
    expect(generateCommand.name()).toBe("generate");
    expect(generateCommand.description()).toContain("Generate");
  });

  it("has expected options", async () => {
    const { generateCommand } = await import("../../src/commands/generate.js");
    const optNames = generateCommand.options.map(
      (o: { long: string }) => o.long
    );
    expect(optNames).toContain("--input");
    expect(optNames).toContain("--name");
    expect(optNames).toContain("--base-url");
  });

  it("uses provided --input and --name options", async () => {
    mockGenerateClient.mockResolvedValue(undefined);

    const { generateCommand } = await import("../../src/commands/generate.js");

    // Create a fresh command to avoid state from prior tests
    const cmd = generateCommand;

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await cmd.parseAsync(["--input", "/tmp/test.har", "--name", "myapi"], {
      from: "user",
    });

    expect(mockGenerateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "myapi",
      })
    );

    exitSpy.mockRestore();
  });

  it("exits when no HAR file found and no --input", async () => {
    mockReaddir.mockResolvedValue([]);

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      generateCommand.parseAsync([], { from: "user" })
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("auto-discovers most recent HAR file when no --input", async () => {
    mockReaddir.mockResolvedValue(["older.har", "newer.har"]);
    mockStat
      .mockResolvedValueOnce({ mtimeMs: 1000 })
      .mockResolvedValueOnce({ mtimeMs: 2000 });
    mockGenerateClient.mockResolvedValue(undefined);

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await generateCommand.parseAsync([], { from: "user" });

    expect(mockGenerateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: expect.stringContaining("newer.har"),
      })
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Using HAR file")
    );

    exitSpy.mockRestore();
  });

  it("derives name from HAR path when --name not provided", async () => {
    mockGenerateClient.mockResolvedValue(undefined);

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await generateCommand.parseAsync(
      ["--input", "/recordings/airbnb.com.har"],
      { from: "user" }
    );

    expect(mockGenerateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "airbnb",
      })
    );

    exitSpy.mockRestore();
  });

  it("handles readdir error for non-existent directory", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      generateCommand.parseAsync([], { from: "user" })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("handles stat error for individual HAR files", async () => {
    mockReaddir.mockResolvedValue(["bad.har"]);
    mockStat.mockRejectedValue(new Error("stat error"));

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      generateCommand.parseAsync([], { from: "user" })
    ).rejects.toThrow("process.exit");

    exitSpy.mockRestore();
  });

  it("handles generateClient throwing an error", async () => {
    mockGenerateClient.mockRejectedValue(new Error("generation failed"));

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      generateCommand.parseAsync(["--input", "/tmp/test.har"], {
        from: "user",
      })
    ).rejects.toThrow("process.exit");

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("generation failed")
    );

    exitSpy.mockRestore();
  });

  it("passes --base-url option to generateClient", async () => {
    mockGenerateClient.mockResolvedValue(undefined);

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await generateCommand.parseAsync(
      ["--input", "/tmp/test.har", "--base-url", "https://custom.api.com"],
      { from: "user" }
    );

    expect(mockGenerateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://custom.api.com",
      })
    );

    exitSpy.mockRestore();
  });

  it("filters non-har files from directory listing", async () => {
    mockReaddir.mockResolvedValue(["readme.md", "data.json", "valid.har"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });
    mockGenerateClient.mockResolvedValue(undefined);

    const { generateCommand } = await import("../../src/commands/generate.js");

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await generateCommand.parseAsync([], { from: "user" });

    expect(mockGenerateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: expect.stringContaining("valid.har"),
      })
    );

    exitSpy.mockRestore();
  });
});
