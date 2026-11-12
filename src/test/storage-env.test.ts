import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("provides working localStorage and sessionStorage", () => {
    for (const s of [localStorage, window.localStorage, sessionStorage]) {
      expect(s).toBeDefined();
      s.setItem("zigo:probe", "1");
      expect(s.getItem("zigo:probe")).toBe("1");
      s.removeItem("zigo:probe");
      expect(s.getItem("zigo:probe")).toBeNull();
    }
  });
});
