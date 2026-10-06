import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { ServerSidebar } from "./server-sidebar";
import { ServerLocationBroadcaster } from "@/components/server/server-location-broadcaster";

export function ServerLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [location] = useLocation();
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerId = useId();

  // Close the drawer whenever the route changes so navigation feels normal.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location]);

  // If the user resizes from mobile to desktop while the drawer is open,
  // the desktop sidebar takes over and our drawer container becomes
  // `md:hidden`. Without this guard, `drawerOpen` stays true → the
  // body-scroll-lock effect below stays active and the page becomes
  // unscrollable on desktop with no visible way to close. Watch the
  // breakpoint and force-close above md.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const handle = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setDrawerOpen(false);
    };
    handle(mq);
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, []);

  // Lock body scroll while the mobile drawer is open so the page behind
  // doesn't ghost-scroll when servers swipe.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Keyboard: Escape closes the drawer. Move focus to the close
  // button on open so screen-reader users land inside the drawer
  // instead of being stranded behind the overlay; restore focus to
  // the hamburger trigger on close so keyboard users don't lose
  // their place.
  useEffect(() => {
    if (!drawerOpen) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Headless: auto-broadcasts GPS to any en_route / in_progress job
          assigned to this server. Replaces the old explicit "Share Location"
          button on the job card. */}
      <ServerLocationBroadcaster />

      {/* Desktop sidebar (>= md) */}
      <div className="hidden md:flex h-full">
        <ServerSidebar />
      </div>

      {/* Mobile drawer (< md). Process servers work this portal on a
          phone in the field, so the sidebar has to collapse off-screen
          and slide in over a backdrop instead of permanently eating
          256px of viewport. */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Server portal navigation"
          id={drawerId}
        >
          <button
            type="button"
            aria-label="Close menu"
            data-testid="button-server-drawer-overlay"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative h-full">
            <ServerSidebar />
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close menu"
              data-testid="button-server-drawer-close"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto bg-brand-canvas">
        {/* Mobile top bar — only renders below md, gives servers a
            persistent hamburger and brand mark while on the road. */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 bg-[#0f1e3c] text-white">
          <button
            ref={openButtonRef}
            type="button"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            data-testid="button-server-drawer-open"
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-md hover:bg-white/10"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-amber-400 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 34 34" fill="none">
                <rect x="4" y="4" width="18" height="22" rx="2" fill="white" fillOpacity="0.9" />
                <path d="M8 11h10M8 15h10M8 19h6" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="25" cy="25" r="7" fill="#0f1e3c" />
                <path d="M22 25l2 2 4-4" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="font-black text-sm tracking-wider leading-none">
              SERVED.
            </div>
            <span
              className="text-[9px] font-bold tracking-widest uppercase leading-none ml-1"
              style={{ color: "var(--color-brand-emerald-bright)" }}
            >
              Server
            </span>
          </div>
        </div>

        {/* Tighter padding on phones, original p-8 restored at md+. */}
        <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
