import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRAME_ANCESTORS,
  isEmbedPath,
  sanitizeAncestors,
  withFrameHeaders,
} from "@/lib/frameHeaders";

const req = (path: string) => new Request(`https://factory.snapie.io${path}`);
const page = (headers: Record<string, string> = {}) =>
  new Response("<html></html>", { status: 200, headers });

describe("withFrameHeaders", () => {
  it("lets /embed be framed by the allowed sites and drops X-Frame-Options", () => {
    const r = withFrameHeaders(req("/embed?week=latest"), page({ "x-frame-options": "DENY" }));
    expect(r.headers.get("x-frame-options")).toBeNull();
    expect(r.headers.get("content-security-policy")).toBe(
      `frame-ancestors ${DEFAULT_FRAME_ANCESTORS}`,
    );
  });
  it("keeps every other page frameable only by itself", () => {
    for (const path of ["/", "/embedded", "/anything"]) {
      const r = withFrameHeaders(req(path), page());
      expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(r.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    }
  });
  it("appends to or replaces a frame-ancestors directive in an existing CSP", () => {
    expect(
      withFrameHeaders(
        req("/embed"),
        page({ "content-security-policy": "default-src 'self'" }),
      ).headers.get("content-security-policy"),
    ).toBe(`default-src 'self'; frame-ancestors ${DEFAULT_FRAME_ANCESTORS}`);
    expect(
      withFrameHeaders(
        req("/embed"),
        page({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }),
      ).headers.get("content-security-policy"),
    ).toBe(`default-src 'self'; frame-ancestors ${DEFAULT_FRAME_ANCESTORS}`);
  });
  it("uses a configured ancestor list on /embed only", () => {
    const r = withFrameHeaders(
      req("/embed"),
      page(),
      "'self' https://app.example https://*.other.example",
    );
    expect(r.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self' https://app.example https://*.other.example",
    );
    expect(withFrameHeaders(req("/"), page(), "*").headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self'",
    );
  });
  it("preserves status and body", async () => {
    const r = withFrameHeaders(req("/embed"), new Response("hello", { status: 418 }));
    expect(r.status).toBe(418);
    expect(await r.text()).toBe("hello");
  });
});

describe("sanitizeAncestors", () => {
  it("accepts a clean list", () => {
    expect(sanitizeAncestors("'self' https://a.example https://*.b.example")).toBe(
      "'self' https://a.example https://*.b.example",
    );
    expect(sanitizeAncestors("*")).toBe("*");
  });
  it("ignores the whole value when any part is not a source expression, so a smuggled directive cannot widen it", () => {
    expect(sanitizeAncestors("'self' https://a.example; script-src * https://b.example")).toBe(
      DEFAULT_FRAME_ANCESTORS,
    );
    expect(sanitizeAncestors("https://a.example, https://b.example")).toBe(DEFAULT_FRAME_ANCESTORS);
    expect(sanitizeAncestors("https://a.example\nframe-ancestors *")).toBe(DEFAULT_FRAME_ANCESTORS);
    expect(sanitizeAncestors("javascript:alert(1) data:text/html")).toBe(DEFAULT_FRAME_ANCESTORS);
    expect(sanitizeAncestors(undefined)).toBe(DEFAULT_FRAME_ANCESTORS);
    expect(sanitizeAncestors("")).toBe(DEFAULT_FRAME_ANCESTORS);
  });
});

describe("isEmbedPath", () => {
  it("matches /embed and below, not look-alikes", () => {
    expect(isEmbedPath("/embed")).toBe(true);
    expect(isEmbedPath("/embed/x")).toBe(true);
    expect(isEmbedPath("/embedded")).toBe(false);
    expect(isEmbedPath("/")).toBe(false);
  });
});
