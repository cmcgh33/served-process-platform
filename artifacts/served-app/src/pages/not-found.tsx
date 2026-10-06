import { Link } from "wouter";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useSeo } from "@/lib/useSeo";

export default function NotFound() {
  useSeo({
    title: "Page not found — SERVED.",
    description: "The page you're looking for doesn't exist or has moved.",
    noindex: true,
  });
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center px-6 py-12 bg-brand-navy text-white">
      <div className="max-w-md w-full bg-brand-navy-deep rounded-2xl border border-amber-500/20 shadow-2xl p-8 space-y-6">
        <Link
          href="/"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-lg bg-amber-400 flex items-center justify-center flex-shrink-0">
            <ShieldAlert className="w-5 h-5 text-brand-navy" />
          </div>
          <div className="font-black text-base tracking-wider leading-none">
            SERVED.
          </div>
        </Link>

        <div className="space-y-2">
          <div className="text-[10px] font-bold tracking-widest uppercase text-amber-400">
            404 — Page not found
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            We couldn't find that page.
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            The link may be out of date, or the page may have moved. Head back
            to your portal and try again.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 w-full rounded-lg bg-amber-400 hover:bg-amber-300 text-brand-navy font-bold py-2.5 transition-colors"
          data-testid="link-not-found-home"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
