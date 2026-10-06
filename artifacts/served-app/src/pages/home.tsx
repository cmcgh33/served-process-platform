import { Link } from "wouter";
import { Show, useUser } from "@clerk/react";
import { useSeo } from "@/lib/useSeo";
import {
  User,
  Scale,
  Zap,
  ShieldCheck,
  ChevronRight,
  MapPin,
  Play,
  ArrowRight,
  TrendingDown,
  CheckCircle2,
  FileCheck,
  Wallet,
} from "lucide-react";


const roles = [
  {
    id: "requester" as const,
    label: "INDIVIDUAL",
    title: "I Need Someone Served",
    description:
      "Post a job in minutes. Track your server live. Get a court-ready affidavit emailed the moment service is complete.",
    icon: User,
    accent: "var(--color-brand-amber)",
    accentBg: "rgba(245,158,11,0.12)",
    accentBorder: "rgba(245,158,11,0.3)",
    features: [
      "Family court, eviction, small claims",
      "Real-time GPS tracking",
      "Affidavit download on completion",
    ],
    badge: "Individual",
    demoHref: "/demo/requester",
    signInHref: "/sign-in/individual",
  },
  {
    id: "attorney" as const,
    label: "PROSERVE",
    title: "I'm an Attorney",
    description:
      "Law firm tools — case management, cloud archive, bulk dispatch, and ProServe subscription tiers that beat ABC Legal pricing.",
    icon: Scale,
    accent: "var(--color-brand-sky)",
    accentBg: "rgba(56,189,248,0.12)",
    accentBorder: "rgba(56,189,248,0.3)",
    features: [
      "Case number + matter tracking",
      "Cloud archive — search by client / case",
      "ProServe tiers from $99/mo",
    ],
    badge: "Attorney",
    demoHref: "/demo/attorney",
    signInHref: "/sign-in/attorney",
  },
  {
    id: "server" as const,
    label: "SERVER",
    title: "I'm a Process Server",
    description:
      "Accept jobs from a live feed. Navigate with built-in routing. Keep 80% and cash out instantly via Stripe.",
    icon: Zap,
    accent: "var(--color-brand-emerald)",
    accentBg: "rgba(52,211,153,0.12)",
    accentBorder: "rgba(52,211,153,0.3)",
    features: [
      "Live job feed with GPS routing",
      "Instant Cash-Out (Stripe)",
      "Career pipeline — Standard → Licensed",
    ],
    badge: "Server",
    demoHref: "/demo/server",
    signInHref: "/sign-in/server",
  },
];

const valueProps = [
  {
    icon: TrendingDown,
    title: "Attorneys pay less",
    body: "ProServe tiers bring per-serve rates as low as $55. ABC Legal averages $85+.",
  },
  {
    icon: Wallet,
    title: "Servers earn more",
    body: "Keep 80% of every serve, get paid via Stripe direct deposit in two days.",
  },
  {
    icon: MapPin,
    title: "GPS-verified service",
    body: "Every serve is timestamped, geofenced, and photographed — no more guessing.",
  },
  {
    icon: FileCheck,
    title: "Court-ready affidavits",
    body: "Notarized affidavits generated automatically and emailed the moment service completes.",
  },
];

function PortalRedirectAfterSignIn() {
  const { user } = useUser();
  const role = user?.publicMetadata?.role as string | undefined;
  const target =
    role === "requester"
      ? "/app/requester/dashboard"
      : role === "attorney"
      ? "/app/attorney/dashboard"
      : role === "server"
      ? "/app/server/dashboard"
      : "/app/role-chooser";
  return (
    <Link
      href={target}
      className="px-4 py-2 rounded-lg font-bold text-sm text-brand-navy bg-amber-400 hover:bg-amber-300 transition flex items-center gap-1.5"
      data-testid="link-go-to-portal"
    >
      Go to your portal
      <ArrowRight className="w-4 h-4" />
    </Link>
  );
}

export default function Home() {
  useSeo({
    title:
      "SERVED. — Licensed Process Servers in Las Vegas & Nevada | Subpoenas, Summons, Civil Litigation",
    description:
      "NV PILB-licensed process servers covering Las Vegas, Henderson, North Las Vegas, and Clark County. Same-day service, GPS-verified affidavits, NRS 53.045 compliant. Subpoenas, summons, evictions, family court.",
    path: "/",
  });
  return (
    <div className="min-h-screen flex flex-col bg-brand-navy">
      {/* Subtle "S" watermark */}
      <div
        className="fixed top-0 right-0 select-none pointer-events-none"
        style={{
          fontSize: "40vw",
          fontWeight: 900,
          color: "rgba(255,255,255,0.03)",
          lineHeight: 1,
          letterSpacing: "-0.05em",
          userSelect: "none",
        }}
        aria-hidden
      >
        S
      </div>

      {/* Top nav */}
      <header className="relative z-20 px-6 py-4 flex items-center justify-between max-w-6xl w-full mx-auto">
        <Link href="/" className="flex items-center gap-2.5 group" data-testid="link-home-logo">
          <div className="w-9 h-9 rounded-lg bg-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <svg width="22" height="22" viewBox="0 0 34 34" fill="none">
              <rect x="4" y="4" width="18" height="22" rx="2" fill="white" fillOpacity="0.95" />
              <path d="M8 11h10M8 15h10M8 19h6" stroke="var(--color-brand-amber)" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="25" cy="25" r="7" fill="var(--color-brand-navy)" />
              <path d="M22 25l2 2 4-4" stroke="var(--color-brand-emerald)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-black text-white tracking-tight text-lg">SERVED.</span>
        </Link>

        <nav className="flex items-center gap-3">
          <Link
            href="/demo"
            className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-white/70 hover:text-white px-3 py-2 rounded-lg transition"
            data-testid="link-nav-demo"
          >
            <Play className="w-3.5 h-3.5" />
            Watch the demo
          </Link>
          <Show when="signed-out">
            <Link
              href="/sign-in"
              className="text-sm font-semibold text-white/70 hover:text-white px-3 py-2 rounded-lg transition"
              data-testid="link-nav-sign-in"
            >
              Log in
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-2 rounded-lg font-bold text-sm text-brand-navy bg-amber-400 hover:bg-amber-300 transition"
              data-testid="link-nav-sign-up"
            >
              Sign up
            </Link>
          </Show>
          <Show when="signed-in">
            <PortalRedirectAfterSignIn />
          </Show>
        </nav>
      </header>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center px-6 pt-10 pb-12 relative z-10 max-w-6xl mx-auto w-full">
        {/* Pill */}
        <div
          className="mb-6 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-widest uppercase"
          style={{
            color: "var(--color-brand-amber)",
            border: "1px solid rgba(245,158,11,0.4)",
            background: "rgba(245,158,11,0.08)",
          }}
          data-testid="text-hero-pill"
        >
          On-demand legal process serving
        </div>

        <h1
          className="font-black text-center leading-none mb-4"
          style={{
            fontSize: "clamp(3rem, 8vw, 5.5rem)",
            letterSpacing: "-0.02em",
            color: "var(--color-brand-amber)",
          }}
          data-testid="text-hero-headline"
        >
          SERVED.
        </h1>

        <p
          className="text-center font-bold mb-3"
          style={{ fontSize: "clamp(1.1rem, 3vw, 1.5rem)", letterSpacing: "-0.01em" }}
        >
          <span style={{ color: "var(--color-brand-amber)" }}>Trust</span>
          <span className="text-white"> the Process.</span>
        </p>

        <p
          className="text-center text-base sm:text-lg mb-8 max-w-2xl"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          Post a serve, watch it happen on a live map, and get a court-ready affidavit
          emailed the second it's done. Built for individuals, attorneys, and the process
          servers in between.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-14">
          <Link
            href="/sign-up"
            className="px-5 py-3 rounded-xl font-bold text-sm text-brand-navy bg-amber-400 hover:bg-amber-300 transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
            data-testid="button-hero-sign-up"
          >
            Get started — free to sign up
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/demo"
            className="px-5 py-3 rounded-xl font-bold text-sm text-white border border-white/20 hover:bg-white/5 transition flex items-center gap-2"
            data-testid="button-hero-demo"
          >
            <Play className="w-4 h-4" />
            Watch the 50-second tour
          </Link>
        </div>

        {/* Role cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-5xl mb-20">
          {roles.map((role) => {
            const Icon = role.icon;
            return (
              <div
                key={role.id}
                className="rounded-2xl p-6 flex flex-col gap-4 transition-all hover:-translate-y-0.5"
                style={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  border: `1px solid ${role.accentBorder}`,
                }}
                data-testid={`card-role-${role.id}`}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: role.accentBg }}
                >
                  <Icon className="w-5 h-5" style={{ color: role.accent }} />
                </div>

                <div>
                  <p
                    className="text-[10px] font-black tracking-widest uppercase mb-1"
                    style={{ color: role.accent }}
                  >
                    {role.label}
                  </p>
                  <h2 className="text-white font-bold text-lg leading-tight">
                    {role.title}
                  </h2>
                </div>

                <p
                  style={{ color: "rgba(255,255,255,0.5)" }}
                  className="text-sm leading-relaxed"
                >
                  {role.description}
                </p>

                <ul className="flex flex-col gap-2 flex-1">
                  {role.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-2 text-sm"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      <CheckCircle2
                        className="w-4 h-4 mt-0.5 flex-shrink-0"
                        style={{ color: role.accent }}
                      />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-2 mt-2">
                  <Link
                    href={`/sign-up?intent=${role.id}`}
                    className="flex items-center justify-between w-full px-4 py-3 rounded-xl font-bold text-sm transition-all"
                    style={{
                      backgroundColor: role.accent,
                      color: "var(--color-brand-navy)",
                    }}
                    data-testid={`button-signup-${role.id}`}
                  >
                    <span>Sign up as {role.badge}</span>
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                  <Link
                    href={role.signInHref}
                    className="text-center text-xs font-semibold py-1.5 transition-colors"
                    style={{ color: "rgba(255,255,255,0.55)" }}
                    data-testid={`link-signin-${role.id}`}
                  >
                    Already have an account?{" "}
                    <span style={{ color: role.accent }}>Log in →</span>
                  </Link>
                  <Link
                    href={role.demoHref}
                    className="flex items-center justify-between w-full px-4 py-2.5 rounded-xl font-semibold text-xs transition-all"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.03)",
                      border: `1px solid ${role.accentBorder}`,
                      color: role.accent,
                    }}
                    data-testid={`button-demo-${role.id}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Play className="w-3 h-3" />
                      See the {role.badge.toLowerCase()} tour
                    </span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* Value props */}
        <div className="w-full max-w-5xl">
          <div className="text-center mb-8">
            <p
              className="text-[10px] font-black tracking-widest uppercase mb-3"
              style={{ color: "var(--color-brand-amber)" }}
            >
              Why SERVED.
            </p>
            <h2
              className="font-black text-white"
              style={{ fontSize: "clamp(1.6rem, 4vw, 2.4rem)", letterSpacing: "-0.02em" }}
            >
              A marketplace built for the people who actually do the serving.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {valueProps.map((v) => {
              const Icon = v.icon;
              return (
                <div
                  key={v.title}
                  className="rounded-2xl p-5"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                    style={{ background: "rgba(245,158,11,0.12)" }}
                  >
                    <Icon className="w-4 h-4" style={{ color: "var(--color-brand-amber)" }} />
                  </div>
                  <div className="text-white font-bold text-sm mb-1.5">{v.title}</div>
                  <div className="text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                    {v.body}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Areas We Serve — local SEO landing block */}
      <section
        className="relative z-10 py-12 px-6"
        style={{ borderTopColor: "rgba(255,255,255,0.07)", borderTopWidth: 1 }}
        aria-labelledby="areas-served-heading"
      >
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4" style={{ color: "var(--color-brand-amber)" }} />
            <span
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: "var(--color-brand-amber)" }}
            >
              Nevada Coverage
            </span>
          </div>
          <h2
            id="areas-served-heading"
            className="font-black text-white mb-3"
            style={{ fontSize: "clamp(1.4rem, 3.5vw, 2rem)", letterSpacing: "-0.02em" }}
          >
            Process serving across Las Vegas &amp; the State of Nevada
          </h2>
          <p
            className="text-sm leading-relaxed mb-6 max-w-3xl"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            SERVED. dispatches NV PILB-licensed process servers across Clark County and the
            rest of the state. Same-day attempts in the Las Vegas valley, GPS-verified
            evidence on every visit, and an NRS 53.045-compliant affidavit emailed the
            moment service is complete.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {[
              "Las Vegas",
              "Henderson",
              "North Las Vegas",
              "Summerlin",
              "Spring Valley",
              "Paradise",
              "Sunrise Manor",
              "Enterprise",
              "Boulder City",
              "Mesquite",
              "Pahrump",
              "Reno",
              "Sparks",
              "Carson City",
              "Elko",
              "Statewide Nevada",
            ].map((city) => (
              <div
                key={city}
                className="rounded-lg px-3 py-2 text-xs text-white/70"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {city}
              </div>
            ))}
          </div>
          <p
            className="text-xs mt-5 max-w-3xl"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            Common service types: subpoenas, summons &amp; complaint, eviction notices,
            family-court documents, small claims, civil litigation, and service by
            publication under NRS 14.040. Need a server in a city not listed? Post a job —
            our network covers the entire state.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="relative z-10 py-6 px-6"
        style={{ borderTopColor: "rgba(255,255,255,0.07)", borderTopWidth: 1 }}
      >
        <div
          className="max-w-6xl mx-auto flex flex-col items-center gap-3 text-xs"
          style={{ color: "rgba(255,255,255,0.45)" }}
        >
          <address
            className="flex items-center justify-center gap-4 flex-wrap not-italic"
          >
            <a
              href="tel:+17756553933"
              className="flex items-center gap-1.5 hover:text-white transition"
              data-testid="link-footer-phone"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              (775) 655-3933
            </a>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              732 S 6th St #6750, Las Vegas, NV 89101
            </span>
          </address>
          <div
            className="flex items-center justify-center gap-4 flex-wrap"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              GPS-verified service
            </span>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Instant Cash-Out
            </span>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
            <span>© 2026 SERVED. · servedapp.co</span>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
            <Link
              href="/nevada-process-serving-faq"
              className="hover:text-white/60 transition-colors"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              Nevada FAQ
            </Link>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
            <Link
              href="/privacy"
              className="hover:text-white/60 transition-colors"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              Privacy
            </Link>
            <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
            <Link
              href="/terms"
              className="hover:text-white/60 transition-colors"
              style={{ color: "rgba(255,255,255,0.3)" }}
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
