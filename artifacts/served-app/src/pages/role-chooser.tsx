import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { User, Scale, Zap, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { useMe, useSetRole, type MeResponse, type UserRole } from "@/lib/me";
import { cn } from "@/lib/utils";

interface RoleChoice {
  id: UserRole;
  label: string;
  title: string;
  description: string;
  icon: typeof User;
  accent: string;
  accentBg: string;
  accentBorder: string;
  dashboard: string;
}

const ALL_CHOICES: RoleChoice[] = [
  {
    id: "requester",
    label: "INDIVIDUAL",
    title: "I need someone served",
    description:
      "Family court, eviction, small claims, or any other personal serve. Pay-as-you-go.",
    icon: User,
    accent: "var(--color-brand-amber)",
    accentBg: "rgba(245,158,11,0.12)",
    accentBorder: "rgba(245,158,11,0.3)",
    dashboard: "/app/requester/dashboard",
  },
  {
    id: "attorney",
    label: "ATTORNEY",
    title: "I'm an attorney or law firm",
    description:
      "Case-tracked serves, cloud archive, and ProServe subscription tiers from $99/mo.",
    icon: Scale,
    accent: "var(--color-brand-sky)",
    accentBg: "rgba(56,189,248,0.12)",
    accentBorder: "rgba(56,189,248,0.3)",
    dashboard: "/app/attorney/dashboard",
  },
  {
    id: "server",
    label: "SERVER",
    title: "I'm a process server",
    description:
      "Pick up jobs, capture proof, and keep 80% of every serve with instant cash-out.",
    icon: Zap,
    accent: "var(--color-brand-emerald)",
    accentBg: "rgba(52,211,153,0.12)",
    accentBorder: "rgba(52,211,153,0.3)",
    dashboard: "/app/server/dashboard",
  },
];

/**
 * Decide which role cards to show. A plain "I need someone served"
 * individual signup should NOT see Attorney or Server cards — they're a
 * different audience. We only surface a role if the user actually owns it.
 */
function visibleChoices(me: MeResponse | undefined): RoleChoice[] {
  if (!me) return ALL_CHOICES;
  return ALL_CHOICES.filter((c) => {
    if (c.id === "requester") return true; // anyone can need a serve
    if (c.id === "server") return me.hasServerProfile || me.role === "server";
    if (c.id === "attorney") return me.role === "attorney"; // no separate attorney table yet
    return false;
  });
}

function readUrlParams() {
  if (typeof window === "undefined") {
    return { preselect: null as UserRole | null, isSwitching: false };
  }
  const params = new URLSearchParams(window.location.search);
  const preselectRaw = params.get("preselect");
  const preselect: UserRole | null =
    preselectRaw === "requester" || preselectRaw === "attorney" || preselectRaw === "server"
      ? preselectRaw
      : null;
  return { preselect, isSwitching: params.get("switch") === "1" };
}

export default function RoleChooser() {
  const { user } = useUser();
  const me = useMe();
  const [, setLocation] = useLocation();
  const [pending, setPending] = useState<UserRole | null>(null);
  const setRole = useSetRole();
  const { preselect, isSwitching } = readUrlParams();
  const autoPickedRef = useRef(false);
  const choices = useMemo(() => visibleChoices(me.data), [me.data]);

  async function pick(role: UserRole, dashboard: string) {
    if (pending) return;
    setPending(role);
    try {
      await setRole.mutateAsync(role);
      // Refresh the Clerk session so publicMetadata.role is fresh on the client.
      await user?.reload?.();
      setLocation(dashboard);
    } catch (err) {
      console.error("Failed to set role", err);
      setPending(null);
    }
  }

  // Auto-pick the role when the user arrived from a "Sign up as <role>" home
  // card and they don't already have one. Skip when they're explicitly
  // switching roles — they should see the cards.
  useEffect(() => {
    if (autoPickedRef.current) return;
    if (isSwitching) return;
    if (!preselect) return;
    if (me.isLoading) return;
    if (me.data?.role) return;
    autoPickedRef.current = true;
    const dashboard = ALL_CHOICES.find((c) => c.id === preselect)?.dashboard;
    if (dashboard) void pick(preselect, dashboard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselect, isSwitching, me.isLoading, me.data?.role]);

  // While auto-picking from a preselect, show a friendly loader instead of
  // flashing the "pick a portal" cards.
  if (preselect && !isSwitching && !me.data?.role) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-amber-400 bg-brand-navy">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide">Setting up your portal…</p>
      </div>
    );
  }

  // Don't render any cards until we know who the user is — otherwise we'd
  // briefly show the unfiltered list (Attorney + Server) to a plain
  // individual signup before `me.data` arrives, and they could click into
  // a role they don't actually own.
  if (me.isLoading || !me.data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-amber-400 bg-brand-navy">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide">Loading your portals…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-12 bg-brand-navy">
      <div className="text-center max-w-2xl mb-10">
        <div
          className="inline-block mb-4 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-widest uppercase"
          style={{
            color: "var(--color-brand-amber)",
            border: "1px solid rgba(245,158,11,0.4)",
            background: "rgba(245,158,11,0.08)",
          }}
        >
          {isSwitching ? "Switch portals" : "Welcome to SERVED."}
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-3" data-testid="text-role-chooser-title">
          {isSwitching ? "Pick a different portal." : "Pick the portal that fits you."}
        </h1>
        <p className="text-base" style={{ color: "rgba(255,255,255,0.6)" }}>
          {isSwitching
            ? "Move between the Individual, Attorney, and Server portals at any time. Your jobs and history stay attached to your account."
            : "Choose the role that matches what you'll be doing on SERVED. We'll route you to the right dashboard."}
        </p>
        {isSwitching && me.data?.role ? (
          <p className="text-xs mt-3 font-semibold tracking-widest uppercase" style={{ color: "var(--color-brand-emerald)" }}>
            Currently in: {me.data.role}
          </p>
        ) : null}
      </div>

      {/* Suppress the "single portal" empty-state when an admin tile is
          about to render below — they DO have a second portal (admin),
          it's just not a stored UserRole. */}
      {isSwitching && choices.length <= 1 && !me.data?.isAdmin ? (
        <div
          className="w-full max-w-2xl rounded-2xl p-6 mb-6 text-sm"
          style={{
            backgroundColor: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.7)",
          }}
        >
          You only have access to one portal right now. To get added as a
          process server, contact support — we'll verify your license and
          attach a server profile to this account.
        </div>
      ) : null}

      <div
        className={cn(
          "grid grid-cols-1 gap-4 w-full max-w-5xl",
          // Admin tile occupies its own row below the role tiles, so the
          // 3-up grid stays the same regardless of admin status.
          choices.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2",
        )}
      >
        {choices.map((c) => {
          const Icon = c.icon;
          const isPending = pending === c.id;
          const isDisabled = pending !== null && pending !== c.id;
          return (
            <button
              key={c.id}
              onClick={() => pick(c.id, c.dashboard)}
              disabled={isDisabled}
              data-testid={`button-pick-role-${c.id}`}
              className="text-left rounded-2xl p-6 flex flex-col gap-4 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                border: `1px solid ${c.accentBorder}`,
              }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: c.accentBg }}
              >
                <Icon className="w-5 h-5" style={{ color: c.accent }} />
              </div>

              <div>
                <p className="text-[10px] font-black tracking-widest uppercase mb-1" style={{ color: c.accent }}>
                  {c.label}
                </p>
                <h2 className="text-white font-bold text-lg leading-tight">{c.title}</h2>
              </div>

              <p style={{ color: "rgba(255,255,255,0.55)" }} className="text-sm leading-relaxed flex-1">
                {c.description}
              </p>

              <div
                className="flex items-center justify-between mt-2 px-4 py-3 rounded-xl font-bold text-sm"
                style={{ backgroundColor: c.accent, color: "var(--color-brand-navy)" }}
              >
                <span>{isPending ? "Setting up…" : `Continue as ${c.label.toLowerCase()}`}</span>
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Admin Console tile — visible only when the API has confirmed
          this user is on the ADMIN_USER_IDS allowlist. Admin isn't a
          stored UserRole (it's an env-driven gate), so this tile
          navigates straight to /app/admin without mutating me.role.
          Rendered as a separate row so the role tiles above keep their
          original 3-up layout. */}
      {me.data?.isAdmin && (
        <div className="w-full max-w-5xl mt-4">
          <button
            onClick={() => {
              if (pending) return;
              setLocation("/app/admin");
            }}
            disabled={pending !== null}
            data-testid="button-pick-role-admin"
            className="w-full text-left rounded-2xl p-6 flex flex-col gap-4 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(245,158,11,0.4)",
            }}
          >
            <div className="flex items-start gap-4">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(245,158,11,0.12)" }}
              >
                <ShieldCheck
                  className="w-5 h-5"
                  style={{ color: "var(--color-brand-amber)" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[10px] font-black tracking-widest uppercase mb-1"
                  style={{ color: "var(--color-brand-amber)" }}
                >
                  Admin Console
                </p>
                <h2 className="text-white font-bold text-lg leading-tight">
                  SERVED. operations console
                </h2>
                <p
                  style={{ color: "rgba(255,255,255,0.55)" }}
                  className="text-sm leading-relaxed mt-2"
                >
                  Review jobs, manage servers, and audit the marketplace.
                  Restricted to staff on the admin allowlist.
                </p>
              </div>
              <div
                className="hidden md:flex items-center gap-2 px-4 py-3 rounded-xl font-bold text-sm flex-shrink-0"
                style={{
                  backgroundColor: "var(--color-brand-amber)",
                  color: "var(--color-brand-navy)",
                }}
              >
                <span>Open admin</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
            {/* Mobile-only stacked CTA so the tile still has a clear
                action affordance on small screens. */}
            <div
              className="md:hidden flex items-center justify-between px-4 py-3 rounded-xl font-bold text-sm"
              style={{
                backgroundColor: "var(--color-brand-amber)",
                color: "var(--color-brand-navy)",
              }}
            >
              <span>Open admin console</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}

      <p className="text-xs mt-10" style={{ color: "rgba(255,255,255,0.35)" }}>
        Need to change your role later? Contact support — role changes affect
        your billing and history.
      </p>
    </div>
  );
}
