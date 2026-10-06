import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { RequesterSidebar } from "./requester-sidebar";

export function RequesterLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [location] = useLocation();

  // Close the drawer whenever the route changes so navigation feels normal.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex h-full">
        <RequesterSidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <button
            type="button"
            aria-label="Close menu"
            data-testid="button-requester-drawer-overlay"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative h-full">
            <RequesterSidebar />
            <button
              type="button"
              aria-label="Close menu"
              data-testid="button-requester-drawer-close"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto bg-brand-canvas">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 h-14 bg-[#0f1e3c] text-white">
          <button
            type="button"
            aria-label="Open menu"
            data-testid="button-requester-drawer-open"
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
            <div className="font-black text-sm tracking-wider leading-none">SERVED.</div>
          </div>
        </div>

        <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
