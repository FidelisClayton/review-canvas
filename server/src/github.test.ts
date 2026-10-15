import { describe, expect, it } from "vitest";
import { encodePath } from "./github.js";

describe("encodePath", () => {
  it("keeps the slashes and encodes what could change the query", () => {
    expect(encodePath("app/a b/c?ref=x#d&e.rb")).toBe("app/a%20b/c%3Fref%3Dx%23d%26e.rb");
  });
});
