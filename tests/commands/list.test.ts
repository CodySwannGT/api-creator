import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/runtime/project-manager.js", () => ({
  listProjects: vi.fn(),
  loadManifest: vi.fn(),
  loadAuth: vi.fn(),
}));

import {
  listProjects,
  loadManifest,
  loadAuth,
} from "../../src/runtime/project-manager.js";
import type { ProjectManifest } from "../../src/runtime/project-manager.js";

const mockListProjects = listProjects as ReturnType<typeof vi.fn>;
const mockLoadManifest = loadManifest as ReturnType<typeof vi.fn>;
const mockLoadAuth = loadAuth as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("listCommand", () => {
  it("prints message when no projects exist", async () => {
    mockListProjects.mockReturnValue([]);

    const { listCommand } = await import("../../src/commands/list.js");
    await listCommand.parseAsync([], { from: "user" });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No projects found")
    );
  });

  it("lists projects with details", async () => {
    const manifest: ProjectManifest = {
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
      ],
    };

    mockListProjects.mockReturnValue(["myapi"]);
    mockLoadManifest.mockReturnValue(manifest);
    mockLoadAuth.mockReturnValue({ cookie: "c=1" });

    const { listCommand } = await import("../../src/commands/list.js");
    await listCommand.parseAsync([], { from: "user" });

    expect(mockLoadManifest).toHaveBeenCalledWith("myapi");
    expect(mockLoadAuth).toHaveBeenCalledWith("myapi");
  });

  it("handles projects with invalid manifest", async () => {
    mockListProjects.mockReturnValue(["broken"]);
    mockLoadManifest.mockReturnValue(null);
    mockLoadAuth.mockReturnValue(null);

    const { listCommand } = await import("../../src/commands/list.js");
    await listCommand.parseAsync([], { from: "user" });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("invalid manifest")
    );
  });

  it("shows auth status for projects without auth", async () => {
    const manifest: ProjectManifest = {
      name: "noauth",
      baseUrl: "https://api.example.com",
      originalUrl: "https://example.com",
      createdAt: "2026-01-01",
      authType: "none",
      endpoints: [],
    };

    mockListProjects.mockReturnValue(["noauth"]);
    mockLoadManifest.mockReturnValue(manifest);
    mockLoadAuth.mockReturnValue(null);

    const { listCommand } = await import("../../src/commands/list.js");
    await listCommand.parseAsync([], { from: "user" });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("no auth")
    );
  });
});
