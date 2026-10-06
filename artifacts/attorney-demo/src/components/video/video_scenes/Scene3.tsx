import { motion } from 'framer-motion';
import { useScenePhase } from '../timing';

export function Scene3() {
  // Phase boundaries aligned to the VO: intro (~3s), Solo (~7s),
  // Firm/most-popular (~9s), Firm Pro (~7s) — total ~26.7s scene.
  const phase = useScenePhase([500, 3000, 10000, 19000]);

  type Tier = {
    name: string;
    monthly: string;
    rates: { label: string; price: string; strike: string }[];
    showPublicStrike: boolean;
  };
  const renderRates = (rates: Tier["rates"], onDark: boolean) => (
    <div className="grid grid-cols-3 gap-2 mt-3">
      {rates.map((r) => (
        <div key={r.label} className="text-center">
          <div className={`text-2xl font-display font-black ${onDark ? "text-white" : "text-accent"}`}>{r.price}</div>
          <div className={`text-[10px] font-bold tracking-wider uppercase ${onDark ? "text-white/80" : "text-primary/70"}`}>{r.label}</div>
          {r.strike && (
            <div className={`text-[10px] line-through ${onDark ? "text-white/40" : "text-primary/40"}`}>{r.strike}</div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center pt-12 pb-24"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.h2 
        className="text-[4vw] font-display font-bold text-primary mb-12 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
      >
        Pricing is <span className="text-secondary">transparent.</span><br />
        No surprise fees.
      </motion.h2>

      <div className="flex gap-6 items-stretch justify-center w-full max-w-6xl px-12">
        {/* Solo */}
        <motion.div
          className="w-1/3 bg-card rounded-2xl border border-border p-6 shadow-xl relative"
          initial={{ opacity: 0, y: 80 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 80 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <div className="text-xs font-bold tracking-[0.2em] text-primary/60 mb-2">SOLO</div>
          <div className="text-4xl font-display font-black text-primary mb-4">$99<span className="text-base font-normal text-primary/50">/mo</span></div>
          {renderRates(
            [
              { label: "Standard", price: "$65", strike: "$75 public" },
              { label: "Rush", price: "$85", strike: "$95 public" },
              { label: "Licensed", price: "$120", strike: "" },
            ],
            false,
          )}
        </motion.div>

        {/* Firm — Most Popular */}
        <motion.div
          className="w-1/3 bg-primary rounded-2xl p-6 shadow-2xl relative z-10 -translate-y-3"
          initial={{ opacity: 0, y: 80 }}
          animate={phase >= 3 ? { opacity: 1, y: -12 } : { opacity: 0, y: 80 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-primary text-[11px] font-bold px-3 py-1 rounded-full whitespace-nowrap shadow-md">
            ★ MOST POPULAR
          </div>
          <div className="text-xs font-bold tracking-[0.2em] text-white/70 mb-2">FIRM</div>
          <div className="text-4xl font-display font-black text-white mb-4">$199<span className="text-base font-normal text-white/50">/mo</span></div>
          {renderRates(
            [
              { label: "Standard", price: "$60", strike: "$75 public" },
              { label: "Rush", price: "$79", strike: "$95 public" },
              { label: "Licensed", price: "$120", strike: "" },
            ],
            true,
          )}
        </motion.div>

        {/* Firm Pro */}
        <motion.div
          className="w-1/3 bg-card rounded-2xl border border-border p-6 shadow-xl relative"
          initial={{ opacity: 0, y: 80 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 80 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <div className="text-xs font-bold tracking-[0.2em] text-primary/60 mb-2">FIRM PRO</div>
          <div className="text-4xl font-display font-black text-primary mb-4">$299<span className="text-base font-normal text-primary/50">/mo</span></div>
          {renderRates(
            [
              { label: "Standard", price: "$55", strike: "$75 public" },
              { label: "Rush", price: "$72", strike: "$95 public" },
              { label: "Licensed", price: "$120", strike: "" },
            ],
            false,
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}