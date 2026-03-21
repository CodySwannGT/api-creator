import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/parser/har-reader.js", () => ({
  readHarFile: vi.fn(),
  filterApiRequests: vi.fn(),
}));

vi.mock("../../src/parser/endpoint-grouper.js", () => ({
  groupEndpoints: vi.fn(),
}));

vi.mock("../../src/parser/auth-detector.js", () => ({
  detectAuth: vi.fn(),
}));

vi.mock("../../src/parser/type-inferrer.js", () => ({
  inferTypes: vi.fn(),
  inferRequestTypes: vi.fn(),
}));

vi.mock("../../src/generator/client-emitter.js", () => ({
  emitClient: vi.fn(),
}));

vi.mock("../../src/generator/types-emitter.js", () => ({
  emitTypes: vi.fn(),
}));

vi.mock("../../src/generator/log-summary.js", () => ({
  logSummary: vi.fn(),
}));

vi.mock("../../src/runtime/project-manager.js", () => ({
  saveManifest: vi.fn(),
  getProjectDir: vi.fn(),
  loadManifest: vi.fn().mockReturnValue(null),
  mergeManifests: vi.fn(),
}));

vi.mock("chalk", () => ({
  default: {
    yellow: (s: string) => s,
    gray: (s: string) => s,
    green: { bold: (s: string) => s },
    white: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

import { generateClient } from "../../src/generator/codegen.js";

describe("generateClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles no API requests found", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    vi.mocked(readHarFile).mockResolvedValue([]);
    vi.mocked(filterApiRequests).mockReturnValue([]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({ inputPath: "test.har" });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No API requests found")
    );
    consoleSpy.mockRestore();
  });

  it("generates client files from HAR entries", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    const { groupEndpoints } =
      await import("../../src/parser/endpoint-grouper.js");
    const { detectAuth } = await import("../../src/parser/auth-detector.js");
    const { inferTypes, inferRequestTypes } =
      await import("../../src/parser/type-inferrer.js");
    const { emitClient } =
      await import("../../src/generator/client-emitter.js");
    const { emitTypes } = await import("../../src/generator/types-emitter.js");
    const { saveManifest, getProjectDir } =
      await import("../../src/runtime/project-manager.js");
    const { writeFile } = await import("node:fs/promises");

    const mockEntries = [{ id: "entry1" }];
    vi.mocked(readHarFile).mockResolvedValue(mockEntries as never);
    vi.mocked(filterApiRequests).mockReturnValue(mockEntries as never);
    vi.mocked(detectAuth).mockReturnValue([]);
    vi.mocked(groupEndpoints).mockReturnValue({
      baseUrl: "https://api.example.com",
      endpoints: [
        {
          method: "GET",
          normalizedPath: "/users",
          originalUrls: ["https://api.example.com/users"],
          queryParams: [],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
      ],
    });
    vi.mocked(inferTypes).mockReturnValue([
      { name: "GetUsersResponse", isArray: false, properties: [] },
    ]);
    vi.mocked(inferRequestTypes).mockReturnValue([]);
    vi.mocked(emitClient).mockReturnValue("// client code");
    vi.mocked(emitTypes).mockReturnValue("// types code");
    vi.mocked(getProjectDir).mockReturnValue("/tmp/test-project");
    vi.mocked(saveManifest).mockReturnValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({
      inputPath: "test.har",
      name: "test-api",
      baseUrl: "https://api.example.com",
    });

    expect(saveManifest).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it("uses detected baseUrl when none provided", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    const { groupEndpoints } =
      await import("../../src/parser/endpoint-grouper.js");
    const { detectAuth } = await import("../../src/parser/auth-detector.js");
    const { inferTypes, inferRequestTypes } =
      await import("../../src/parser/type-inferrer.js");
    const { emitClient } =
      await import("../../src/generator/client-emitter.js");
    const { emitTypes } = await import("../../src/generator/types-emitter.js");
    const { saveManifest, getProjectDir } =
      await import("../../src/runtime/project-manager.js");

    vi.mocked(readHarFile).mockResolvedValue([{}] as never);
    vi.mocked(filterApiRequests).mockReturnValue([{}] as never);
    vi.mocked(detectAuth).mockReturnValue([]);
    vi.mocked(groupEndpoints).mockReturnValue({
      baseUrl: "https://detected.api.com",
      endpoints: [
        {
          method: "GET",
          normalizedPath: "/items",
          originalUrls: ["https://detected.api.com/items"],
          queryParams: [],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
      ],
    });
    vi.mocked(inferTypes).mockReturnValue([]);
    vi.mocked(inferRequestTypes).mockReturnValue([]);
    vi.mocked(emitClient).mockReturnValue("// client");
    vi.mocked(emitTypes).mockReturnValue("// types");
    vi.mocked(getProjectDir).mockReturnValue("/tmp/p");
    vi.mocked(saveManifest).mockReturnValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({ inputPath: "test.har" });

    expect(saveManifest).toHaveBeenCalledWith(
      "api-client",
      expect.objectContaining({ baseUrl: "https://detected.api.com" })
    );
    consoleSpy.mockRestore();
  });

  it("detects auth and logs auth info", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    const { groupEndpoints } =
      await import("../../src/parser/endpoint-grouper.js");
    const { detectAuth } = await import("../../src/parser/auth-detector.js");
    const { inferTypes, inferRequestTypes } =
      await import("../../src/parser/type-inferrer.js");
    const { emitClient } =
      await import("../../src/generator/client-emitter.js");
    const { emitTypes } = await import("../../src/generator/types-emitter.js");
    const { saveManifest, getProjectDir } =
      await import("../../src/runtime/project-manager.js");

    vi.mocked(readHarFile).mockResolvedValue([{}] as never);
    vi.mocked(filterApiRequests).mockReturnValue([{}] as never);
    vi.mocked(detectAuth).mockReturnValue([
      { type: "cookie", key: "session", value: "abc" },
    ]);
    vi.mocked(groupEndpoints).mockReturnValue({
      baseUrl: "https://api.example.com",
      endpoints: [
        {
          method: "GET",
          normalizedPath: "/users",
          originalUrls: [],
          queryParams: [],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
      ],
    });
    vi.mocked(inferTypes).mockReturnValue([]);
    vi.mocked(inferRequestTypes).mockReturnValue([]);
    vi.mocked(emitClient).mockReturnValue("// client");
    vi.mocked(emitTypes).mockReturnValue("// types");
    vi.mocked(getProjectDir).mockReturnValue("/tmp/p");
    vi.mocked(saveManifest).mockReturnValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({ inputPath: "test.har", name: "myapi" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Detected auth: cookie")
    );
    expect(saveManifest).toHaveBeenCalledWith(
      "myapi",
      expect.objectContaining({ authType: "cookie" })
    );
    consoleSpy.mockRestore();
  });

  it("builds manifest with GraphQL endpoints", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    const { groupEndpoints } =
      await import("../../src/parser/endpoint-grouper.js");
    const { detectAuth } = await import("../../src/parser/auth-detector.js");
    const { inferTypes, inferRequestTypes } =
      await import("../../src/parser/type-inferrer.js");
    const { emitClient } =
      await import("../../src/generator/client-emitter.js");
    const { emitTypes } = await import("../../src/generator/types-emitter.js");
    const { saveManifest, getProjectDir } =
      await import("../../src/runtime/project-manager.js");

    vi.mocked(readHarFile).mockResolvedValue([{}] as never);
    vi.mocked(filterApiRequests).mockReturnValue([{}] as never);
    vi.mocked(detectAuth).mockReturnValue([]);
    vi.mocked(groupEndpoints).mockReturnValue({
      baseUrl: "https://api.example.com",
      endpoints: [
        {
          method: "GET",
          normalizedPath: "/graphql",
          originalUrls: [],
          queryParams: [
            {
              name: "operationName",
              observedValues: ["GetUser"],
              required: true,
            },
            {
              name: "extensions",
              observedValues: ['{"hash":"abc"}'],
              required: true,
            },
            {
              name: "variables",
              observedValues: ['{"userId":"42"}'],
              required: false,
            },
            { name: "locale", observedValues: ["en"], required: false },
          ],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
      ],
    });
    vi.mocked(inferTypes).mockReturnValue([]);
    vi.mocked(inferRequestTypes).mockReturnValue([]);
    vi.mocked(emitClient).mockReturnValue("// client");
    vi.mocked(emitTypes).mockReturnValue("// types");
    vi.mocked(getProjectDir).mockReturnValue("/tmp/p");
    vi.mocked(saveManifest).mockReturnValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({ inputPath: "test.har", name: "gql" });

    expect(saveManifest).toHaveBeenCalledWith(
      "gql",
      expect.objectContaining({
        endpoints: expect.arrayContaining([
          expect.objectContaining({
            isGraphQL: true,
            operationName: "GetUser",
            variables: expect.arrayContaining([
              expect.objectContaining({ camelName: "userId" }),
            ]),
          }),
        ]),
      })
    );
    consoleSpy.mockRestore();
  });

  it("builds manifest with path params from :id segments", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    const { groupEndpoints } =
      await import("../../src/parser/endpoint-grouper.js");
    const { detectAuth } = await import("../../src/parser/auth-detector.js");
    const { inferTypes, inferRequestTypes } =
      await import("../../src/parser/type-inferrer.js");
    const { emitClient } =
      await import("../../src/generator/client-emitter.js");
    const { emitTypes } = await import("../../src/generator/types-emitter.js");
    const { saveManifest, getProjectDir } =
      await import("../../src/runtime/project-manager.js");

    vi.mocked(readHarFile).mockResolvedValue([{}] as never);
    vi.mocked(filterApiRequests).mockReturnValue([{}] as never);
    vi.mocked(detectAuth).mockReturnValue([]);
    vi.mocked(groupEndpoints).mockReturnValue({
      baseUrl: "https://api.example.com",
      endpoints: [
        {
          method: "GET",
          normalizedPath: "/users/:id",
          originalUrls: [],
          queryParams: [],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
        {
          method: "PUT",
          normalizedPath: "/users/:id",
          originalUrls: [],
          queryParams: [],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
      ],
    });
    vi.mocked(inferTypes).mockReturnValue([]);
    vi.mocked(inferRequestTypes).mockReturnValue([]);
    vi.mocked(emitClient).mockReturnValue("// client");
    vi.mocked(emitTypes).mockReturnValue("// types");
    vi.mocked(getProjectDir).mockReturnValue("/tmp/p");
    vi.mocked(saveManifest).mockReturnValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({ inputPath: "test.har", name: "myapi" });

    expect(saveManifest).toHaveBeenCalledWith(
      "myapi",
      expect.objectContaining({
        endpoints: expect.arrayContaining([
          expect.objectContaining({
            pathParams: ["userId"],
            hasBody: false,
          }),
          expect.objectContaining({
            hasBody: true,
          }),
        ]),
      })
    );
    consoleSpy.mockRestore();
  });

  it("handles GraphQL with empty variables", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    const { groupEndpoints } =
      await import("../../src/parser/endpoint-grouper.js");
    const { detectAuth } = await import("../../src/parser/auth-detector.js");
    const { inferTypes, inferRequestTypes } =
      await import("../../src/parser/type-inferrer.js");
    const { emitClient } =
      await import("../../src/generator/client-emitter.js");
    const { emitTypes } = await import("../../src/generator/types-emitter.js");
    const { saveManifest, getProjectDir } =
      await import("../../src/runtime/project-manager.js");

    vi.mocked(readHarFile).mockResolvedValue([{}] as never);
    vi.mocked(filterApiRequests).mockReturnValue([{}] as never);
    vi.mocked(detectAuth).mockReturnValue([]);
    vi.mocked(groupEndpoints).mockReturnValue({
      baseUrl: "https://api.example.com",
      endpoints: [
        {
          method: "GET",
          normalizedPath: "/graphql",
          originalUrls: [],
          queryParams: [
            {
              name: "operationName",
              observedValues: ["Query"],
              required: true,
            },
            { name: "extensions", observedValues: ["{}"], required: true },
            { name: "variables", observedValues: [], required: false },
          ],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
      ],
    });
    vi.mocked(inferTypes).mockReturnValue([]);
    vi.mocked(inferRequestTypes).mockReturnValue([]);
    vi.mocked(emitClient).mockReturnValue("// client");
    vi.mocked(emitTypes).mockReturnValue("// types");
    vi.mocked(getProjectDir).mockReturnValue("/tmp/p");
    vi.mocked(saveManifest).mockReturnValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({ inputPath: "test.har", name: "gql2" });

    expect(saveManifest).toHaveBeenCalledWith(
      "gql2",
      expect.objectContaining({
        endpoints: expect.arrayContaining([
          expect.objectContaining({
            isGraphQL: true,
            variables: [],
          }),
        ]),
      })
    );
    consoleSpy.mockRestore();
  });

  it("handles GraphQL with invalid variables JSON", async () => {
    const { readHarFile, filterApiRequests } =
      await import("../../src/parser/har-reader.js");
    const { groupEndpoints } =
      await import("../../src/parser/endpoint-grouper.js");
    const { detectAuth } = await import("../../src/parser/auth-detector.js");
    const { inferTypes, inferRequestTypes } =
      await import("../../src/parser/type-inferrer.js");
    const { emitClient } =
      await import("../../src/generator/client-emitter.js");
    const { emitTypes } = await import("../../src/generator/types-emitter.js");
    const { saveManifest, getProjectDir } =
      await import("../../src/runtime/project-manager.js");

    vi.mocked(readHarFile).mockResolvedValue([{}] as never);
    vi.mocked(filterApiRequests).mockReturnValue([{}] as never);
    vi.mocked(detectAuth).mockReturnValue([]);
    vi.mocked(groupEndpoints).mockReturnValue({
      baseUrl: "https://api.example.com",
      endpoints: [
        {
          method: "GET",
          normalizedPath: "/graphql",
          originalUrls: [],
          queryParams: [
            { name: "operationName", observedValues: ["Q"], required: true },
            { name: "extensions", observedValues: ["{}"], required: true },
            {
              name: "variables",
              observedValues: ["not-json"],
              required: false,
            },
          ],
          requestBodies: [],
          responseBodies: [],
          responseStatuses: [200],
          headers: {},
        },
      ],
    });
    vi.mocked(inferTypes).mockReturnValue([]);
    vi.mocked(inferRequestTypes).mockReturnValue([]);
    vi.mocked(emitClient).mockReturnValue("// client");
    vi.mocked(emitTypes).mockReturnValue("// types");
    vi.mocked(getProjectDir).mockReturnValue("/tmp/p");
    vi.mocked(saveManifest).mockReturnValue(undefined);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await generateClient({ inputPath: "test.har", name: "gql3" });

    expect(saveManifest).toHaveBeenCalledWith(
      "gql3",
      expect.objectContaining({
        endpoints: expect.arrayContaining([
          expect.objectContaining({
            isGraphQL: true,
            variables: [],
          }),
        ]),
      })
    );
    consoleSpy.mockRestore();
  });
});
