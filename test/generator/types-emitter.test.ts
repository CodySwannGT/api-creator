import { describe, it, expect } from "vitest";
import { emitTypes } from "../../src/generator/types-emitter.js";
import type { TypeDefinition } from "../../src/parser/type-inferrer.js";

describe("emitTypes", () => {
  it("generates an interface from a type definition", () => {
    const types: TypeDefinition[] = [
      {
        name: "GetUsersResponse",
        isArray: false,
        properties: [
          { name: "id", type: "number", optional: false, isArray: false },
          { name: "name", type: "string", optional: false, isArray: false },
        ],
      },
    ];
    const output = emitTypes(types, []);
    expect(output).toContain("export interface GetUsersResponse {");
    expect(output).toContain("  id: number;");
    expect(output).toContain("  name: string;");
    expect(output).toContain("}");
  });

  it("marks optional properties with ?", () => {
    const types: TypeDefinition[] = [
      {
        name: "GetItemResponse",
        isArray: false,
        properties: [
          { name: "id", type: "number", optional: false, isArray: false },
          {
            name: "description",
            type: "string",
            optional: true,
            isArray: false,
          },
        ],
      },
    ];
    const output = emitTypes(types, []);
    expect(output).toContain("  id: number;");
    expect(output).toContain("  description?: string;");
  });

  it("generates array type properties", () => {
    const types: TypeDefinition[] = [
      {
        name: "GetPostResponse",
        isArray: false,
        properties: [
          { name: "id", type: "number", optional: false, isArray: false },
          { name: "tags", type: "string", optional: false, isArray: true },
        ],
      },
    ];
    const output = emitTypes(types, []);
    expect(output).toContain("  tags: string[];");
  });

  it("handles union array types with parentheses", () => {
    const types: TypeDefinition[] = [
      {
        name: "GetMixedResponse",
        isArray: false,
        properties: [
          {
            name: "values",
            type: "number | string",
            optional: false,
            isArray: true,
          },
        ],
      },
    ];
    const output = emitTypes(types, []);
    expect(output).toContain("  values: (number | string)[];");
  });

  it("emits array type alias when no properties", () => {
    const types: TypeDefinition[] = [
      {
        name: "GetIdsResponse",
        isArray: true,
        properties: [],
      },
    ];
    const output = emitTypes(types, []);
    expect(output).toContain("export type GetIdsResponse = unknown[];");
  });

  it("includes request types", () => {
    const types: TypeDefinition[] = [];
    const requestTypes: TypeDefinition[] = [
      {
        name: "CreateUserRequest",
        isArray: false,
        properties: [
          { name: "name", type: "string", optional: false, isArray: false },
        ],
      },
    ];
    const output = emitTypes(types, requestTypes);
    expect(output).toContain("export interface CreateUserRequest {");
    expect(output).toContain("  name: string;");
  });
});
