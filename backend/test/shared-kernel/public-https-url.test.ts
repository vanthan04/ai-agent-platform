import { describe, expect, it } from "vitest";
import { isPublicHttpsUrl } from "../../src/shared-kernel";

describe("isPublicHttpsUrl", () => {
  it.each(["https://example.com", "https://api.example.com/v1", "https://a-b.example.co.uk/path/to"])("accepts %s", (value) => {
    expect(isPublicHttpsUrl(value)).toBe(true);
  });

  it.each([
    "http://example.com",
    "ftp://example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]/",
    "https://10.0.0.1/",
    "https://user:pass@example.com",
    "https://example.com/?a=1",
    "https://example.com/#x",
    "https://printer.local",
    "https://db.internal",
    "https://example.123",
    "not a url",
    "",
  ])("refuses %j", (value) => {
    expect(isPublicHttpsUrl(value)).toBe(false);
  });
});
