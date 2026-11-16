import { describe, expect, it } from "vitest";
import { ATTRIBUTION_PARAM, ATTRIBUTION_VALUE, attributedUrl, sourceHost } from "./sourceLink.js";

describe("attributedUrl", () => {
  it("adds utm_source=opencohost to a plain https URL", () => {
    expect(attributedUrl("https://example.com/a")).toBe("https://example.com/a?utm_source=opencohost");
    expect(`${ATTRIBUTION_PARAM}=${ATTRIBUTION_VALUE}`).toBe("utm_source=opencohost");
  });

  it("keeps every existing query parameter, in order, byte for byte", () => {
    expect(attributedUrl("https://example.com/a?id=1&q=hello%20world&x=a+b")).toBe(
      "https://example.com/a?id=1&q=hello%20world&x=a+b&utm_source=opencohost"
    );
  });

  it("keeps the fragment", () => {
    expect(attributedUrl("https://example.com/a?id=1#section-2")).toBe(
      "https://example.com/a?id=1&utm_source=opencohost#section-2"
    );
    expect(attributedUrl("https://example.com/#top")).toBe("https://example.com/?utm_source=opencohost#top");
  });

  it("replaces an existing utm_source instead of adding a second one", () => {
    expect(attributedUrl("https://example.com/a?utm_source=newsletter&id=1")).toBe(
      "https://example.com/a?id=1&utm_source=opencohost"
    );
    expect(attributedUrl("https://example.com/a?id=1&utm_source=a&utm_source=b#f")).toBe(
      "https://example.com/a?id=1&utm_source=opencohost#f"
    );
  });

  it("leaves other utm parameters alone", () => {
    expect(attributedUrl("https://example.com/a?utm_medium=x&utm_campaign=y")).toBe(
      "https://example.com/a?utm_medium=x&utm_campaign=y&utm_source=opencohost"
    );
  });

  it("keeps a port and a path", () => {
    expect(attributedUrl("https://example.com:8443/a/b/")).toBe("https://example.com:8443/a/b/?utm_source=opencohost");
  });

  it.each([
    "http://example.com/a",
    "ftp://example.com/a",
    "javascript:alert(1)",
    "file:///C:/x",
    "data:text/html,hi",
    "//example.com/a",
    "example.com/a",
    "https://user:pw@example.com/a",
    "https://",
    "not a url",
    "",
    "   "
  ])("refuses %j (returns null)", (url) => {
    expect(attributedUrl(url)).toBeNull();
  });

  it("refuses non-string input", () => {
    expect(attributedUrl(undefined as unknown as string)).toBeNull();
    expect(attributedUrl(null as unknown as string)).toBeNull();
    expect(attributedUrl(5 as unknown as string)).toBeNull();
  });
});

describe("sourceHost", () => {
  it("is the bare lower-case host without www", () => {
    expect(sourceHost("https://www.Example.COM/a?x=1#f")).toBe("example.com");
    expect(sourceHost("https://news.example.org:8443/x")).toBe("news.example.org");
  });

  it("is computed from any http(s) URL, so a plain-text chip still names its site", () => {
    expect(sourceHost("http://example.com/a")).toBe("example.com");
  });

  it("is null for anything that has no host to name", () => {
    expect(sourceHost("javascript:alert(1)")).toBeNull();
    expect(sourceHost("mailto:a@b.com")).toBeNull();
    expect(sourceHost("not a url")).toBeNull();
    expect(sourceHost("")).toBeNull();
    expect(sourceHost(undefined as unknown as string)).toBeNull();
  });
});
