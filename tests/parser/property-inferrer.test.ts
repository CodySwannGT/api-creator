import { describe, it, expect } from "vitest";
import {
  inferPropertyDefinition,
  mergeObjectShapes,
  mergeScalarTypes,
  inferArrayProperty,
} from "../../src/parser/property-inferrer.js";

describe("mergeScalarTypes", () => {
  it("returns single type for uniform values", () => {
    expect(mergeScalarTypes(["a", "b", "c"])).toBe("string");
  });

  it("returns union for mixed types", () => {
    expect(mergeScalarTypes([1, "a"])).toBe("number | string");
  });

  it("includes null in the union", () => {
    expect(mergeScalarTypes([null, "a"])).toBe("null | string");
  });

  it("returns unknown for empty array", () => {
    expect(mergeScalarTypes([])).toBe("unknown");
  });

  it("handles booleans", () => {
    expect(mergeScalarTypes([true, false])).toBe("boolean");
  });

  it("sorts types alphabetically", () => {
    expect(mergeScalarTypes([1, "a", true])).toBe("boolean | number | string");
  });
});

describe("inferPropertyDefinition", () => {
  it("infers string type", () => {
    const result = inferPropertyDefinition(
      "name",
      ["Alice", "Bob"],
      false,
      "Parent"
    );
    expect(result.property.name).toBe("name");
    expect(result.property.type).toBe("string");
    expect(result.property.optional).toBe(false);
  });

  it("infers number type", () => {
    const result = inferPropertyDefinition("age", [25, 30], false, "Parent");
    expect(result.property.type).toBe("number");
  });

  it("infers boolean type", () => {
    const result = inferPropertyDefinition(
      "active",
      [true, false],
      false,
      "Parent"
    );
    expect(result.property.type).toBe("boolean");
  });

  it("handles null-only values", () => {
    const result = inferPropertyDefinition(
      "field",
      [null, null],
      false,
      "Parent"
    );
    expect(result.property.type).toBe("null");
    expect(result.property.optional).toBe(true);
  });

  it("handles mixed scalar and null values", () => {
    const result = inferPropertyDefinition(
      "field",
      ["a", null],
      false,
      "Parent"
    );
    expect(result.property.type).toBe("string | null");
    expect(result.property.optional).toBe(true);
  });

  it("infers nested object type", () => {
    const result = inferPropertyDefinition(
      "address",
      [{ street: "123 Main", city: "Springfield" }],
      false,
      "UserResponse"
    );
    expect(result.property.type).toBe("UserAddress");
    expect(result.property.nestedType).toBeDefined();
    expect(result.discoveredTypes).toHaveLength(1);
    expect(result.discoveredTypes[0].name).toBe("UserAddress");
  });

  it("handles object with null", () => {
    const result = inferPropertyDefinition(
      "meta",
      [{ key: "val" }, null],
      false,
      "ItemResponse"
    );
    expect(result.property.type).toBe("ItemMeta | null");
    expect(result.property.optional).toBe(true);
  });

  it("infers array of scalars", () => {
    const result = inferPropertyDefinition(
      "tags",
      [["a", "b"], ["c"]],
      false,
      "Parent"
    );
    expect(result.property.type).toBe("string");
    expect(result.property.isArray).toBe(true);
  });

  it("infers mixed types as union", () => {
    const result = inferPropertyDefinition(
      "data",
      [1, "str", { key: "val" }],
      false,
      "Parent"
    );
    expect(result.property.type).toContain("number");
    expect(result.property.type).toContain("string");
    expect(result.property.type).toContain("object");
  });
});

describe("mergeObjectShapes", () => {
  it("returns empty for no observations", () => {
    const result = mergeObjectShapes([], "Parent");
    expect(result.properties).toHaveLength(0);
    expect(result.discoveredTypes).toHaveLength(0);
  });

  it("merges properties from single observation", () => {
    const result = mergeObjectShapes(
      [{ id: 1, name: "Alice" }],
      "UserResponse"
    );
    expect(result.properties).toHaveLength(2);
    const idProp = result.properties.find(p => p.name === "id");
    expect(idProp).toBeDefined();
    expect(idProp!.type).toBe("number");
    expect(idProp!.optional).toBe(false);
  });

  it("marks missing keys as optional", () => {
    const result = mergeObjectShapes(
      [
        { id: 1, name: "Alice", email: "alice@test.com" },
        { id: 2, name: "Bob" },
      ],
      "UserResponse"
    );
    const emailProp = result.properties.find(p => p.name === "email");
    expect(emailProp).toBeDefined();
    expect(emailProp!.optional).toBe(true);
    const nameProp = result.properties.find(p => p.name === "name");
    expect(nameProp!.optional).toBe(false);
  });

  it("sorts properties alphabetically", () => {
    const result = mergeObjectShapes(
      [{ zebra: 1, alpha: 2, middle: 3 }],
      "Parent"
    );
    expect(result.properties[0].name).toBe("alpha");
    expect(result.properties[1].name).toBe("middle");
    expect(result.properties[2].name).toBe("zebra");
  });

  it("discovers nested object types", () => {
    const result = mergeObjectShapes(
      [{ profile: { bio: "hello" } }],
      "UserResponse"
    );
    expect(result.discoveredTypes.length).toBeGreaterThan(0);
    expect(result.discoveredTypes[0].name).toBe("UserProfile");
  });
});

describe("inferArrayProperty", () => {
  it("returns unknown[] for empty arrays", () => {
    const result = inferArrayProperty("items", [[]], false, false, "Parent");
    expect(result.property.type).toBe("unknown");
    expect(result.property.isArray).toBe(true);
  });

  it("infers scalar element types", () => {
    const result = inferArrayProperty(
      "ids",
      [[1, 2, 3]],
      false,
      false,
      "Parent"
    );
    expect(result.property.type).toBe("number");
    expect(result.property.isArray).toBe(true);
  });

  it("infers array of objects with nested type", () => {
    const result = inferArrayProperty(
      "items",
      [
        [
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ],
      ],
      false,
      false,
      "ListResponse"
    );
    expect(result.property.isArray).toBe(true);
    expect(result.property.nestedType).toBeDefined();
    expect(result.property.nestedType!.name).toBe("ListItemsItem");
    expect(result.discoveredTypes.length).toBeGreaterThan(0);
  });

  it("handles null elements in arrays", () => {
    const result = inferArrayProperty(
      "tags",
      [["a", null]],
      false,
      false,
      "Parent"
    );
    expect(result.property.type).toContain("null");
    expect(result.property.type).toContain("string");
  });

  it("marks as optional when hasNull is true", () => {
    const result = inferArrayProperty("items", [[1]], false, true, "Parent");
    expect(result.property.optional).toBe(true);
  });

  it("returns unknown[] for mixed object and scalar elements", () => {
    const result = inferArrayProperty(
      "data",
      [[1, { a: 1 }]],
      false,
      false,
      "Parent"
    );
    expect(result.property.type).toBe("unknown");
    expect(result.property.isArray).toBe(true);
  });
});
