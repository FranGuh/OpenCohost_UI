/**
 * Source links under a web answer (runtime-fixes-20261110 T5).
 *
 * Pure helpers. A source chip is labelled with the host computed HERE from the
 * URL it opens (never a separately supplied string), and opens the URL with an
 * attribution parameter so the site can see the visit came from OpenCohost.
 */

export const ATTRIBUTION_PARAM = "utm_source";
export const ATTRIBUTION_VALUE = "opencohost";

function parse(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** The bare, lower-case host (no `www.`, port, path or credentials) of an
 * http(s) URL, or null when there is no host to name. */
export function sourceHost(raw: string): string | null {
  const url = parse(raw);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return host || null;
}

function isAttributionKey(pair: string): boolean {
  const key = pair.split("=", 1)[0];
  try {
    return decodeURIComponent(key.replace(/\+/g, " ")) === ATTRIBUTION_PARAM;
  } catch {
    return key === ATTRIBUTION_PARAM;
  }
}

/**
 * The URL to open for a source: the same `https:` URL with
 * `utm_source=opencohost`. Every other query parameter and the fragment are
 * kept as written; an existing `utm_source` is replaced. Anything that is not an
 * `https:` URL without credentials returns null (the chip is then plain text).
 */
export function attributedUrl(raw: string): string | null {
  const url = parse(raw);
  if (!url || url.protocol !== "https:" || !url.hostname) return null;
  if (url.username || url.password) return null;
  const kept = url.search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "" && !isAttributionKey(pair));
  kept.push(`${ATTRIBUTION_PARAM}=${ATTRIBUTION_VALUE}`);
  url.search = kept.join("&");
  return url.toString();
}
