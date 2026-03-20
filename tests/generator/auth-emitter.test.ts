import { describe, it, expect } from "vitest";
import { emitAuthModule } from "../../src/generator/auth-emitter.js";
import type { AuthInfo } from "../../src/types/auth.js";

describe("emitAuthModule", () => {
  it("emits auth module with bearer auth type", () => {
    const authInfos: AuthInfo[] = [
      {
        type: "bearer",
        location: "header",
        key: "Authorization",
        value: "Bearer tok",
        confidence: 1.0,
      },
    ];
    const code = emitAuthModule(authInfos, "https://api.example.com", "my-cli");
    expect(code).toContain("export const AUTH_TYPE = 'bearer' as const;");
    expect(code).toContain(
      "export const ORIGINAL_URL = 'https://api.example.com';"
    );
    expect(code).toContain("export const CLI_NAME = 'my-cli';");
    expect(code).toContain("export interface AuthConfig {");
    expect(code).toContain("export function loadAuth(): AuthConfig | null {");
    expect(code).toContain(
      "export function saveAuth(config: AuthConfig): void {"
    );
    expect(code).toContain("export function isAuthConfigured(): boolean {");
    expect(code).toContain("export function clearAuth(): void {");
  });

  it("emits cookie auth type", () => {
    const authInfos: AuthInfo[] = [
      {
        type: "cookie",
        location: "cookie",
        key: "session",
        value: "sess123",
        confidence: 0.8,
      },
    ];
    const code = emitAuthModule(authInfos, "https://example.com", "test-cli");
    expect(code).toContain("export const AUTH_TYPE = 'cookie' as const;");
  });

  it("emits api-key auth type", () => {
    const authInfos: AuthInfo[] = [
      {
        type: "api-key",
        location: "header",
        key: "X-API-Key",
        value: "key123",
        confidence: 0.7,
      },
    ];
    const code = emitAuthModule(authInfos, "https://api.test.com", "api-cli");
    expect(code).toContain("export const AUTH_TYPE = 'api-key' as const;");
  });

  it("emits none auth type when no auth infos provided", () => {
    const code = emitAuthModule([], "https://api.example.com", "my-cli");
    expect(code).toContain("export const AUTH_TYPE = 'none' as const;");
    expect(code).toContain("/** Detected auth type: none */");
  });

  it("includes fs imports", () => {
    const code = emitAuthModule([], "https://api.example.com", "my-cli");
    expect(code).toContain(
      "import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';"
    );
    expect(code).toContain("import { join } from 'node:path';");
  });

  it("includes AUTH_FILE constant", () => {
    const code = emitAuthModule([], "https://api.example.com", "my-cli");
    expect(code).toContain(
      "export const AUTH_FILE = join(process.cwd(), '.auth');"
    );
  });

  it("uses first auth info when multiple are provided", () => {
    const authInfos: AuthInfo[] = [
      {
        type: "bearer",
        location: "header",
        key: "Authorization",
        value: "Bearer tok",
        confidence: 1.0,
      },
      {
        type: "cookie",
        location: "cookie",
        key: "session",
        value: "sess",
        confidence: 0.5,
      },
    ];
    const code = emitAuthModule(authInfos, "https://api.example.com", "my-cli");
    expect(code).toContain("export const AUTH_TYPE = 'bearer' as const;");
  });
});
