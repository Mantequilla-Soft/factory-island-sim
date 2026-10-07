/**
 * Framing rules. `/embed` may be framed by the listed sites; every other page may
 * only be framed by itself, so the full app (with its collector dialog) cannot be
 * clickjacked.
 */
export const DEFAULT_FRAME_ANCESTORS = "'self' https://snapie.io https://*.snapie.io";

export const isEmbedPath = (pathname: string) =>
  pathname === "/embed" || pathname.startsWith("/embed/");

/**
 * Validates a configured ancestor list. If ANY token is not a plain source expression the whole
 * value is ignored and the default applies, because filtering token by token can leave a stray
 * `*` behind when someone smuggles in another directive.
 */
export function sanitizeAncestors(raw: string | undefined): string {
  const parts = (raw ?? "").trim().split(/\s+/).filter(Boolean);
  const ok =
    parts.length > 0 &&
    parts.every((p) => /^('self'|'none'|\*|https?:\/\/[A-Za-z0-9*.:-]+)$/.test(p));
  return ok ? parts.join(" ") : DEFAULT_FRAME_ANCESTORS;
}

/** Returns a copy of `response` with the framing headers for `request`'s path applied. */
export function withFrameHeaders(
  request: Request,
  response: Response,
  envAncestors?: string,
): Response {
  const headers = new Headers(response.headers);
  const embed = isEmbedPath(new URL(request.url).pathname);
  const ancestors = embed ? sanitizeAncestors(envAncestors) : "'self'";

  // frame-ancestors is the modern control; X-Frame-Options cannot list several origins,
  // so it is dropped on /embed and kept as SAMEORIGIN everywhere else.
  headers.delete("x-frame-options");
  if (!embed) headers.set("x-frame-options", "SAMEORIGIN");

  const existing = headers.get("content-security-policy");
  const directive = `frame-ancestors ${ancestors}`;
  if (!existing) headers.set("content-security-policy", directive);
  else if (!/(^|;)\s*frame-ancestors\b/i.test(existing))
    headers.set("content-security-policy", `${existing}; ${directive}`);
  else
    headers.set(
      "content-security-policy",
      existing.replace(/(^|;)\s*frame-ancestors[^;]*/i, `$1 ${directive}`),
    );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
