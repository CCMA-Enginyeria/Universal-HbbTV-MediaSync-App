/**
 * Lightweight fetcher/parser for companion web-page metadata.
 *
 * When the TV synchronizes a companion web page (an `.html` contentId), we want
 * to show the user *what* that content is instead of a generic globe icon. To do
 * so we fetch the page HTML and extract its title and favicon with a few small
 * regexes — a full HTML/DOM parser would be overkill here.
 *
 * React Native's native `fetch` is not subject to browser CORS restrictions, so
 * fetching a remote page's HTML from JS works. Any failure (network, timeout,
 * non-HTML response) degrades gracefully to `null` fields so the UI can fall
 * back to its default icon/text.
 */

// Cap how much of the response we scan: <title>/favicon links always live in the
// document <head>, so reading the first chunk is enough and avoids downloading
// large pages in full.
const MAX_HTML_BYTES = 200 * 1024; // 200 KB

/** Decode the handful of HTML entities that commonly appear in <title> text. */
const decodeEntities = (text) =>
  text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();

/** Read the value of a given attribute from a raw HTML tag string. */
const getAttr = (tag, attr) => {
  const match = tag.match(new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
};

/** Extract the page title from `<title>` or, preferably, an `og:title` meta. */
const parseTitle = (html) => {
  const metaTags = html.match(/<meta[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const prop = getAttr(tag, 'property') || getAttr(tag, 'name');
    if (prop && prop.toLowerCase() === 'og:title') {
      const content = getAttr(tag, 'content');
      if (content) return decodeEntities(content);
    }
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    const title = decodeEntities(titleMatch[1].replace(/\s+/g, ' '));
    if (title) return title;
  }
  return null;
};

/**
 * Extract the best favicon URL. Preference order: `apple-touch-icon` / `og:image`
 * (usually higher resolution) → any `<link rel~=icon>` → `${origin}/favicon.ico`.
 * Relative hrefs are resolved against the page URL.
 */
const parseFavicon = (html, pageUrl) => {
  const resolve = (href) => {
    if (!href) return null;
    try {
      return new URL(href, pageUrl).href;
    } catch {
      return null;
    }
  };

  const linkTags = html.match(/<link[^>]*>/gi) || [];
  let iconHref = null;
  let appleHref = null;
  for (const tag of linkTags) {
    const rel = (getAttr(tag, 'rel') || '').toLowerCase();
    if (!rel.includes('icon')) continue;
    const href = getAttr(tag, 'href');
    if (!href) continue;
    if (rel.includes('apple-touch-icon')) {
      appleHref = appleHref || href;
    } else {
      iconHref = iconHref || href;
    }
  }

  if (appleHref) return resolve(appleHref);

  // og:image as a secondary high-res option.
  const metaTags = html.match(/<meta[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const prop = getAttr(tag, 'property') || getAttr(tag, 'name');
    if (prop && prop.toLowerCase() === 'og:image') {
      const content = getAttr(tag, 'content');
      const resolved = resolve(content);
      if (resolved) return resolved;
    }
  }

  if (iconHref) return resolve(iconHref);

  try {
    return new URL('/favicon.ico', pageUrl).href;
  } catch {
    return null;
  }
};

/**
 * Fetch a companion web page and extract its display metadata.
 *
 * @param {string} url - The companion web-page URL (the CSS-CII contentId).
 * @param {{ signal?: AbortSignal }} [options] - Optional AbortSignal to cancel the request.
 * @returns {Promise<{ title: string|null, faviconUrl: string|null }>}
 *   Never rejects; on any error both fields are `null`.
 */
export async function fetchWebMetadata(url, { signal } = {}) {
  const empty = { title: null, faviconUrl: null };
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return empty;

  try {
    const response = await fetch(url, { signal });
    if (!response || !response.ok) return empty;

    let html = await response.text();
    if (html.length > MAX_HTML_BYTES) {
      html = html.slice(0, MAX_HTML_BYTES);
    }

    return {
      title: parseTitle(html),
      faviconUrl: parseFavicon(html, url),
    };
  } catch (error) {
    // Aborted requests are expected when the content changes; stay quiet.
    if (error?.name !== 'AbortError') {
      console.warn('⚠️ fetchWebMetadata failed:', error?.message || error);
    }
    return empty;
  }
}

export default fetchWebMetadata;
