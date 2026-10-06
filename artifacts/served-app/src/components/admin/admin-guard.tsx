import type { ReactNode } from "react";
import { Show } from "@clerk/react";
import { Redirect } from "wouter";
import { useMe } from "@/lib/me";
import { ShieldAlert } from "lucide-react";

function AccessDenied({ userId }: { userId: string }) {
  return (
    <div className="min-h-[100dvh] bg-brand-navy flex items-center justify-center px-6 py-10 text-white">
      <div className="max-w-md w-full bg-brand-navy-deep rounded-2xl border border-amber-500/20 shadow-2xl p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
          </div>
          <h1 className="text-xl font-bold">Admin only</h1>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          This area is reserved for SERVED. operations staff. If you should
          have access, ask the owner to add the user ID below to the{" "}
          <code className="text-amber-400 font-mono text-xs bg-amber-500/10 px-1.5 py-0.5 rounded">
            ADMIN_USER_IDS
          </code>{" "}
          environment variable.
        </p>
        <div className="bg-brand-navy rounded-lg border border-slate-700 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Your user ID
          </div>
          <div className="font-mono text-xs text-amber-300 break-all select-all">
            {userId}
          </div>
        </div>
        <a
          href="/app"
          className="block text-center w-full rounded-lg bg-amber-400 hover:bg-amber-300 text-brand-navy font-bold py-2.5 transition-colors"
        >
          Back to my portal
        </a>
      </div>
    </div>
  );
}

/**
 * Wraps admin routes. Requires sign-in AND `isAdmin === true` from /me.
 * Non-admins see a friendly access-denied screen displaying their userId
 * for the owner to whitelist.
 */
export function AdminPortalGuard({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">
        <AdminGate>{children}</AdminGate>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function AdminGate({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-brand-navy text-amber-400 text-sm font-semibold animate-pulse">
        Verifying access…
      </div>
    );
  }
  if (!me.data) {
    return <Redirect to="/sign-in" />;
  }
  if (!me.data.isAdmin) {
    return <AccessDenied userId={me.data.id} />;
  }
  return <>{children}</>;
}
