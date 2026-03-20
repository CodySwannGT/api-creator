import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/runtime/project-manager.js", () => ({
  getProjectDir: vi.fn(),
  loadManifest: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import {
  getProjectDir,
  loadManifest,
} from "../../src/runtime/project-manager.js";
import type { ProjectManifest } from "../../src/runtime/project-manager.js";

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockCopyFileSync = copyFileSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockGetProjectDir = getProjectDir as ReturnType<typeof vi.fn>;
const mockLoadManifest = loadManifest as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("exportCommand", () => {
  it("exits when project not found", async () => {
    mockLoadManifest.mockReturnValue(null);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { exportCommand } = await import("../../src/commands/export.js");

    await expect(
      exportCommand.parseAsync(["myapi"], { from: "user" })
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("copies files when project exists", async () => {
    const manifest: ProjectManifest = {
      name: "myapi",
      baseUrl: "https://api.example.com",
      originalUrl: "https://example.com",
      createdAt: "2026-01-01",
      authType: "cookie",
      endpoints: [],
    };

    mockLoadManifest.mockReturnValue(manifest);
    mockGetProjectDir.mockReturnValue("/mock-home/.api-creator/projects/myapi");
    mockExistsSync.mockReturnValue(true);

    const { exportCommand } = await import("../../src/commands/export.js");

    await exportCommand.parseAsync(["myapi"], { from: "user" });

    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockCopyFileSync).toHaveBeenCalledTimes(2);
  });

  it("reports when no files found to export", async () => {
    const manifest: ProjectManifest = {
      name: "myapi",
      baseUrl: "https://api.example.com",
      originalUrl: "https://example.com",
      createdAt: "2026-01-01",
      authType: "cookie",
      endpoints: [],
    };

    mockLoadManifest.mockReturnValue(manifest);
    mockGetProjectDir.mockReturnValue("/mock-home/.api-creator/projects/myapi");
    mockExistsSync.mockReturnValue(false);

    const { exportCommand } = await import("../../src/commands/export.js");

    await exportCommand.parseAsync(["myapi"], { from: "user" });

    expect(mockCopyFileSync).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("No TypeScript files")
    );
  });
});
