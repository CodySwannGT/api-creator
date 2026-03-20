import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/mock-home"),
}));

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import {
  getProjectsDir,
  getProjectDir,
  listProjects,
  loadManifest,
  saveManifest,
  loadAuth,
  saveAuth,
  clearAuth,
} from "../../src/runtime/project-manager.js";
import type { ProjectManifest } from "../../src/runtime/project-manager.js";

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getProjectsDir", () => {
  it("returns path under homedir", () => {
    expect(getProjectsDir()).toBe("/mock-home/.api-creator/projects");
  });
});

describe("getProjectDir", () => {
  it("returns path for a named project", () => {
    expect(getProjectDir("myapi")).toBe(
      "/mock-home/.api-creator/projects/myapi"
    );
  });
});

describe("listProjects", () => {
  it("returns empty array if projects dir does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(listProjects()).toEqual([]);
  });

  it("returns directory names from projects dir", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      { name: "proj-a", isDirectory: () => true },
      { name: "proj-b", isDirectory: () => true },
      { name: "readme.md", isDirectory: () => false },
    ]);
    expect(listProjects()).toEqual(["proj-a", "proj-b"]);
  });
});

describe("loadManifest", () => {
  const sampleManifest: ProjectManifest = {
    name: "test",
    baseUrl: "https://api.test.com",
    originalUrl: "https://test.com",
    createdAt: "2026-01-01",
    authType: "cookie",
    endpoints: [],
  };

  it("returns null if manifest file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadManifest("test")).toBeNull();
  });

  it("returns parsed manifest when file exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(sampleManifest));
    expect(loadManifest("test")).toEqual(sampleManifest);
  });

  it("returns null on invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not json");
    expect(loadManifest("test")).toBeNull();
  });
});

describe("saveManifest", () => {
  it("creates directory and writes manifest file", () => {
    const manifest: ProjectManifest = {
      name: "test",
      baseUrl: "https://api.test.com",
      originalUrl: "https://test.com",
      createdAt: "2026-01-01",
      authType: "cookie",
      endpoints: [],
    };

    saveManifest("test", manifest);

    expect(mockMkdirSync).toHaveBeenCalledWith(
      "/mock-home/.api-creator/projects/test",
      { recursive: true }
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/mock-home/.api-creator/projects/test/manifest.json",
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
  });
});

describe("loadAuth", () => {
  it("returns null if auth file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadAuth("test")).toBeNull();
  });

  it("returns parsed auth config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ cookie: "c=1" }));
    expect(loadAuth("test")).toEqual({ cookie: "c=1" });
  });

  it("returns null on invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{bad");
    expect(loadAuth("test")).toBeNull();
  });
});

describe("saveAuth", () => {
  it("creates directory and writes auth file", () => {
    saveAuth("test", { token: "tok" });

    expect(mockMkdirSync).toHaveBeenCalledWith("/mock-home/.api-creator", {
      recursive: true,
    });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/mock-home/.api-creator/test.auth",
      JSON.stringify({ token: "tok" }, null, 2),
      "utf-8"
    );
  });
});

describe("clearAuth", () => {
  it("deletes auth file if it exists", () => {
    mockExistsSync.mockReturnValue(true);
    clearAuth("test");
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      "/mock-home/.api-creator/test.auth"
    );
  });

  it("does nothing if auth file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    clearAuth("test");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});
