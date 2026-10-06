import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Grid3x3,
  X,
  ArrowRight,
} from "lucide-react";
import { TOUR_SLIDES, TOUR_THEMES, type TourRole } from "@/data/tours";
import { TourVisual } from "@/components/demo/tour-visuals";
import { useSeo } from "@/lib/useSeo";

const VALID_ROLES: TourRole[] = ["requester", "attorney", "server"];

function isValidRole(value: string | undefined): value is TourRole {
  return !!value && (VALID_ROLES as string[]).includes(value);
}

const TOUR_SEO: Record<TourRole, { title: string; description: string }> = {
  requester: {
    title:
      "For Individuals — SERVED. Process Servers in Las Vegas, NV",
    description:
      "Need someone served in Las Vegas? Post a job in minutes, track your server live, and download a court-ready NRS 53.045 affidavit the moment service is complete.",
  },
  attorney: {
    title:
      "For Attorneys & Law Firms — SERVED. Process Serving Platform (Las Vegas)",
    description:
      "ProServe subscription tiers, bulk dispatch, cloud vault, and ABC Legal cost comparison for Nevada attorneys. NV PILB-licensed servers across Clark County.",
  },
  server: {
    title:
      "For Process Servers — Earn with SERVED. (Las Vegas, NV)",
    description:
      "Las Vegas process servers: claim jobs from a live feed, log GPS-verified attempts, and get paid weekly via Stripe Connect. NV PILB-licensed servers welcome.",
  },
};

export default function TourPage() {
  const [, params] = useRoute<{ role: string }>("/demo/:role");
  const [, navigate] = useLocation();
  const role = isValidRole(params?.role) ? params!.role : null;
  const seo = role ? TOUR_SEO[role] : null;
  useSeo({
    title:
      seo?.title ?? "Product Demo — SERVED. Process Serving Platform",
    description:
      seo?.description ??
      "Walk through the SERVED. process serving workflow — GPS-tracked attempts, NRS 53.045-compliant affidavits, and instant payouts.",
    path: role ? `/demo/${role}` : "/demo",
  });

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const theme = role ? TOUR_THEMES[role] : null;
  const slides = useMemo(() => (role ? TOUR_SLIDES[role] : []), [role]);
  const slide = slides[index];

  // Reset when role changes
  useEffect(() => {
    setIndex(0);
    setPaused(false);
    setProgress(0);
    startRef.current = null;
  }, [role]);

  // Auto-advance with progress bar
  useEffect(() => {
    if (!slide) return;
    if (paused) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    const duration = slide.durationMs ?? 7000;
    startRef.current = performance.now() - progress * duration;

    const tick = (now: number) => {
      if (startRef.current === null) return;
      const elapsed = now - startRef.current;
      const ratio = Math.min(1, elapsed / duration);
      setProgress(ratio);
      if (ratio >= 1) {
        if (index < slides.length - 1) {
          setIndex((i) => i + 1);
          setProgress(0);
          startRef.current = null;
        } else {
          setPaused(true);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, slide]);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "ArrowRight") {
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key === "Escape") {
        navigate("/demo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, slides.length]);

  if (!role || !theme || !slide) {
    return (
      <div className="min-h-screen bg-brand-navy text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold mb-3">Tour not found</div>
          <Link href="/demo" className="text-amber-500 hover:underline" data-testid="link-back-demo">
            Back to tour selector
          </Link>
        </div>
      </div>
    );
  }

  function next() {
    setProgress(0);
    startRef.current = null;
    setIndex((i) => Math.min(slides.length - 1, i + 1));
  }
  function prev() {
    setProgress(0);
    startRef.current = null;
    setIndex((i) => Math.max(0, i - 1));
  }
  function restart() {
    setProgress(0);
    startRef.current = null;
    setIndex(0);
    setPaused(false);
  }

  const isLast = index === slides.length - 1;

  return (
    <div className="min-h-screen bg-brand-navy text-white relative overflow-hidden">
      {/* Ambient backdrop */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 30% 20%, ${theme.accent}26, transparent 50%), radial-gradient(circle at 70% 80%, ${theme.accent}1f, transparent 50%)`,
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 px-6 pt-6 flex items-center justify-between">
        <Link href="/demo" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition" data-testid="link-tour-switch">
          <Grid3x3 size={16} />
          Switch tour
        </Link>
        <div className="flex items-center gap-2">
          <div
            className="hidden sm:block px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold"
            style={{ background: theme.accentBg, color: theme.accent, border: `1px solid ${theme.accentSoft}` }}
          >
            {theme.label}
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition hover:opacity-90"
            style={{ background: theme.accent, color: "var(--color-brand-navy)" }}
            data-testid="link-tour-open-app"
          >
            Open the App
            <ArrowRight size={14} />
          </Link>
          <Link href="/" className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition" data-testid="link-tour-exit" title="Close tour">
            <X size={18} />
          </Link>
        </div>
      </div>

      {/* Progress dots */}
      <div className="relative z-10 px-6 mt-4 flex items-center gap-1.5">
        {slides.map((s, i) => (
          <button
            key={s.id}
            onClick={() => {
              setProgress(0);
              startRef.current = null;
              setIndex(i);
            }}
            className="flex-1 h-1 rounded-full overflow-hidden bg-white/10"
            data-testid={`button-progress-${i}`}
          >
            <motion.div
              className="h-full rounded-full"
              style={{
                background: theme.accent,
                width:
                  i < index ? "100%" : i === index ? `${progress * 100}%` : "0%",
              }}
              transition={{ duration: 0.1 }}
            />
          </button>
        ))}
      </div>

      {/* Stage */}
      <div className="relative z-10 max-w-6xl mx-auto px-6 mt-8 grid md:grid-cols-2 gap-8 items-center" style={{ minHeight: 540 }}>
        {/* Left: copy */}
        <div className="order-2 md:order-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <div
                className="text-xs uppercase tracking-widest font-bold mb-3"
                style={{ color: theme.accent }}
              >
                {slide.eyebrow}
              </div>
              <h2 className="text-3xl md:text-5xl font-black tracking-tight leading-[1.05]">
                {slide.headline}
              </h2>
              <p className="text-slate-300 text-base md:text-lg mt-4 leading-relaxed max-w-md">
                {slide.body}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right: visual */}
        <div className="order-1 md:order-2 flex items-center justify-center min-h-[480px]">
          <AnimatePresence mode="wait">
            <TourVisual key={slide.id} visual={slide.visual} role={role} theme={theme} />
          </AnimatePresence>
        </div>
      </div>

      {/* Controls */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20">
        <div
          className="flex items-center gap-1 rounded-full px-2 py-2 backdrop-blur-md"
          style={{
            background: "rgba(10,21,48,0.85)",
            border: `1px solid ${theme.accentSoft}`,
            boxShadow: `0 20px 50px ${theme.accent}33`,
          }}
        >
          <button
            onClick={prev}
            disabled={index === 0}
            className="p-2.5 rounded-full hover:bg-white/5 disabled:opacity-30 transition"
            data-testid="button-tour-prev"
          >
            <ChevronLeft size={18} />
          </button>
          {isLast && progress >= 1 ? (
            <>
              <button
                onClick={restart}
                className="px-3 py-2 rounded-full font-bold text-sm flex items-center gap-1.5 hover:bg-white/5 transition"
                style={{ color: theme.accent }}
                data-testid="button-tour-restart"
              >
                <RotateCcw size={14} /> Replay
              </button>
              <Link
                href="/"
                className="px-4 py-2 rounded-full font-bold text-sm flex items-center gap-1.5 hover:opacity-90 transition"
                style={{ background: theme.accent, color: "#0f1e3c" }}
                data-testid="button-tour-open-app-end"
              >
                Open the App
                <ArrowRight size={14} />
              </Link>
            </>
          ) : (
            <button
              onClick={() => setPaused((p) => !p)}
              className="px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2"
              style={{ background: theme.accent, color: "#0f1e3c" }}
              data-testid="button-tour-playpause"
            >
              {paused ? <Play size={14} fill="#0f1e3c" /> : <Pause size={14} />}
              {paused ? "Play" : "Pause"}
            </button>
          )}
          <button
            onClick={next}
            disabled={index === slides.length - 1}
            className="p-2.5 rounded-full hover:bg-white/5 disabled:opacity-30 transition"
            data-testid="button-tour-next"
          >
            <ChevronRight size={18} />
          </button>
          <div className="w-px h-6 bg-white/10 mx-1" />
          <button
            onClick={restart}
            className="p-2.5 rounded-full hover:bg-white/5 transition"
            title="Restart"
            data-testid="button-tour-restart-icon"
          >
            <RotateCcw size={16} />
          </button>
          <Link
            href="/demo"
            className="p-2.5 rounded-full hover:bg-white/5 transition"
            title="Switch tour"
            data-testid="button-tour-switch-icon"
          >
            <Grid3x3 size={16} />
          </Link>
        </div>
        <div className="text-center text-[10px] text-slate-500 mt-2">
          Space · Pause / Play · ← → Navigate · Esc · Switch
        </div>
      </div>
    </div>
  );
}
