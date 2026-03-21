import { describe, it, expect } from "vitest";
import {
  pathToMethodName,
  pathToTypeName,
  singularize,
  camelToKebab,
  kebabToCamel,
  methodNameToCliCommand,
} from "../../src/utils/naming.js";

describe("pathToMethodName", () => {
  it("generates GET collection method name", () => {
    expect(pathToMethodName("GET", "/users")).toBe("getUsers");
  });

  it("generates GET by ID method name", () => {
    expect(pathToMethodName("GET", "/users/:id")).toBe("getUsersById");
  });

  it("generates POST method name", () => {
    expect(pathToMethodName("POST", "/users")).toBe("createUsers");
  });

  it("generates PUT method name", () => {
    expect(pathToMethodName("PUT", "/users/:id")).toBe("updateUsersById");
  });

  it("generates DELETE method name", () => {
    expect(pathToMethodName("DELETE", "/users/:id")).toBe("deleteUsersById");
  });

  it("generates PATCH method name", () => {
    expect(pathToMethodName("PATCH", "/users/:id")).toBe("updateUsersById");
  });

  it("handles nested resources", () => {
    expect(pathToMethodName("GET", "/users/:id/posts")).toBe(
      "getUsersPostsById"
    );
  });

  it("handles paths with hyphens", () => {
    expect(pathToMethodName("GET", "/user-profiles")).toBe("getUserProfiles");
  });
});

describe("pathToTypeName", () => {
  it("generates response type name for GET collection", () => {
    expect(pathToTypeName("GET", "/users")).toBe("GetUsersResponse");
  });

  it("generates response type name for GET by ID", () => {
    expect(pathToTypeName("GET", "/users/:id")).toBe("GetUsersByIdResponse");
  });

  it("generates response type name for POST", () => {
    expect(pathToTypeName("POST", "/users")).toBe("CreateUsersResponse");
  });
});

describe("singularize", () => {
  it("converts 'cities' to 'city'", () => {
    expect(singularize("cities")).toBe("city");
  });

  it("converts 'buses' to 'bus'", () => {
    expect(singularize("buses")).toBe("bus");
  });

  it("converts 'dogs' to 'dog'", () => {
    expect(singularize("dogs")).toBe("dog");
  });

  it("keeps 'boss' as 'boss'", () => {
    expect(singularize("boss")).toBe("boss");
  });

  it("converts 'addresses' to 'addresse'", () => {
    expect(singularize("addresses")).toBe("address");
  });

  it("keeps words without trailing s unchanged", () => {
    expect(singularize("user")).toBe("user");
  });

  it("converts 'categories' to 'category'", () => {
    expect(singularize("categories")).toBe("category");
  });
});

describe("camelToKebab", () => {
  it("converts 'listingId' to 'listing-id'", () => {
    expect(camelToKebab("listingId")).toBe("listing-id");
  });

  it("converts 'fooBar' to 'foo-bar'", () => {
    expect(camelToKebab("fooBar")).toBe("foo-bar");
  });

  it("converts 'getUserById' to 'get-user-by-id'", () => {
    expect(camelToKebab("getUserById")).toBe("get-user-by-id");
  });

  it("keeps lowercase string unchanged", () => {
    expect(camelToKebab("simple")).toBe("simple");
  });
});

describe("kebabToCamel", () => {
  it("converts 'listing-id' to 'listingId'", () => {
    expect(kebabToCamel("listing-id")).toBe("listingId");
  });

  it("converts 'foo-bar-baz' to 'fooBarBaz'", () => {
    expect(kebabToCamel("foo-bar-baz")).toBe("fooBarBaz");
  });

  it("keeps string without hyphens unchanged", () => {
    expect(kebabToCamel("simple")).toBe("simple");
  });
});

describe("methodNameToCliCommand", () => {
  it("strips 'get' prefix for GET methods", () => {
    expect(methodNameToCliCommand("getUsers", "GET")).toBe("users");
  });

  it("uses 'create-' prefix for POST methods", () => {
    expect(methodNameToCliCommand("createUser", "POST")).toBe("create-user");
  });

  it("uses 'update-' prefix for PUT methods", () => {
    expect(methodNameToCliCommand("updateUser", "PUT")).toBe("update-user");
  });

  it("uses 'delete-' prefix for DELETE methods", () => {
    expect(methodNameToCliCommand("deleteUser", "DELETE")).toBe("delete-user");
  });

  it("strips api/version prefixes", () => {
    expect(methodNameToCliCommand("getApiV2Users", "GET")).toBe("users");
  });

  it("removes by-id suffix", () => {
    expect(methodNameToCliCommand("getUserById", "GET")).toBe("user");
  });

  it("dasherizes camelCase GraphQL operation names", () => {
    const methodName = pathToMethodName("GET", "/api/v3/getListOfListings");
    expect(methodNameToCliCommand(methodName, "GET")).toBe(
      "get-list-of-listings"
    );
  });
});
