import { describe, it, expect } from "vitest";
import { inferTypes } from "../../src/parser/type-inferrer.js";
import type { Endpoint } from "../../src/types/endpoint.js";

function makeEndpoint(
  method: string,
  path: string,
  responseBodies: unknown[]
): Endpoint {
  return {
    method,
    normalizedPath: path,
    originalUrls: [],
    queryParams: [],
    requestBodies: [],
    responseBodies,
    responseStatuses: [200],
    headers: {},
  };
}

describe("inferTypes", () => {
  it("infers basic object type from response body", () => {
    const endpoints = [
      makeEndpoint("GET", "/users/:id", [
        { id: 1, name: "Alice", email: "alice@example.com" },
      ]),
    ];
    const types = inferTypes(endpoints);
    expect(types.length).toBeGreaterThanOrEqual(1);
    const userType = types.find(t => t.name === "GetUsersByIdResponse");
    expect(userType).toBeDefined();
    expect(userType!.isArray).toBe(false);
    expect(userType!.properties.find(p => p.name === "id")).toBeDefined();
    expect(userType!.properties.find(p => p.name === "name")).toBeDefined();
    expect(userType!.properties.find(p => p.name === "email")).toBeDefined();
  });

  it("handles array response", () => {
    const endpoints = [
      makeEndpoint("GET", "/users", [
        [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      ]),
    ];
    const types = inferTypes(endpoints);
    const usersType = types.find(t => t.name === "GetUsersResponse");
    expect(usersType).toBeDefined();
    expect(usersType!.isArray).toBe(true);
    expect(usersType!.properties.length).toBeGreaterThan(0);
  });

  it("detects optional fields present in some but not all observations", () => {
    const endpoints = [
      makeEndpoint("GET", "/items/:id", [
        { id: 1, name: "Item A", description: "Desc A" },
        { id: 2, name: "Item B" },
      ]),
    ];
    const types = inferTypes(endpoints);
    const itemType = types.find(t => t.name === "GetItemsByIdResponse");
    expect(itemType).toBeDefined();
    const descProp = itemType!.properties.find(p => p.name === "description");
    expect(descProp).toBeDefined();
    expect(descProp!.optional).toBe(true);
    const nameProp = itemType!.properties.find(p => p.name === "name");
    expect(nameProp).toBeDefined();
    expect(nameProp!.optional).toBe(false);
  });

  it("creates nested object types", () => {
    const endpoints = [
      makeEndpoint("GET", "/users/:id", [
        { id: 1, address: { street: "123 Main St", city: "Springfield" } },
      ]),
    ];
    const types = inferTypes(endpoints);
    // Should have the main type and a nested address type
    const mainType = types.find(t => t.name === "GetUsersByIdResponse");
    expect(mainType).toBeDefined();
    const addressProp = mainType!.properties.find(p => p.name === "address");
    expect(addressProp).toBeDefined();
    expect(addressProp!.nestedType).toBeDefined();
    // The nested type should also be in the collector
    const nestedType = types.find(
      t => t.name === addressProp!.nestedType!.name
    );
    expect(nestedType).toBeDefined();
    expect(nestedType!.properties.find(p => p.name === "street")).toBeDefined();
    expect(nestedType!.properties.find(p => p.name === "city")).toBeDefined();
  });

  it("handles null values", () => {
    const endpoints = [
      makeEndpoint("GET", "/items/:id", [
        { id: 1, name: "Item", note: null },
        { id: 2, name: "Item2", note: null },
      ]),
    ];
    const types = inferTypes(endpoints);
    const itemType = types.find(t => t.name === "GetItemsByIdResponse");
    expect(itemType).toBeDefined();
    const noteProp = itemType!.properties.find(p => p.name === "note");
    expect(noteProp).toBeDefined();
    expect(noteProp!.type).toBe("null");
    expect(noteProp!.optional).toBe(true);
  });
});
