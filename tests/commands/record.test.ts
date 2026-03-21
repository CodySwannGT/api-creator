import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/recorder/browser-session.js", () => ({
  startBrowserSession: vi.fn(),
}));

import { startBrowserSession } from "../../src/recorder/browser-session.js";

const mockStartBrowserSession = startBrowserSession as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("recordCommand", () => {
  it("can be imported with correct name and options", async () => {
    const { recordCommand } = await import("../../src/commands/record.js");
    expect(recordCommand.name()).toBe("record");
    const optNames = recordCommand.options.map((o: { long: string }) => o.long);
    expect(optNames).toContain("--url");
    expect(optNames).toContain("--output");
    expect(optNames).toContain("--include-assets");
  });

  it("calls startBrowserSession with options and logs result", async () => {
    mockStartBrowserSession.mockResolvedValue("/tmp/recording.har");

    const { recordCommand } = await import("../../src/commands/record.js");

    await recordCommand.parseAsync(["--url", "https://example.com"], {
      from: "user",
    });

    expect(mockStartBrowserSession).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        output: expect.stringContaining(".api-creator/recordings"),
        includeAssets: false,
      })
    );

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/recording.har")
    );
  });
});
