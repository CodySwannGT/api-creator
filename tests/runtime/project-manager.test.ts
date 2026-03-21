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
  mergeManifests,
} from "../../src/runtime/project-manager.js";
import type {
  ProjectManifest,
  ManifestEndpoint,
} from "../../src/runtime/project-manager.js";

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
  it("returns services path under cwd", () => {
    expect(getProjectsDir()).toMatch(/services$/);
  });
});

describe("getProjectDir", () => {
  it("returns path for a named project under services", () => {
    expect(getProjectDir("myapi")).toMatch(/services\/myapi$/);
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
      expect.stringMatching(/services\/test$/),
      { recursive: true }
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/services\/test\/manifest\.json$/),
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

describe("mergeManifests", () => {
  const makeEndpoint = (commandName: string): ManifestEndpoint => ({
    commandName,
    description: `desc ${commandName}`,
    methodName: commandName,
    httpMethod: "GET",
    path: `/${commandName}`,
    pathParams: [],
    isGraphQL: false,
    queryParams: [],
    hasBody: false,
  });

  const baseManifest: ProjectManifest = {
    name: "test",
    baseUrl: "https://api.test.com",
    originalUrl: "https://test.com",
    createdAt: "2026-01-01",
    authType: "cookie",
    endpoints: [],
  };

  it("preserves existing endpoints not in incoming", () => {
    const existing = { ...baseManifest, endpoints: [makeEndpoint("old-ep")] };
    const incoming = { ...baseManifest, endpoints: [makeEndpoint("new-ep")] };

    const result = mergeManifests(existing, incoming);

    const names = result.endpoints.map(ep => ep.commandName);
    expect(names).toContain("old-ep");
    expect(names).toContain("new-ep");
    expect(result.endpoints).toHaveLength(2);
  });

  it("updates existing endpoints with incoming data", () => {
    const oldEp = { ...makeEndpoint("shared"), description: "old" };
    const newEp = { ...makeEndpoint("shared"), description: "new" };

    const existing = { ...baseManifest, endpoints: [oldEp] };
    const incoming = { ...baseManifest, endpoints: [newEp] };

    const result = mergeManifests(existing, incoming);

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].description).toBe("new");
  });

  it("uses incoming manifest metadata", () => {
    const existing = {
      ...baseManifest,
      baseUrl: "https://old.com",
      endpoints: [],
    };
    const incoming = {
      ...baseManifest,
      baseUrl: "https://new.com",
      endpoints: [],
    };

    const result = mergeManifests(existing, incoming);

    expect(result.baseUrl).toBe("https://new.com");
  });
});
