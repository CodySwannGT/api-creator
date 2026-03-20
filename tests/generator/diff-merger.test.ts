import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mergeEndpoints,
  detectExistingClient,
  applyMerge,
} from "../../src/generator/diff-merger.js";
import type {
  ExistingClient,
  MergeResult,
} from "../../src/generator/diff-merger.js";
import type { Endpoint } from "../../src/types/endpoint.js";

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

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

/**
 *
 * @param methodNames
 */
function makeExisting(methodNames: string[]): ExistingClient {
  return {
    methodNames,
    typeNames: [],
    customSections: [],
    clientSource: "",
    typesSource: "",
  };
}

describe("mergeEndpoints", () => {
  it("detects added endpoints", () => {
    const existing = makeExisting(["getUsers"]);
    const newEndpoints = [
      makeEndpoint("GET", "/users"),
      makeEndpoint("POST", "/users"),
    ];
    const result = mergeEndpoints(existing, newEndpoints, []);
    expect(result.added).toContain("createUsers");
    expect(result.updated).toContain("getUsers");
    expect(result.hasChanges).toBe(true);
  });

  it("detects deprecated endpoints", () => {
    const existing = makeExisting(["getUsers", "deleteUsers"]);
    const newEndpoints = [makeEndpoint("GET", "/users")];
    const result = mergeEndpoints(existing, newEndpoints, []);
    expect(result.deprecated).toContain("deleteUsers");
    expect(result.hasChanges).toBe(true);
  });

  it("detects updated endpoints", () => {
    const existing = makeExisting(["getUsers"]);
    const newEndpoints = [makeEndpoint("GET", "/users")];
    const result = mergeEndpoints(existing, newEndpoints, []);
    expect(result.updated).toContain("getUsers");
    expect(result.added).toHaveLength(0);
    expect(result.deprecated).toHaveLength(0);
  });

  it("reports no changes when endpoints match", () => {
    const existing = makeExisting(["getUsers"]);
    const newEndpoints = [makeEndpoint("GET", "/users")];
    const result = mergeEndpoints(existing, newEndpoints, []);
    expect(result.hasChanges).toBe(true); // updated counts as a change
    expect(result.summary).toContain("updated");
  });

  it("reports no changes for empty sets", () => {
    const existing = makeExisting([]);
    const result = mergeEndpoints(existing, [], []);
    expect(result.hasChanges).toBe(false);
    expect(result.summary).toBe("No changes detected");
  });

  it("builds correct summary with all categories", () => {
    const existing = makeExisting(["getUsers", "oldMethod"]);
    const newEndpoints = [
      makeEndpoint("GET", "/users"),
      makeEndpoint("POST", "/items"),
    ];
    const result = mergeEndpoints(existing, newEndpoints, []);
    expect(result.summary).toContain("Added 1 new endpoint");
    expect(result.summary).toContain("updated 1 type");
    expect(result.summary).toContain("1 endpoint deprecated");
  });

  it("pluralizes summary correctly for multiple additions", () => {
    const existing = makeExisting([]);
    const newEndpoints = [
      makeEndpoint("GET", "/users"),
      makeEndpoint("GET", "/items"),
    ];
    const result = mergeEndpoints(existing, newEndpoints, []);
    expect(result.summary).toContain("Added 2 new endpoints");
  });

  it("handles path with :id correctly", () => {
    const existing = makeExisting([]);
    const newEndpoints = [makeEndpoint("GET", "/users/:id")];
    const result = mergeEndpoints(existing, newEndpoints, []);
    expect(result.added).toContain("getUsersById");
  });
});

describe("detectExistingClient", () => {
  it("returns null when files do not exist", async () => {
    const { access } = await import("node:fs/promises");
    vi.mocked(access).mockRejectedValueOnce(new Error("ENOENT"));
    const result = await detectExistingClient("/fake/dir");
    expect(result).toBeNull();
  });

  it("parses method names from client source", async () => {
    const { access, readFile } = await import("node:fs/promises");
    vi.mocked(access).mockResolvedValue(undefined);
    const clientSource = `
export class ApiClient {
  async getUsers() {}
  async createUsers(body: any) {}
}`;
    const typesSource = `
export interface GetUsersResponse {
  id: number;
}`;
    vi.mocked(readFile)
      .mockResolvedValueOnce(clientSource as never)
      .mockResolvedValueOnce(typesSource as never);

    const result = await detectExistingClient("/fake/dir");
    expect(result).not.toBeNull();
    expect(result!.methodNames).toContain("getUsers");
    expect(result!.methodNames).toContain("createUsers");
    expect(result!.typeNames).toContain("GetUsersResponse");
  });

  it("parses custom sections", async () => {
    const { access, readFile } = await import("node:fs/promises");
    vi.mocked(access).mockResolvedValue(undefined);
    const clientSource = `
// @custom mySection
custom code here
// @end-custom
`;
    vi.mocked(readFile)
      .mockResolvedValueOnce(clientSource as never)
      .mockResolvedValueOnce("" as never);

    const result = await detectExistingClient("/fake/dir");
    expect(result).not.toBeNull();
    expect(result!.customSections).toHaveLength(1);
    expect(result!.customSections[0].marker).toBe("// @custom mySection");
  });
});

describe("applyMerge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes merged files and returns summary", async () => {
    const { access, writeFile } = await import("node:fs/promises");
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const mergeResult: MergeResult = {
      added: ["createUsers"],
      updated: ["getUsers"],
      deprecated: [],
      summary: "Added 1 new endpoint, updated 1 type",
      hasChanges: true,
    };

    const result = await applyMerge(
      "/fake/dir",
      mergeResult,
      "client code",
      "types code"
    );
    expect(result).toBe("Added 1 new endpoint, updated 1 type");
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it("adds deprecation markers to deprecated methods", async () => {
    const { access, writeFile } = await import("node:fs/promises");
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const clientCode = `class ApiClient {
  async oldMethod() {
    return {};
  }
}`;
    const mergeResult: MergeResult = {
      added: [],
      updated: [],
      deprecated: ["oldMethod"],
      summary: "1 endpoint deprecated",
      hasChanges: true,
    };

    await applyMerge("/fake/dir", mergeResult, clientCode, "types");
    const writtenClient = vi
      .mocked(writeFile)
      .mock.calls.find(c => (c[0] as string).includes("client.ts"));
    expect(writtenClient).toBeDefined();
    expect(writtenClient![1]).toContain("@deprecated");
  });

  it("does not double-add deprecation marker if already present", async () => {
    const { access, writeFile } = await import("node:fs/promises");
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const clientCode = `class ApiClient {
  /** @deprecated No longer observed in API traffic */
  async oldMethod() {
    return {};
  }
}`;
    const mergeResult: MergeResult = {
      added: [],
      updated: [],
      deprecated: ["oldMethod"],
      summary: "1 endpoint deprecated",
      hasChanges: true,
    };

    await applyMerge("/fake/dir", mergeResult, clientCode, "types");
    const writtenClient = vi
      .mocked(writeFile)
      .mock.calls.find(c => (c[0] as string).includes("client.ts"));
    expect(writtenClient).toBeDefined();
    // Should contain exactly one @deprecated, not two
    const matches = (writtenClient![1] as string).match(/@deprecated/g);
    expect(matches).toHaveLength(1);
  });

  it("handles deprecation for method not found in source", async () => {
    const { access, writeFile } = await import("node:fs/promises");
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const clientCode = `class ApiClient {
  async getUsers() {}
}`;
    const mergeResult: MergeResult = {
      added: [],
      updated: [],
      deprecated: ["nonExistentMethod"],
      summary: "1 endpoint deprecated",
      hasChanges: true,
    };

    await applyMerge("/fake/dir", mergeResult, clientCode, "types");
    const writtenClient = vi
      .mocked(writeFile)
      .mock.calls.find(c => (c[0] as string).includes("client.ts"));
    // Should write unchanged since method doesn't exist
    expect(writtenClient![1]).not.toContain("@deprecated");
  });

  it("restores custom sections from existing files", async () => {
    const { access, readFile, writeFile } = await import("node:fs/promises");
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(readFile)
      .mockResolvedValueOnce(
        `class ApiClient {
  // @custom helpers
  customHelper() { return 42; }
  // @end-custom
}` as never
      )
      .mockResolvedValueOnce("// types" as never);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const newClientCode = `class ApiClient {
  // @custom helpers
  // @end-custom
}`;
    const mergeResult: MergeResult = {
      added: [],
      updated: [],
      deprecated: [],
      summary: "No changes detected",
      hasChanges: false,
    };

    await applyMerge("/fake/dir", mergeResult, newClientCode, "types");
    const writtenClient = vi
      .mocked(writeFile)
      .mock.calls.find(c => (c[0] as string).includes("client.ts"));
    expect(writtenClient![1]).toContain("customHelper() { return 42; }");
  });

  it("inserts custom section at end if marker not found in new code", async () => {
    const { access, readFile, writeFile } = await import("node:fs/promises");
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(readFile)
      .mockResolvedValueOnce(
        `class ApiClient {
  // @custom extras
  myExtra() {}
  // @end-custom
}` as never
      )
      .mockResolvedValueOnce("// types" as never);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const newClientCode = `class ApiClient {
  async getUsers() {}
}`;
    const mergeResult: MergeResult = {
      added: [],
      updated: [],
      deprecated: [],
      summary: "No changes detected",
      hasChanges: false,
    };

    await applyMerge("/fake/dir", mergeResult, newClientCode, "types");
    const writtenClient = vi
      .mocked(writeFile)
      .mock.calls.find(c => (c[0] as string).includes("client.ts"));
    expect(writtenClient![1]).toContain("// @custom extras");
    expect(writtenClient![1]).toContain("myExtra() {}");
  });

  it("appends custom section when no closing brace exists", async () => {
    const { access, readFile, writeFile } = await import("node:fs/promises");
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(readFile)
      .mockResolvedValueOnce(
        `// @custom top-level
const custom = true;
// @end-custom` as never
      )
      .mockResolvedValueOnce("// types" as never);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    // New code with no braces at all
    const newClientCode = `const x = 1`;
    const mergeResult: MergeResult = {
      added: [],
      updated: [],
      deprecated: [],
      summary: "No changes detected",
      hasChanges: false,
    };

    await applyMerge("/fake/dir", mergeResult, newClientCode, "types");
    const writtenClient = vi
      .mocked(writeFile)
      .mock.calls.find(c => (c[0] as string).includes("client.ts"));
    expect(writtenClient![1]).toContain("// @custom top-level");
  });
});
