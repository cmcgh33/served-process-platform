import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import {
  Switch,
  Route,
  Router as WouterRouter,
  Redirect,
  useLocation,
} from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useAuth,
  useClerk,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { brand } from "@/lib/brand";
import { useSeo } from "@/lib/useSeo";
import { Layout } from "@/components/layout/layout";
import { RequesterLayout } from "@/components/layout/requester-layout";
import { AttorneyLayout } from "@/components/layout/attorney-layout";
import { ServerLayout } from "@/components/layout/server-layout";
import { AdminLayout } from "@/components/layout/admin-layout";
import { AdminPortalGuard } from "@/components/admin/admin-guard";

// Pages — public
import Home from "@/pages/home";
import DemoIndex from "@/pages/demo/index";
import TourPage from "@/pages/demo/tour";
import PrivacyPage from "@/pages/legal/privacy";
import TermsPage from "@/pages/legal/terms";
import NevadaFaqPage from "@/pages/resources/nevada-faq";
import RoleChooser from "@/pages/role-chooser";

// Pages — admin / shared
import Dashboard from "@/pages/dashboard";
import JobsList from "@/pages/jobs/index";
import NewJob from "@/pages/jobs/new";
import JobDetail from "@/pages/jobs/detail";
import MyJobs from "@/pages/my-jobs";
import ServersList from "@/pages/servers/index";
import ServerDetail from "@/pages/servers/detail";
import ClientsList from "@/pages/clients/index";
import NotFound from "@/pages/not-found";

// Pages — requester
import RequesterDashboard from "@/pages/requester/dashboard";
import RequesterPostJob from "@/pages/requester/post-job";
import RequesterMyJobs from "@/pages/requester/my-jobs";
import RequesterJobDetail from "@/pages/requester/job-detail";
import RequesterVault from "@/pages/requester/vault";
import RequesterTracking from "@/pages/requester/tracking";

// Pages — server
import ServerDashboard from "@/pages/server/dashboard";
import ServerJobFeed from "@/pages/server/job-feed";
import ServerWallet from "@/pages/server/wallet";
import ServerCompletedJobs from "@/pages/server/completed-jobs";
import ServerProof from "@/pages/server/proof";
import ServerTracking from "@/pages/server/tracking";
import ServerCredentialing from "@/pages/server/credentialing";
import ServerTraining from "@/pages/server/training";

// Pages — attorney
import AttorneyDashboard from "@/pages/attorney/dashboard";
import AttorneyPostJob from "@/pages/attorney/post-job";
import AttorneyMyJobs from "@/pages/attorney/my-jobs";
import AttorneyArchive from "@/pages/attorney/archive";
import AttorneySubscription from "@/pages/attorney/subscription";
import AttorneySettings from "@/pages/attorney/settings";
import AttorneyTracking from "@/pages/attorney/tracking";
import AttorneyOnboarding from "@/pages/attorney/onboarding";

// Pages — admin
import AdminDashboard from "@/pages/admin/dashboard";
import AdminJobsPage from "@/pages/admin/jobs";
import AdminServersPage from "@/pages/admin/servers";
import AdminServerDetailPage from "@/pages/admin/server-detail";
import AdminUsersPage from "@/pages/admin/users";
import AdminAuditPage from "@/pages/admin/audit";
import AdminDemoPage from "@/pages/admin/demo";
import DemoWatchPage from "@/pages/demo/watch";

import { useMe, type UserRole } from "@/lib/me";
import {
  useGetMyFirmProfile,
  getGetMyFirmProfileQueryKey,
} from "@workspace/api-client-react";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Resolve the publishable key from window.location.hostname so the same
// build can serve multiple Clerk custom domains. Falls back to
// VITE_CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// Empty in dev (Clerk uses FAPI from publishable key), set automatically in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in env");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const dashboardForRole = (role: UserRole | null | undefined): string => {
  switch (role) {
    case "requester":
      return "/app/requester/dashboard";
    case "attorney":
      return "/app/attorney/dashboard";
    case "server":
      return "/app/server/dashboard";
    default:
      return "/app/role-chooser";
  }
};

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: brand.amber,
    colorForeground: "#f8fafc",
    colorMutedForeground: "#94a3b8",
    colorDanger: "#f87171",
    colorBackground: brand.navyDeep,
    colorInput: brand.navy,
    colorInputForeground: "#f8fafc",
    colorNeutral: "#1e293b",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-brand-navy-deep rounded-2xl w-[440px] max-w-full overflow-hidden border border-amber-500/20 shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButton:
      "border border-slate-700 bg-brand-navy hover:bg-[#13264a]",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-slate-200",
    formFieldInput:
      "bg-brand-navy border border-slate-700 text-white placeholder:text-slate-500",
    formButtonPrimary:
      "bg-amber-400 hover:bg-amber-300 text-brand-navy font-bold",
    footerActionLink: "text-amber-400 hover:text-amber-300",
    footerActionText: "text-slate-400",
    footerAction: "text-slate-400",
    dividerLine: "bg-slate-700",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-amber-400 hover:text-amber-300",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-slate-200",
    alert: "border border-amber-500/30 bg-amber-500/10",
    otpCodeFieldInput: "bg-brand-navy border border-slate-700 text-white",
    formFieldRow: "text-slate-200",
    main: "bg-transparent",
    logoBox: "mb-2",
    logoImage: "h-9",
  },
};

/**
 * sessionStorage key for the sign-up "intent" (which portal the user
 * came from). Clerk's <SignUp> internally navigates between steps
 * (email → password → email-verification) using its own routing, and
 * the `?intent=server` query param does NOT survive those hops. If we
 * only read intent from the URL, the post-signup `fallbackRedirectUrl`
 * gets recomputed without the intent and the user is dumped on the
 * generic role chooser (which falls through to the individual portal).
 * Stashing the intent in sessionStorage on first SignUpPage render keeps
 * it available across the entire signup flow.
 */
const SIGN_UP_INTENT_KEY = "served:sign-up-intent";

/**
 * Read `?intent=<role>` from the URL so we can forward the user's chosen
 * portal through Clerk's sign-in / sign-up flow and skip the role chooser
 * once they're authenticated. Falls back to the sessionStorage stash so
 * the intent survives Clerk's mid-signup page navigation. Returns null
 * for unknown values.
 */
function readIntentRole(): UserRole | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("intent");
  if (fromUrl === "requester" || fromUrl === "attorney" || fromUrl === "server") {
    return fromUrl;
  }
  let stashed: string | null = null;
  try {
    stashed = sessionStorage.getItem(SIGN_UP_INTENT_KEY);
  } catch {
    // sessionStorage may be disabled (Safari private mode, etc).
  }
  if (stashed === "requester" || stashed === "attorney" || stashed === "server") {
    return stashed;
  }
  return null;
}

/**
 * Persist the sign-up intent so it survives Clerk's internal navigation.
 * Safe to call from a render path — sessionStorage writes are synchronous
 * and we want the value visible to the very next call to readIntentRole.
 */
function rememberSignUpIntent(role: UserRole): void {
  try {
    sessionStorage.setItem(SIGN_UP_INTENT_KEY, role);
  } catch {
    // sessionStorage may be disabled. Best-effort.
  }
}

/**
 * Clear the sign-up intent stash once the user has landed on (or past)
 * the role chooser. Called from PortalAfterAuth so the next visitor in
 * this browser doesn't inherit a stale intent.
 */
function clearSignUpIntent(): void {
  try {
    sessionStorage.removeItem(SIGN_UP_INTENT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Per-portal sign-in pages stash the portal slug here so it survives a full
 * page reload after Clerk completes the OAuth round-trip (the URL
 * `?preselect` query string can otherwise get lost during the redirect
 * chain). Cleared by `consumeSignInPortal` once PortalAfterAuth uses it.
 *
 * Stored values: "individual" | "attorney" | "server" | "admin".
 */
const SIGN_IN_PORTAL_KEY = "served:sign-in-portal";

type StoredPortalSlug = "individual" | "attorney" | "server" | "admin";

function rememberSignInPortal(slug: StoredPortalSlug): void {
  try {
    sessionStorage.setItem(SIGN_IN_PORTAL_KEY, slug);
  } catch {
    // sessionStorage may be disabled (Safari private mode, etc). Best-effort.
  }
}

function consumeSignInPortal(): StoredPortalSlug | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SIGN_IN_PORTAL_KEY);
    if (raw) sessionStorage.removeItem(SIGN_IN_PORTAL_KEY);
  } catch {
    return null;
  }
  if (
    raw === "individual" ||
    raw === "attorney" ||
    raw === "server" ||
    raw === "admin"
  ) {
    return raw;
  }
  return null;
}

function roleChooserRedirect(): string {
  const intent = readIntentRole();
  return intent
    ? `${basePath}/app/role-chooser?preselect=${intent}`
    : `${basePath}/app/role-chooser`;
}

/**
 * Per-portal sign-in configurations. Each entry renders a role-branded shell
 * above Clerk's `<SignIn>` widget and routes signed-in users straight to the
 * matching portal (skipping the role chooser for new users via `?preselect`).
 *
 * `admin` is special: it does not auto-assign a role. After sign-in we land
 * the user on `/app/admin`, where `AdminPortalGuard` decides whether they're
 * authorized.
 */
type SignInPortal = {
  slug: "individual" | "attorney" | "server" | "admin";
  preselect: UserRole | null;
  /** Path used by wouter `<Redirect>` (basePath stripped — wouter's router adds it). */
  postAuthPath: string;
  /** Absolute URL with basePath included — used by Clerk's `fallbackRedirectUrl`. */
  fallbackRedirect: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
};

const PORTAL_SIGN_IN_CONFIGS: Record<SignInPortal["slug"], SignInPortal> = {
  individual: {
    slug: "individual",
    preselect: "requester",
    postAuthPath: "/app/role-chooser?preselect=requester",
    fallbackRedirect: `${basePath}/app/role-chooser?preselect=requester`,
    eyebrow: "For Individuals",
    title: "Sign in to serve papers",
    subtitle:
      "Track your server live and download a court-ready affidavit the moment service is complete.",
    accent: "var(--color-brand-amber)",
    accentBg: "rgba(245,158,11,0.12)",
    accentBorder: "rgba(245,158,11,0.3)",
  },
  attorney: {
    slug: "attorney",
    preselect: "attorney",
    postAuthPath: "/app/role-chooser?preselect=attorney",
    fallbackRedirect: `${basePath}/app/role-chooser?preselect=attorney`,
    eyebrow: "For Attorneys & Firms",
    title: "Sign in to your firm portal",
    subtitle:
      "Manage cases, dispatch in bulk, and unlock ProServe pricing built to beat ABC Legal.",
    accent: "var(--color-brand-sky)",
    accentBg: "rgba(56,189,248,0.12)",
    accentBorder: "rgba(56,189,248,0.3)",
  },
  server: {
    slug: "server",
    preselect: "server",
    postAuthPath: "/app/role-chooser?preselect=server",
    fallbackRedirect: `${basePath}/app/role-chooser?preselect=server`,
    eyebrow: "For Process Servers",
    title: "Sign in to take jobs",
    subtitle:
      "Live job feed, GPS routing, instant cash-out, and 80% of every serve.",
    accent: "var(--color-brand-emerald)",
    accentBg: "rgba(52,211,153,0.12)",
    accentBorder: "rgba(52,211,153,0.3)",
  },
  admin: {
    slug: "admin",
    preselect: null,
    postAuthPath: "/app/admin",
    fallbackRedirect: `${basePath}/app/admin`,
    eyebrow: "Admin Access",
    title: "SERVED. operations sign-in",
    subtitle:
      "Restricted to authorized SERVED. operations staff. Access is checked after sign-in.",
    accent: "var(--color-brand-amber)",
    accentBg: "rgba(245,158,11,0.12)",
    accentBorder: "rgba(245,158,11,0.3)",
  },
};

function PortalSignInHeader({ portal }: { portal: SignInPortal }) {
  return (
    <div className="w-[440px] max-w-full mb-5 text-center">
      <div
        className="inline-block px-3 py-1 rounded-full text-[11px] font-black tracking-widest uppercase mb-3"
        style={{
          color: portal.accent,
          background: portal.accentBg,
          border: `1px solid ${portal.accentBorder}`,
        }}
        data-testid={`text-portal-eyebrow-${portal.slug}`}
      >
        {portal.eyebrow}
      </div>
      <h1
        className="text-white font-black text-2xl sm:text-[1.7rem] leading-tight tracking-tight mb-2"
        data-testid={`text-portal-title-${portal.slug}`}
      >
        {portal.title}
      </h1>
      <p className="text-sm text-slate-400 leading-relaxed">{portal.subtitle}</p>
    </div>
  );
}

function PortalSignInForm({ portal }: { portal: SignInPortal }) {
  // Stash the portal slug so it survives any redirect chain (Clerk's OAuth
  // round-trip can drop the URL query string before we get back).
  // PortalAfterAuth consumes this when the user has no role yet — including
  // the admin portal, which has no preselect role but still needs a
  // dedicated post-auth target.
  useEffect(() => {
    rememberSignInPortal(portal.slug);
  }, [portal.slug]);
  // Sign-up still flows through the role chooser; carry the intent in the
  // query string so first-time users skip it.
  const signUpHref = portal.preselect
    ? `${basePath}/sign-up?intent=${portal.preselect}`
    : `${basePath}/sign-up`;
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-brand-navy px-4 py-10">
      <PortalSignInHeader portal={portal} />
      <SignIn
        routing="path"
        path={`${basePath}/sign-in/${portal.slug}`}
        signUpUrl={signUpHref}
        fallbackRedirectUrl={portal.fallbackRedirect}
      />
      <p className="mt-5 text-xs text-slate-500">
        Need a different portal?{" "}
        <a
          href={`${basePath}/sign-in`}
          className="text-amber-400 hover:text-amber-300 font-semibold"
          data-testid={`link-generic-sign-in-${portal.slug}`}
        >
          See all sign-in options
        </a>
      </p>
    </div>
  );
}

function PortalSignInPage({ portal }: { portal: SignInPortal }) {
  // Already-signed-in users (e.g. session injected from another tab, or a
  // returning user clicking a marketing link) skip Clerk's widget entirely
  // and go straight to the portal-aware redirect target so the `?preselect`
  // intent isn't lost. The `<Show>` components are reactive to Clerk's
  // session state, so this also fires the moment a sign-in completes.
  return (
    <>
      <Show when="signed-in">
        <Redirect to={portal.postAuthPath} />
      </Show>
      <Show when="signed-out">
        <PortalSignInForm portal={portal} />
      </Show>
    </>
  );
}

function IndividualSignInPage() {
  return <PortalSignInPage portal={PORTAL_SIGN_IN_CONFIGS.individual} />;
}
function AttorneySignInPage() {
  return <PortalSignInPage portal={PORTAL_SIGN_IN_CONFIGS.attorney} />;
}
function ServerSignInPage() {
  return <PortalSignInPage portal={PORTAL_SIGN_IN_CONFIGS.server} />;
}
function AdminSignInPage() {
  return <PortalSignInPage portal={PORTAL_SIGN_IN_CONFIGS.admin} />;
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-brand-navy px-4 py-10">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={roleChooserRedirect()}
      />
    </div>
  );
}

function SignUpPage() {
  useSeo({
    title: "Sign Up — SERVED. Process Serving Platform (Las Vegas, NV)",
    description:
      "Create your SERVED. account to post process serving jobs, manage a Nevada law firm's case load, or claim NV PILB-licensed server work.",
    path: "/sign-up",
  });
  // Explicit auth-state checks (instead of <Show when=...>) so we always
  // render *something*. The <Show> approach renders nothing while Clerk is
  // initialising (or stuck in an indeterminate state due to a stale dev
  // cookie hitting the prod instance — Clerk emits the "azp claim missing"
  // warning in that case), which appears to the invitee as a blank white
  // page after they click the "Accept invitation" email link.
  const { isLoaded, isSignedIn } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const hasTicket = params.has("__clerk_ticket");
  // Admin invitation links use `?email=<addr>&intent=server&server_invite=1`
  // instead of Clerk's invitation ticket flow (which was 403ing on
  // /v1/tickets/accept and producing white pages — see the comment in
  // routes/admin.ts new-invite path). Pre-fill the SignUp form with the
  // invited email so the recipient just sets a password and goes.
  const prefillEmail = params.get("email") ?? undefined;
  // Stash the intent in sessionStorage on the very first render so it
  // survives Clerk's internal navigation between sign-up steps (email →
  // password → email-verification). Clerk strips our `?intent=server`
  // query param during those hops, which would otherwise cause the
  // post-signup `fallbackRedirectUrl` to lose the preselect and dump
  // the user into the generic role chooser → individual portal.
  const intentFromUrl = params.get("intent");
  if (
    intentFromUrl === "requester" ||
    intentFromUrl === "attorney" ||
    intentFromUrl === "server"
  ) {
    rememberSignUpIntent(intentFromUrl);
  }
  // Clerk appends `__clerk_status` to invitation redirect URLs:
  //   - `sign_up`  → email is new to Clerk, <SignUp> consumes the ticket.
  //   - `sign_in`  → email already has a Clerk account (e.g. from another
  //                  Clerk-powered product, a prior accepted invite, or a
  //                  direct sign-up). <SignUp> 403s on /v1/tickets/accept
  //                  for these → blank page. <SignIn> is the component that
  //                  knows how to attach the ticket to the existing user
  //                  and complete the invitation.
  const clerkStatus = params.get("__clerk_status");
  const isSignInTicket = hasTicket && clerkStatus === "sign_in";

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-brand-navy px-4 py-10">
      {!isLoaded ? (
        <FullPageLoader />
      ) : isSignedIn ? (
        // Invitee guard: if a Clerk invitation ticket is present in the URL
        // but the visitor is already signed in to a different account in
        // this browser, Clerk's components 403 on /v1/tickets/accept and
        // render nothing — appearing to the invitee as a white page. We
        // intercept that case and offer a clean "sign out and continue"
        // path before mounting the component. When there's no ticket, just
        // bounce them to the role chooser.
        hasTicket ? (
          <InviteSignOutPrompt />
        ) : (
          <Redirect to="/app/role-chooser" />
        )
      ) : isSignInTicket ? (
        // Existing-account invitee: hand them off to <SignIn>, which is the
        // component that can attach the invitation ticket to the existing
        // Clerk user. We preserve the full query string so the ticket and
        // any intent= flags survive the hop.
        <Redirect to={`/sign-in${window.location.search}`} />
      ) : (
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
          fallbackRedirectUrl={roleChooserRedirect()}
          initialValues={prefillEmail ? { emailAddress: prefillEmail } : undefined}
        />
      )}
    </div>
  );
}

/**
 * Rendered on /sign-up when the visitor is already authenticated. The
 * usual case is "/sign-up was opened directly with no invite ticket" —
 * we just bounce them to where they belong. The interesting case is
 * "they followed an admin's invitation email link" (?__clerk_ticket=…)
 * — we cannot accept the new-account ticket while another session is
 * live, so we surface a Sign-out CTA that preserves the ticket on
 * reload so <SignUp> can finish the job.
 */
function InviteSignOutPrompt() {
  const clerk = useClerk();
  const params = new URLSearchParams(window.location.search);
  const hasTicket = params.has("__clerk_ticket");
  if (!hasTicket) {
    // No invite in flight — nothing useful to do here. Send them to
    // the role chooser (or wherever PortalAfterAuth would route them).
    return <Redirect to="/app/role-chooser" />;
  }
  const handleSignOut = async () => {
    // Sign out and stay on this URL so the ticket query string is
    // preserved; <SignUp> will mount on the next render and consume it.
    await clerk.signOut({ redirectUrl: window.location.href });
  };
  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-center space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Finish setting up your account</h1>
      <p className="text-sm text-gray-600">
        You're already signed in to a different SERVED. account in this browser.
        To accept this invitation, sign out first and then this page will
        guide you through creating your account.
      </p>
      <button
        type="button"
        onClick={handleSignOut}
        data-testid="button-invite-sign-out"
        className="w-full rounded-lg bg-amber-400 hover:bg-amber-500 text-black font-bold px-4 py-2.5 transition-colors"
      >
        Sign out and continue
      </button>
    </div>
  );
}

/**
 * Public landing page at `/`. We intentionally render <Home /> for both
 * signed-in and signed-out visitors instead of auto-redirecting authed
 * users into their portal. The marketing site is a public destination —
 * an admin who pops open the marketing URL in another window expects to
 * see the marketing site, not be teleported back into /app/admin.
 *
 * Signed-in visitors still get a prominent "Go to your portal" CTA in
 * the Home page header (see PortalRedirectAfterSignIn in pages/home.tsx).
 */
function HomeOrPortal() {
  return <Home />;
}

function PortalAfterAuth() {
  // After sign-in, route to the user's dashboard or the role chooser.
  // Brand-new users (no role yet) who came through a per-portal sign-in
  // page have their portal slug stashed in sessionStorage — honour it so
  // they land in the right portal even if the URL `?preselect` query was
  // dropped during the OAuth redirect chain.
  const me = useMe();
  if (me.isLoading) return <FullPageLoader />;
  const role = me.data?.role;
  // Always consume (read + clear) the stashed slug so it can never leak
  // into a later sign-in by a different user in the same tab — including
  // the case where the current user already has a role and we don't need
  // the intent ourselves.
  const portalSlug = consumeSignInPortal();
  if (role) {
    // User already has a role — the sign-up intent has done its job.
    clearSignUpIntent();
    return <Redirect to={dashboardForRole(role)} />;
  }
  if (portalSlug === "admin") return <Redirect to="/app/admin" />;
  if (portalSlug === "individual")
    return <Redirect to="/app/role-chooser?preselect=requester" />;
  if (portalSlug === "attorney")
    return <Redirect to="/app/role-chooser?preselect=attorney" />;
  if (portalSlug === "server")
    return <Redirect to="/app/role-chooser?preselect=server" />;
  // Last-ditch fallback: if no per-portal sign-in slug was stashed but a
  // sign-up `intent=` is still around (URL or sessionStorage), honour it
  // so server invitees never land on the generic role chooser.
  const intent = readIntentRole();
  if (intent) return <Redirect to={`/app/role-chooser?preselect=${intent}`} />;
  return <Redirect to="/app/role-chooser" />;
}

function FullPageLoader() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-brand-navy text-amber-400">
      <div className="text-sm font-semibold tracking-wide animate-pulse">
        Loading your portal…
      </div>
    </div>
  );
}

/** Require sign-in. Signed-out users are sent to the public landing page. */
function RequireAuth({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

/** Require a specific role. Wrong roles get redirected to their own dashboard. */
function RequireRole({
  allowed,
  children,
}: {
  allowed: UserRole[];
  children: ReactNode;
}) {
  const me = useMe();
  if (me.isLoading) return <FullPageLoader />;
  const role = me.data?.role ?? null;
  if (!role) return <Redirect to="/app/role-chooser" />;
  if (!allowed.includes(role)) return <Redirect to={dashboardForRole(role)} />;
  return <>{children}</>;
}

/**
 * Once a user has a role, `/app/role-chooser` normally bounces them to their
 * dashboard. Pass `?switch=1` (e.g. from the sidebar "Switch role" link) to
 * keep the chooser visible so they can move between portals.
 *
 * `?preselect=<role>` is set by the home page sign-up cards so first-time
 * users skip the chooser entirely and land on the right dashboard.
 */
/**
 * Clears any leftover sign-in portal slug as soon as the post-auth landing
 * page mounts. This handles the case where Clerk's `fallbackRedirectUrl`
 * navigates straight to `/app/role-chooser` or `/app/admin` without
 * passing through `PortalAfterAuth` at `/`.
 */
function ClearSignInPortalOnMount() {
  useEffect(() => {
    consumeSignInPortal();
  }, []);
  return null;
}

function RoleChooserOrRedirect() {
  const me = useMe();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const isSwitching = params.get("switch") === "1";
  if (me.isLoading) return <FullPageLoader />;
  if (me.data?.role && !isSwitching) {
    return <Redirect to={dashboardForRole(me.data.role)} />;
  }
  return (
    <>
      <ClearSignInPortalOnMount />
      <RoleChooser />
    </>
  );
}

function withRoleLayout<TProps extends object>(
  Layout: ComponentType<{ children: ReactNode }>,
  Page: ComponentType<TProps>,
  roles: UserRole[],
) {
  return function Wrapped(props: TProps) {
    return (
      <RequireAuth>
        <RequireRole allowed={roles}>
          <Layout>
            <Page {...props} />
          </Layout>
        </RequireRole>
      </RequireAuth>
    );
  };
}

/**
 * First-visit onboarding gate for attorney pages. Reads
 * /me/firm-profile; while loading shows nothing (avoids flash); when
 * `attorneyOnboardedAt` is null, redirects to /app/attorney/onboarding
 * so the attorney completes the firm-info form before doing anything
 * else. Onboarding + settings pages bypass the gate so the attorney
 * can still get out (and so onboarding itself doesn't loop).
 */
function RequireAttorneyOnboarded({ children }: { children: ReactNode }) {
  const profileQuery = useGetMyFirmProfile({
    query: {
      queryKey: getGetMyFirmProfileQueryKey(),
      refetchOnWindowFocus: false,
      // Stay quiet on transient errors — don't block dashboard if /me
      // is briefly unreachable. Better to render with stale data than
      // bounce the user to onboarding incorrectly.
      retry: 1,
    },
  });
  if (profileQuery.isLoading) return <FullPageLoader />;
  // Only redirect on a clean response saying "not onboarded yet".
  // If the request errored, fall through and let the page render so
  // an API hiccup never traps a returning attorney on onboarding.
  if (profileQuery.data && !profileQuery.data.attorneyOnboardedAt) {
    return <Redirect to="/app/attorney/onboarding" />;
  }
  return <>{children}</>;
}

function withAttorneyGate<TProps extends object>(
  Page: ComponentType<TProps>,
) {
  return function Wrapped(props: TProps) {
    return (
      <RequireAuth>
        <RequireRole allowed={["attorney"]}>
          <RequireAttorneyOnboarded>
            <AttorneyLayout>
              <Page {...props} />
            </AttorneyLayout>
          </RequireAttorneyOnboarded>
        </RequireRole>
      </RequireAuth>
    );
  };
}

const ReqDashboard = withRoleLayout(RequesterLayout, RequesterDashboard, ["requester"]);
const ReqPostJob = withRoleLayout(RequesterLayout, RequesterPostJob, ["requester"]);
const ReqMyJobs = withRoleLayout(RequesterLayout, RequesterMyJobs, ["requester"]);
const ReqJobDetail = withRoleLayout(RequesterLayout, RequesterJobDetail, ["requester"]);
// Attorneys reuse the same read-only job detail body; only the layout
// + portalBasePath (for back-link routing) change.
const AttorneyJobDetailPage = () => <RequesterJobDetail portalBasePath="/app/attorney" />;
const AttJobDetail = withAttorneyGate(AttorneyJobDetailPage);
const ReqVault = withRoleLayout(RequesterLayout, RequesterVault, ["requester"]);
const ReqTracking = withRoleLayout(RequesterLayout, RequesterTracking, ["requester"]);

const SrvDashboard = withRoleLayout(ServerLayout, ServerDashboard, ["server"]);
const SrvJobFeed = withRoleLayout(ServerLayout, ServerJobFeed, ["server"]);
const SrvWallet = withRoleLayout(ServerLayout, ServerWallet, ["server"]);
const SrvCompletedJobs = withRoleLayout(ServerLayout, ServerCompletedJobs, ["server"]);
const SrvProof = withRoleLayout(ServerLayout, ServerProof, ["server"]);
const SrvTracking = withRoleLayout(ServerLayout, ServerTracking, ["server"]);
const SrvCredentialing = withRoleLayout(ServerLayout, ServerCredentialing, ["server"]);
const SrvTraining = withRoleLayout(ServerLayout, ServerTraining, ["server"]);

const AttDashboard = withAttorneyGate(AttorneyDashboard);
const AttPostJob = withAttorneyGate(AttorneyPostJob);
const AttMyJobs = withAttorneyGate(AttorneyMyJobs);
const AttArchive = withAttorneyGate(AttorneyArchive);
const AttSubscription = withAttorneyGate(AttorneySubscription);
// Settings + onboarding intentionally bypass the gate so the attorney
// can always reach them even when firm profile is incomplete.
const AttSettings = withRoleLayout(AttorneyLayout, AttorneySettings, ["attorney"]);
const AttTracking = withAttorneyGate(AttorneyTracking);
function AttOnboardingPage() {
  return (
    <RequireAuth>
      <RequireRole allowed={["attorney"]}>
        <AttorneyOnboarding />
      </RequireRole>
    </RequireAuth>
  );
}

// Admin / shared portal — open to any signed-in user with a role for now.
function AdminGuarded({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <RequireRole allowed={["requester", "attorney", "server"]}>
        <Layout>{children}</Layout>
      </RequireRole>
    </RequireAuth>
  );
}

function Router() {
  return (
    <Switch>
      {/* PUBLIC */}
      <Route path="/" component={HomeOrPortal} />
      <Route path="/demo" component={DemoIndex} />
      <Route path="/demo/watch/:token" component={DemoWatchPage} />
      <Route path="/demo/:role" component={TourPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/nevada-process-serving-faq" component={NevadaFaqPage} />
      {/* Per-portal sign-in pages (must come before the generic wildcard). */}
      <Route path="/sign-in/individual/*?" component={IndividualSignInPage} />
      <Route path="/sign-in/attorney/*?" component={AttorneySignInPage} />
      <Route path="/sign-in/server/*?" component={ServerSignInPage} />
      <Route path="/sign-in/admin/*?" component={AdminSignInPage} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />

      {/* AUTHENTICATED — role chooser */}
      <Route path="/app/role-chooser">
        <RequireAuth>
          <RoleChooserOrRedirect />
        </RequireAuth>
      </Route>

      {/* Role-root aliases redirect to each portal's dashboard. */}
      <Route path="/app/requester">
        {() => <Redirect to="/app/requester/dashboard" />}
      </Route>
      <Route path="/app/server">
        {() => <Redirect to="/app/server/dashboard" />}
      </Route>
      <Route path="/app/attorney">
        {() => <Redirect to="/app/attorney/dashboard" />}
      </Route>

      {/* AUTHENTICATED — requester portal */}
      <Route path="/app/requester/dashboard" component={ReqDashboard} />
      <Route path="/app/requester/post-job" component={ReqPostJob} />
      <Route path="/app/requester/jobs" component={ReqMyJobs} />
      <Route path="/app/requester/jobs/:id" component={ReqJobDetail} />
      <Route path="/app/requester/vault" component={ReqVault} />
      <Route path="/app/requester/tracking" component={ReqTracking} />
      <Route path="/app/requester/tracking/:id" component={ReqTracking} />

      {/* AUTHENTICATED — server portal */}
      <Route path="/app/server/dashboard" component={SrvDashboard} />
      <Route path="/app/server/job-feed" component={SrvJobFeed} />
      <Route path="/app/server/wallet" component={SrvWallet} />
      <Route path="/app/server/jobs/completed" component={SrvCompletedJobs} />
      <Route path="/app/server/credentialing" component={SrvCredentialing} />
      <Route path="/app/server/training" component={SrvTraining} />
      <Route path="/app/server/proof/:id" component={SrvProof} />
      <Route path="/app/server/tracking" component={SrvTracking} />
      <Route path="/app/server/tracking/:id" component={SrvTracking} />

      {/* AUTHENTICATED — attorney portal */}
      <Route path="/app/attorney/onboarding" component={AttOnboardingPage} />
      <Route path="/app/attorney/dashboard" component={AttDashboard} />
      <Route path="/app/attorney/post-job" component={AttPostJob} />
      <Route path="/app/attorney/jobs" component={AttMyJobs} />
      <Route path="/app/attorney/jobs/:id" component={AttJobDetail} />
      <Route path="/app/attorney/archive" component={AttArchive} />
      <Route path="/app/attorney/subscription" component={AttSubscription} />
      <Route path="/app/attorney/settings" component={AttSettings} />
      <Route path="/app/attorney/tracking" component={AttTracking} />
      <Route path="/app/attorney/tracking/:id" component={AttTracking} />

      {/* AUTHENTICATED — owner-only admin portal */}
      <Route path="/app/admin">
        <ClearSignInPortalOnMount />
        <AdminPortalGuard>
          <AdminLayout>
            <AdminDashboard />
          </AdminLayout>
        </AdminPortalGuard>
      </Route>
      <Route path="/app/admin/jobs">
        <ClearSignInPortalOnMount />
        <AdminPortalGuard>
          <AdminLayout>
            <AdminJobsPage />
          </AdminLayout>
        </AdminPortalGuard>
      </Route>
      <Route path="/app/admin/servers/:id">
        <ClearSignInPortalOnMount />
        <AdminPortalGuard>
          <AdminLayout>
            <AdminServerDetailPage />
          </AdminLayout>
        </AdminPortalGuard>
      </Route>
      <Route path="/app/admin/servers">
        <ClearSignInPortalOnMount />
        <AdminPortalGuard>
          <AdminLayout>
            <AdminServersPage />
          </AdminLayout>
        </AdminPortalGuard>
      </Route>
      <Route path="/app/admin/users">
        <ClearSignInPortalOnMount />
        <AdminPortalGuard>
          <AdminLayout>
            <AdminUsersPage />
          </AdminLayout>
        </AdminPortalGuard>
      </Route>
      <Route path="/app/admin/demo">
        <ClearSignInPortalOnMount />
        <AdminPortalGuard>
          <AdminLayout>
            <AdminDemoPage />
          </AdminLayout>
        </AdminPortalGuard>
      </Route>
      <Route path="/app/admin/audit">
        <AdminPortalGuard>
          <AdminLayout>
            <AdminAuditPage />
          </AdminLayout>
        </AdminPortalGuard>
      </Route>

      {/* AUTHENTICATED — admin / ops shared sidebar */}
      <Route path="/app/dashboard">
        <AdminGuarded><Dashboard /></AdminGuarded>
      </Route>
      <Route path="/app/jobs">
        <AdminGuarded><JobsList /></AdminGuarded>
      </Route>
      <Route path="/app/jobs/new">
        <AdminGuarded><NewJob /></AdminGuarded>
      </Route>
      <Route path="/app/jobs/:id">
        <AdminGuarded><JobDetail /></AdminGuarded>
      </Route>
      <Route path="/app/my-jobs">
        <AdminGuarded><MyJobs /></AdminGuarded>
      </Route>
      <Route path="/app/servers">
        <AdminGuarded><ServersList /></AdminGuarded>
      </Route>
      <Route path="/app/servers/:id">
        <AdminGuarded><ServerDetail /></AdminGuarded>
      </Route>
      <Route path="/app/clients">
        <AdminGuarded><ClientsList /></AdminGuarded>
      </Route>

      {/* Bare /app — bounce to portal */}
      <Route path="/app">
        <RequireAuth>
          <PortalAfterAuth />
        </RequireAuth>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to your SERVED. portal",
          },
        },
        signUp: {
          start: {
            title: "Create your SERVED. account",
            subtitle: "You'll pick a role on the next screen",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
