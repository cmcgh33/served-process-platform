/**
 * Public attorney-demo watch page (`/demo/watch/:token`).
 *
 * Soft email-gate flow:
 *   1. On mount, look up the token via `getDemoInvite` (returns just
 *      `{ recipientName, validUntil, alreadyConfirmed }` — never the
 *      stored email).
 *   2. If `alreadyConfirmed`, render the iframe immediately.
 *   3. Otherwise show the email form. On submit we call
 *      `confirmDemoInvite` — the server compares the typed email
 *      case-insensitively against the stored value and, on match,
 *      stamps `viewed_at` and returns `{ ok: true }`. On mismatch we
 *      surface a generic "doesn't match" error without leaking the real
 *      address.
 */
import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetDemoInvite,
  useConfirmDemoInvite,
} from "@workspace/api-client-react";
import { Loader2, Mail, ShieldCheck, AlertTriangle } from "lucide-react";
import { useSeo } from "@/lib/useSeo";

export default function DemoWatchPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  // Private invite links — never index personalized URLs. Backed up by
  // a `Disallow: /demo/watch/` entry in robots.txt.
  useSeo({
    title: "Your SERVED. attorney demo",
    description:
      "Personal walkthrough of the SERVED. process serving platform.",
    noindex: true,
  });
  const lookup = useGetDemoInvite(token, {
    query: { enabled: !!token, queryKey: ["getDemoInvite", token] },
  });

  // Local state lets the user proceed to the iframe immediately on a
  // successful confirm without waiting for a refetch.
  const [unlocked, setUnlocked] = useState(false);

  if (!token) {
    return <ErrorShell title="Invalid link" message="This invite link is malformed." />;
  }

  if (lookup.isPending) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-brand-navy animate-spin" />
        </div>
      </Shell>
    );
  }

  if (lookup.isError) {
    return (
      <ErrorShell
        title="Invite not found"
        message="This demo link has expired or was revoked. Reach out to info@servedapp.co for a fresh one."
      />
    );
  }

  const invite = lookup.data!;
  const showVideo = unlocked || invite.alreadyConfirmed;

  return (
    <Shell>
      {showVideo ? (
        <VideoFrame />
      ) : (
        <EmailGate
          token={token}
          recipientName={invite.recipientName ?? null}
          onConfirmed={() => setUnlocked(true)}
        />
      )}
    </Shell>
  );
}

function VideoFrame() {
  return (
    <div className="space-y-3 -mx-6 sm:mx-0">
      <div className="aspect-video sm:rounded-2xl overflow-hidden border-y sm:border border-white/10 bg-black shadow-2xl">
        <iframe
          src="/attorney-demo/"
          title="SERVED. — The modern way Nevada attorneys handle process serving"
          className="w-full h-full"
          allow="autoplay"
        />
      </div>
      <p className="sm:hidden portrait:block landscape:hidden text-center text-[11px] text-white/60 px-6">
        Tip: rotate your phone sideways for the full-screen view.
      </p>
      <p className="text-center text-xs text-white/50">
        Want a closer look?{" "}
        <a
          href="https://calendly.com/servedapp-info/30min"
          className="text-amber-300 underline hover:text-amber-200"
        >
          Book a 30-minute walkthrough
        </a>
        {" "}or email{" "}
        <a
          href="mailto:info@servedapp.co"
          className="text-amber-300 underline hover:text-amber-200"
        >
          info@servedapp.co
        </a>
        .
      </p>
    </div>
  );
}

function EmailGate({
  token,
  recipientName,
  onConfirmed,
}: {
  token: string;
  recipientName: string | null;
  onConfirmed: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirmDemoInvite();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    try {
      await confirm.mutateAsync({ token, data: { email: email.trim() } });
      onConfirmed();
    } catch (err: any) {
      // confirmDemoInvite throws an Error with the API status — we don't
      // need to leak the stored email; surface a generic message.
      setError(
        "That email doesn't match this invitation. Try the address it was sent to.",
      );
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl shadow-2xl p-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex w-12 h-12 rounded-full bg-amber-100 items-center justify-center">
          <Mail className="w-6 h-6 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">
          {recipientName ? `Hi ${recipientName},` : "Welcome,"}
        </h1>
        <p className="text-sm text-gray-600">
          Confirm the email this invitation was sent to and we'll start the
          90-second walkthrough.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">
            Your email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            disabled={confirm.isPending}
            placeholder="you@firm.com"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:bg-gray-50"
            autoFocus
          />
        </div>
        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={confirm.isPending || !email.trim()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-navy text-white font-semibold text-sm hover:bg-brand-navy-deep disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {confirm.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying…
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              Watch the demo
            </>
          )}
        </button>
      </form>

      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        We never display the email on file — just match against what you type.
      </p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-brand-navy flex flex-col">
      <header className="px-6 py-5 border-b border-white/10">
        <div className="flex items-center gap-2 max-w-5xl mx-auto">
          <div className="w-7 h-7 rounded-lg bg-amber-400 flex items-center justify-center">
            <span className="text-brand-navy font-black text-xs">S.</span>
          </div>
          <span className="font-black tracking-wider text-white text-sm">
            SERVED.
          </span>
        </div>
      </header>
      <main className="flex-1 px-6 py-10 max-w-5xl mx-auto w-full">
        {children}
      </main>
      <footer className="px-6 py-4 text-center text-[11px] text-white/40">
        © {new Date().getFullYear()} SERVED. Built in Nevada.
      </footer>
    </div>
  );
}

function ErrorShell({ title, message }: { title: string; message: string }) {
  return (
    <Shell>
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-2xl p-8 text-center space-y-3">
        <div className="inline-flex w-12 h-12 rounded-full bg-red-100 items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </Shell>
  );
}
