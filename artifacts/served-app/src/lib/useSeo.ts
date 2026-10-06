import { useEffect } from "react";

const SITE_ORIGIN = "https://servedapp.co";

interface SeoOptions {
  title: string;
  description: string;
  path?: string;
  /**
   * When true, sets `<meta name="robots" content="noindex, nofollow">`
   * for this page (overriding the index.html default) and skips emitting
   * a canonical URL. Use on private invite links, 404s, and any page
   * whose content should never appear in search results. The directive
   * is automatically reset to the default `index, follow` on unmount so
   * subsequent route changes don't inherit it.
   */
  noindex?: boolean;
}

const DEFAULT_ROBOTS = "index, follow, max-image-preview:large";

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${name}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Per-route SEO. Updates <title>, meta description, canonical, and the
 * Open Graph / Twitter title+description so social-share cards reflect
 * whichever public page the user shared.
 *
 * Only call from PUBLIC pages. Auth-gated dashboards under /app/* should
 * NOT use this — their content isn't meant to be indexed and the static
 * SPA shell already carries the right defaults from index.html.
 */
export function useSeo({ title, description, path, noindex }: SeoOptions) {
  useEffect(() => {
    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);

    const canonicalPath = path ?? window.location.pathname;
    const canonical = `${SITE_ORIGIN}${canonicalPath === "/" ? "" : canonicalPath}` || `${SITE_ORIGIN}/`;
    setCanonical(canonical);
    setMeta("og:url", canonical, "property");

    if (noindex) {
      setMeta("robots", "noindex, nofollow");
    } else {
      setMeta("robots", DEFAULT_ROBOTS);
    }
    return () => {
      // Restore the default so subsequent route changes don't inherit
      // a stale noindex from a previous page.
      setMeta("robots", DEFAULT_ROBOTS);
    };
  }, [title, description, path, noindex]);
}
