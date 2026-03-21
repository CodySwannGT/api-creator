import { describe, it, expect } from "vitest";
import { inferGroup } from "../../src/utils/group-inferrer.js";

describe("inferGroup", () => {
  describe("REST endpoints", () => {
    it("groups by first meaningful path segment", () => {
      expect(inferGroup("/api/v2/auth/options", false)).toBe("Auth");
    });

    it("groups client_configs to Client", () => {
      expect(inferGroup("/api/v2/client_configs", false)).toBe("Client");
    });

    it("groups tracking endpoints", () => {
      expect(inferGroup("/track/realtimeconversion", false)).toBe("Track");
    });

    it("groups nested resource paths by first segment", () => {
      expect(inferGroup("/users/:id/posts", false)).toBe("Users");
    });

    it("returns Other for root path", () => {
      expect(inferGroup("/", false)).toBe("Other");
    });

    it("returns Other when only noise segments remain", () => {
      expect(inferGroup("/api/v3", false)).toBe("Other");
    });
  });

  describe("GraphQL endpoints", () => {
    it("extracts group from HostReservationsTabQuery", () => {
      expect(
        inferGroup(
          "/api/v3/HostReservationsTabQuery",
          true,
          "HostReservationsTabQuery"
        )
      ).toBe("Reservations");
    });

    it("extracts group from GetListOfListings", () => {
      expect(
        inferGroup("/api/v3/getListOfListings", true, "getListOfListings")
      ).toBe("Listings");
    });

    it("extracts group from MYSArrivalQuery", () => {
      expect(
        inferGroup("/api/v3/MYSArrivalQuery", true, "MYSArrivalQuery")
      ).toBe("Arrival");
    });

    it("extracts group from ViaductInboxData", () => {
      expect(
        inferGroup("/api/v3/ViaductInboxData", true, "ViaductInboxData")
      ).toBe("Inbox");
    });

    it("extracts group from multicalBootstrap", () => {
      expect(
        inferGroup("/api/v3/multicalBootstrap", true, "multicalBootstrap")
      ).toBe("Multical");
    });

    it("extracts group from CohostManagementListQuery", () => {
      expect(
        inferGroup(
          "/api/v3/CohostManagementListQuery",
          true,
          "CohostManagementListQuery"
        )
      ).toBe("Cohost");
    });

    it("returns Other when operationName is undefined", () => {
      expect(inferGroup("/api/v3/graphql", true)).toBe("Other");
    });

    it("returns Other when all words are stripped", () => {
      expect(inferGroup("/api/v3/GetQuery", true, "GetQuery")).toBe("Other");
    });

    it("handles UserMetastoreWebQuery", () => {
      expect(
        inferGroup(
          "/api/v3/UserMetastoreWebQuery",
          true,
          "UserMetastoreWebQuery"
        )
      ).toBe("Metastore");
    });
  });
});
