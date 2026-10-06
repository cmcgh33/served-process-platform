import { motion } from 'framer-motion';
import { useScenePhase } from '../timing';

export function Scene2() {
  const phase = useScenePhase([500, 2000, 5000, 8000, 13000]);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center"
      initial={{ opacity: 0, x: '100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '-50%' }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="w-1/2 pl-24 pr-12 z-10">
        <motion.h2 
          className="text-[4vw] font-display font-bold text-primary leading-tight mb-6"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        >
          Posting a job takes<br />
          <span className="text-secondary">about a minute.</span>
        </motion.h2>
        
        <div className="space-y-6">
          {[
            "Add the recipient",
            "Choose documents (19 NV types)",
            "Choose handoff method"
          ].map((step, i) => (
            <motion.div 
              key={step}
              className="flex items-center gap-4 text-2xl text-primary/80"
              initial={{ opacity: 0, x: -20 }}
              animate={phase >= (i + 2) ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold">
                {i + 1}
              </div>
              {step}
            </motion.div>
          ))}
        </div>
      </div>
      
      <div className="w-1/2 h-full flex items-center justify-center pr-24 relative">
        <motion.div 
          className="w-full max-w-lg bg-card rounded-2xl shadow-2xl border border-border overflow-hidden"
          initial={{ opacity: 0, y: 100, rotateY: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0, rotateY: 0 } : { opacity: 0, y: 100, rotateY: 20 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          style={{ perspective: 1000 }}
        >
          <div className="h-12 border-b border-border bg-muted/30 flex items-center px-4 gap-2">
            <div className="w-3 h-3 rounded-full bg-destructive/50" />
            <div className="w-3 h-3 rounded-full bg-secondary/50" />
            <div className="w-3 h-3 rounded-full bg-success/50" />
          </div>
          <div className="p-7 space-y-5">
            {/* Recipient field */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: 0.4 }}
            >
              <div className="text-[11px] uppercase tracking-wider font-bold text-primary/50 mb-1.5">Recipient</div>
              <div className="h-11 rounded-lg border border-border bg-white px-3 flex items-center text-base text-primary font-medium">
                John Doe · 1250 Las Vegas Blvd S
              </div>
            </motion.div>

            {/* Documents */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: 0.4 }}
            >
              <div className="text-[11px] uppercase tracking-wider font-bold text-primary/50 mb-1.5">Documents (19 NV types)</div>
              <div className="rounded-lg border border-border bg-white p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-accent font-semibold">Summons</span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-accent/15 text-accent font-semibold">Complaint</span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-primary/60 font-semibold">Subpoena</span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-primary/60 font-semibold">Motion</span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-primary/60 font-semibold">+15 more</span>
                </div>
              </div>
            </motion.div>

            {/* Pickup options */}
            <motion.div
              className="grid grid-cols-2 gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
              transition={{ duration: 0.4 }}
            >
              <div className="h-16 rounded-lg border-2 border-accent bg-accent/10 flex flex-col items-center justify-center text-accent">
                <div className="text-xs font-bold uppercase tracking-wider">Server Prints</div>
                <div className="text-[10px] text-primary/60 mt-0.5">Recommended</div>
              </div>
              <div className="h-16 rounded-lg border border-border bg-white flex flex-col items-center justify-center text-primary/60">
                <div className="text-xs font-bold uppercase tracking-wider">Pick Up at Office</div>
                <div className="text-[10px] text-primary/50 mt-0.5">Attorney's address</div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}