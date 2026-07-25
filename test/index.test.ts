import { describe, expect, it } from "vitest";
import { placeholder } from "../src/index.js";

describe("placeholder", () => {
  it("returns the project name", () => {
    expect(placeholder()).toBe("document-data-extractor");
  });
});
