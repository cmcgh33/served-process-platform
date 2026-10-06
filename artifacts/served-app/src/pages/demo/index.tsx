import { Link } from "wouter";
import { motion } from "framer-motion";
import { User, Building2, Zap, ArrowRight, Play } from "lucide-react";
import { TOUR_THEMES, type TourRole } from "@/data/tours";
import { useSeo } from "@/lib/useSeo";

const ROLES: {
  id: TourRole;
  name: string;
  icon: typeof User;
  description: string;
  priceLabel: string;
  priceDetail: string;
}[] = [
  {
    id: "requester",
    name: "Individual",
    icon: User,
    description:
      "For anyone who needs someone served — family court, eviction, small claims, subpoenas.",
    priceLabel: "$75 per serve",
    priceDetail: "Pay once. No subscription.",
  },
  {
    id: "attorney",
    name: "Attorney / Law Firm",
    icon: Building2,
    description:
      "ProServe subscription tiers, bulk dispatch, cloud vault, and ABC Legal cost comparison.",
    priceLabel: "From $99/mo",
    priceDetail: "Solo · Firm · Firm Pro",
  },
  {
    id: "server",
    name: "Process Server",
    icon: Zap,
    description:
      "How servers find jobs, claim them, capture evidence, and get paid 80% of every serve.",
    priceLabel: "Keep 80%",
    priceDetail: "Direct deposit in 2 days.",
  },
];

export default function DemoIndex() {
  useSeo({
    title:
      "Product Demo — SERVED. Process Serving Platform (Las Vegas, NV)",
    description:
      "See how SERVED. works for individuals, attorneys, and process servers in Las Vegas and across Nevada. Watch role-specific tours of the GPS-tracked, NRS 53.045-compliant workflow.",
    path: "/demo",
  });
  return (
    <div className="min-h-screen bg-brand-navy text-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <Link href="/" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition" data-testid="link-demo-home">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm bg-amber-500 text-brand-navy">
              S.
            </div>
            <span className="font-bold">SERVED.</span>
          </Link>
          <div className="text-[10px] uppercase tracking-widest text-slate-500">
            Live walkthrough
          </div>
        </div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-14"
        >
          <div className="text-xs uppercase tracking-widest text-amber-500 font-bold mb-3">
            Pick your perspective
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight">
            See SERVED. in <span className="text-amber-500">action.</span>
          </h1>
          <p className="text-slate-400 mt-4 text-lg max-w-2xl mx-auto">
            A guided tour of the platform from any side of the marketplace. Pick the
            perspective that matches who you're showing it to.
          </p>
        </motion.div>

        {/* Role cards */}
        <div className="grid md:grid-cols-3 gap-5">
          {ROLES.map((role, i) => {
            const theme = TOUR_THEMES[role.id];
            const Icon = role.icon;
            return (
              <motion.div
                key={role.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.1 }}
              >
                <Link
                  href={`/demo/${role.id}`}
                  className="group block"
                  data-testid={`link-tour-${role.id}`}
                >
                  <div
                    className="relative rounded-2xl p-6 h-full transition-all hover:-translate-y-1"
                    style={{
                      background: theme.accentBg,
                      border: `1px solid ${theme.accentSoft}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-5">
                      <div
                        className="w-14 h-14 rounded-xl flex items-center justify-center"
                        style={{ background: theme.accent + "30", border: `1px solid ${theme.accent}` }}
                      >
                        <Icon size={28} style={{ color: theme.accent }} />
                      </div>
                      <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: theme.accent }}>
                        {theme.label}
                      </div>
                    </div>

                    <div className="text-2xl font-black tracking-tight mb-2">
                      {role.name}
                    </div>
                    <div className="text-slate-400 text-sm leading-relaxed">
                      {role.description}
                    </div>

                    <div
                      className="mt-5 rounded-lg px-3.5 py-2.5 flex items-baseline justify-between"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${theme.accentSoft}`,
                      }}
                      data-testid={`pricing-${role.id}`}
                    >
                      <div className="font-black text-base" style={{ color: theme.accent }}>
                        {role.priceLabel}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {role.priceDetail}
                      </div>
                    </div>

                    <div
                      className="mt-3 flex items-center justify-between rounded-lg px-4 py-2.5 transition-colors group-hover:opacity-100"
                      style={{ background: theme.accent, color: "#0f1e3c" }}
                    >
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <Play size={14} fill="#0f1e3c" />
                        Start tour
                      </div>
                      <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </div>

                    <div className="mt-4 flex items-center justify-between text-[10px] text-slate-500">
                      <span>~50 seconds</span>
                      <span>Auto-plays · pause anytime</span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-16 text-center text-xs text-slate-500">
          servedapp.co · SERVED. · Las Vegas, NV
        </div>
      </div>
    </div>
  );
}
