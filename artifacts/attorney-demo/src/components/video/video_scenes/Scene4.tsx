import { motion } from 'framer-motion';
import { useScenePhase } from '../timing';

export function Scene4() {
  const phase = useScenePhase([500, 2000, 5000, 7000, 10000]);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center bg-primary"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="w-1/2 pl-24 pr-12 z-20 text-white">
        <motion.h2 
          className="text-[4vw] font-display font-bold leading-tight mb-6"
          initial={{ opacity: 0, x: -30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
        >
          Watch the job <span className="text-accent">live.</span><br />
          Ready to file.
        </motion.h2>
        
        <div className="space-y-4 mt-12">
          {["Nevada compliant", "GPS & Timestamp", "Signature & Attempt history", "No follow-up emails"].map((text, i) => (
            <motion.div 
              key={text}
              className="flex items-center gap-4 text-xl text-white/80"
              initial={{ opacity: 0, x: -20 }}
              animate={phase >= 5 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
              transition={{ delay: i * 0.2 }}
            >
              <div className="w-6 h-6 rounded-full bg-success flex items-center justify-center">
                <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5L5 9L13 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {text}
            </motion.div>
          ))}
        </div>
      </div>
      
      <div className="absolute right-0 top-0 bottom-0 w-1/2 overflow-hidden">
        {/* Map background — softer navy with subtle radial */}
        <div
          className="absolute inset-0 bg-[#0e1c36]"
          style={{ backgroundImage: 'radial-gradient(circle at 60% 50%, #1e3a6b 0%, transparent 70%)' }}
        />

        {/* Street grid (denser + brighter) */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 800" preserveAspectRatio="none" fill="none">
          {/* Minor grid */}
          <g stroke="rgba(255,255,255,0.06)" strokeWidth="1">
            {[60, 120, 180, 240, 300, 360, 420, 480, 540].map((x) => (
              <line key={`v${x}`} x1={x} y1="0" x2={x} y2="800" />
            ))}
            {[80, 160, 240, 320, 400, 480, 560, 640, 720].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2="600" y2={y} />
            ))}
          </g>
          {/* Major arterials */}
          <g stroke="rgba(255,255,255,0.16)" strokeWidth="3">
            <line x1="0" y1="240" x2="600" y2="240" />
            <line x1="0" y1="560" x2="600" y2="560" />
            <line x1="180" y1="0" x2="180" y2="800" />
            <line x1="420" y1="0" x2="420" y2="800" />
          </g>
          {/* Highway curve */}
          <path d="M 0,680 Q 200,640 320,560 T 600,360" stroke="rgba(245,158,11,0.18)" strokeWidth="6" fill="none" />
        </svg>

        {/* Street labels */}
        <div className="absolute left-4 top-[28%] text-[10px] font-semibold tracking-wider text-white/40 uppercase">Sahara Ave</div>
        <div className="absolute left-4 top-[68%] text-[10px] font-semibold tracking-wider text-white/40 uppercase">Charleston Blvd</div>
        <div className="absolute top-2 left-[26%] text-[10px] font-semibold tracking-wider text-white/40 uppercase rotate-90 origin-top-left">S Rampart Blvd</div>

        {/* Origin pin (Office) */}
        {phase >= 1 && (
          <motion.div
            className="absolute left-[12%] top-[78%] z-20"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className="relative">
              <div className="w-3 h-3 rounded-full bg-white border-2 border-primary shadow-lg" />
              <div className="absolute left-5 -top-1 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-white/85 bg-primary/70 backdrop-blur px-2 py-0.5 rounded">Office</div>
            </div>
          </motion.div>
        )}

        {/* Destination pin (Recipient) */}
        {phase >= 1 && (
          <motion.div
            className="absolute right-[18%] top-[28%] z-20"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <div className="relative">
              <svg width="22" height="28" viewBox="0 0 22 28" fill="none">
                <path d="M11 0C5 0 0.5 4.5 0.5 10.3 0.5 18 11 28 11 28S21.5 18 21.5 10.3C21.5 4.5 17 0 11 0Z" fill="var(--accent)" stroke="white" strokeWidth="1.5"/>
                <circle cx="11" cy="10" r="3.5" fill="white"/>
              </svg>
              <div className="absolute left-7 top-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-white bg-accent/90 px-2 py-0.5 rounded shadow">Recipient</div>
            </div>
          </motion.div>
        )}

        {/* Animated Route */}
        {phase >= 2 && (
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 800" preserveAspectRatio="none" fill="none">
            <motion.path
              d="M 72,624 L 180,624 L 180,400 L 420,400 L 420,224 L 492,224"
              stroke="var(--accent)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="14 8"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 3, ease: "linear" }}
            />
            <motion.circle
              r="9"
              fill="var(--accent)"
              stroke="white"
              strokeWidth="2.5"
              initial={{ offsetDistance: "0%" }}
              animate={{ offsetDistance: "100%" }}
              style={{ offsetPath: "path('M 72,624 L 180,624 L 180,400 L 420,400 L 420,224 L 492,224')" }}
              transition={{ duration: 3, ease: "linear" }}
            />
          </svg>
        )}

        {/* Live ETA / status badge */}
        {phase >= 2 && (
          <motion.div
            className="absolute top-6 right-6 z-30 bg-primary/85 backdrop-blur px-3 py-2 rounded-lg shadow-lg border border-white/10 text-white"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-2">
              <div className="relative w-2 h-2">
                <div className="absolute inset-0 rounded-full bg-success animate-ping opacity-75" />
                <div className="absolute inset-0 rounded-full bg-success" />
              </div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-white/80">Live</div>
            </div>
            <div className="text-xs font-semibold mt-0.5">ETA 8 min · 2.4 mi</div>
          </motion.div>
        )}

        {/* Completion Ping */}
        {phase >= 3 && (
          <motion.div
            className="absolute right-[18%] top-[28%] z-20 pointer-events-none"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [1, 3, 0], opacity: [1, 0.4, 0] }}
            transition={{ duration: 1.2 }}
          >
            <div className="w-12 h-12 -ml-6 -mt-6 rounded-full bg-success" />
          </motion.div>
        )}

        {/* Affidavit PDF — smaller card pinned to lower-right so the map stays visible */}
        <motion.div
          className="absolute right-6 bottom-6 w-44 h-56 bg-white rounded-lg shadow-2xl overflow-hidden p-4 z-30 flex flex-col"
          initial={{ y: 60, opacity: 0, rotateZ: -8, scale: 0.6 }}
          animate={phase >= 4 ? { y: 0, opacity: 1, rotateZ: 4, scale: 1 } : { y: 60, opacity: 0, rotateZ: -8, scale: 0.6 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          <div className="flex justify-between items-center mb-3 border-b pb-2">
            <div className="text-[8px] font-black tracking-[0.15em] text-primary">AFFIDAVIT</div>
            <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
              <div className="w-2.5 h-2.5 bg-success rounded-full" />
            </div>
          </div>
          <div className="space-y-1.5 mb-auto">
            <div className="w-full h-1.5 bg-primary/10 rounded" />
            <div className="w-5/6 h-1.5 bg-primary/10 rounded" />
            <div className="w-full h-1.5 bg-primary/10 rounded" />
            <div className="w-4/6 h-1.5 bg-primary/10 rounded" />
            <div className="w-3/4 h-1.5 bg-primary/10 rounded" />
          </div>
          <div className="mt-3 border-t pt-2 flex gap-2 items-center">
            <div className="w-8 h-8 bg-primary/5 rounded" />
            <div className="flex-1 space-y-1">
              <div className="w-full h-1.5 bg-primary/10 rounded" />
              <div className="w-1/2 h-1.5 bg-primary/10 rounded" />
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}