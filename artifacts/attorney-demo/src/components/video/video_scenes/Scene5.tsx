import { motion } from 'framer-motion';
import { useScenePhase } from '../timing';

export function Scene5() {
  const phase = useScenePhase([500, 2000, 4000, 7000]);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center pt-20"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.h2 
        className="text-[4vw] font-display font-bold text-primary mb-4 text-center"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
      >
        Your <span className="text-accent">Cloud Vault.</span>
      </motion.h2>
      <motion.p
        className="text-xl text-primary/60 mb-12 text-center"
        initial={{ opacity: 0 }}
        animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
      >
        Encrypted, organized, and ready whenever you need it.
      </motion.p>

      {/* Search Bar */}
      <motion.div 
        className="w-full max-w-2xl h-14 bg-card rounded-full border-2 border-border shadow-md flex items-center px-6 mb-12 relative z-20"
        initial={{ opacity: 0, width: "30%" }}
        animate={phase >= 4 ? { opacity: 1, width: "100%", borderColor: "var(--accent)" } : phase >= 1 ? { opacity: 1, width: "60%" } : { opacity: 0, width: "30%" }}
        transition={{ duration: 0.5, type: "spring" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary/40 mr-4">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
          <path d="M20 20L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <motion.div 
          className="h-5 w-[2px] bg-accent"
          initial={{ opacity: 0 }}
          animate={phase >= 4 ? { opacity: [1, 0, 1] } : { opacity: 0 }}
          transition={{ repeat: Infinity, duration: 1 }}
        />
      </motion.div>

      {/* Folders and Documents */}
      <div className="w-full max-w-5xl relative h-[40vh]">
        <div className="flex gap-6 absolute top-0 left-0 w-full justify-center">
          {[1, 2, 3].map((folder, i) => (
            <motion.div 
              key={`folder-${i}`}
              className="w-48 h-32 bg-secondary/10 border-2 border-secondary/30 rounded-xl relative"
              initial={{ opacity: 0, y: 50, rotateX: -30 }}
              animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 50, rotateX: -30 }}
              transition={{ delay: i * 0.15, type: "spring" }}
            >
              {/* Folder tab */}
              <div className="absolute -top-4 left-0 w-1/2 h-4 bg-secondary/10 border-2 border-b-0 border-secondary/30 rounded-t-lg" />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
                <div className="w-12 h-1 bg-secondary/40 rounded-full mb-2" />
                <div className="w-8 h-1 bg-secondary/30 rounded-full" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Documents Grid floating up from behind */}
        <div className="absolute top-16 left-1/2 -translate-x-1/2 w-full flex justify-center gap-4 flex-wrap px-12 pointer-events-none">
          {[1, 2, 3, 4, 5, 6].map((doc, i) => (
            <motion.div 
              key={`doc-${i}`}
              className="w-32 h-40 bg-card border border-border shadow-lg rounded-lg p-3 flex flex-col"
              initial={{ opacity: 0, y: 100, scale: 0.8, rotateZ: (i % 2 === 0 ? -5 : 5) }}
              animate={phase >= 3 ? { opacity: 1, y: i * 10, scale: 1, rotateZ: (i % 2 === 0 ? -2 : 2) } : { opacity: 0, y: 100, scale: 0.8 }}
              transition={{ delay: 0.5 + (i * 0.1), type: "spring" }}
            >
               <div className="w-full h-2 bg-primary/10 rounded mb-2" />
               <div className="w-3/4 h-2 bg-primary/10 rounded mb-4" />
               <div className="w-full h-1 bg-primary/5 rounded mb-1 mt-auto" />
               <div className="w-1/2 h-1 bg-primary/5 rounded" />
            </motion.div>
          ))}
        </div>
      </div>

    </motion.div>
  );
}