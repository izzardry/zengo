import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("provides working localStorage and sessionStorage", () => {
    for (const s of [localStorage, window.localStorage, sessionStorage]) {
      expect(s).toBeDefined();
      s.setItem("zengo:probe", "1");
      expect(s.getItem("zengo:probe")).toBe("1");
      s.removeItem("zengo:probe");
      expect(s.getItem("zengo:probe")).toBeNull();
    }
  });
});
