import type { Request } from "express";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

/**
 * Build the canonical app base URL for redirects (Stripe, Clerk
 * invitations, password resets, etc.).
 *
 * Always derive the host from the *current request* — never blindly
 * trust REPLIT_DOMAINS[0]. In production we serve the same app on a
 * custom domain (e.g. servedapp.co) AND the .replit.app domain, and
 * the user's Clerk session cookie + Clerk publishable key are both
 * scoped to whichever domain they're using. If we send them back to a
 * different domain after a redirect:
 *   - Their Clerk session cookie isn't sent → they appear signed out.
 *   - The page loads with a different Clerk publishable key (via
 *     publishableKeyFromHost in the SPA) → any `__clerk_ticket` from
 *     a Clerk invitation fails to validate against the loaded
 *     instance → the SignUp component renders nothing → BLANK PAGE.
 *
 * Falls back to SERVED_APP_URL or REPLIT_DOMAINS[0] only when no host
 * header is present (which shouldn't happen for an HTTP request, but
 * keeps the helper safe in scripts/tests).
 */
export function appBaseUrl(req: Request): string {
  const explicit = process.env.SERVED_APP_URL?.replace(/\/+$/, "");
  const host =
    getClerkProxyHost(req) ||
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim() ||
    "";
  const protocol =
    (req.headers["x-forwarded-proto"] as string | undefined)
      ?.split(",")[0]
      ?.trim() ||
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const basePath = process.env.SERVED_APP_BASE_PATH ?? "";
  if (host) {
    return `${protocol}://${host}${basePath}`;
  }
  return explicit || `https://servedapp.co${basePath}`;
}
