import { motion } from 'framer-motion';
import { useScenePhase } from '../timing';

export function Scene6() {
  const phase = useScenePhase([500, 2000, 8000]);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-primary"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <motion.div 
        className="flex flex-col items-center text-center z-10"
        animate={phase >= 3 ? { y: -100 } : { y: 0 }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
      >
        <motion.img
          src={`${import.meta.env.BASE_URL}served-icon.png`}
          alt="SERVED."
          className="w-20 h-20 rounded-xl object-cover mb-6 shadow-[0_0_40px_rgba(245,158,11,0.4)]"
          initial={{ scale: 0, rotate: -180 }}
          animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        />
        
        <motion.h1 
          className="text-[6vw] font-display font-black text-white tracking-tight leading-none mb-4"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        >
          SERVED.
        </motion.h1>

        <motion.p 
          className="text-2xl text-accent font-medium mb-12"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        >
          Built in Nevada, for Nevada attorneys.
        </motion.p>
      </motion.div>

      {/* Calendly CTA Card */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-card rounded-2xl shadow-2xl p-12 text-center border-t-4 border-secondary overflow-hidden"
        initial={{ opacity: 0, y: 100, scale: 0.9 }}
        animate={phase >= 3 ? { opacity: 1, y: 50, scale: 1 } : { opacity: 0, y: 100, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        <div className="absolute top-0 left-0 w-full h-full bg-secondary/5 pointer-events-none" />
        
        <h3 className="text-3xl font-display font-bold text-primary mb-6">
          Book a 30-min walkthrough
        </h3>
        
        <div className="bg-muted rounded-xl py-6 px-8 mb-6 border border-border">
          <p className="text-2xl font-mono text-primary/80 break-all">
            calendly.com/servedapp-info/30min
          </p>
        </div>
        
        <p className="text-lg text-primary/60">
          Or reach us anytime at <span className="font-semibold text-primary">info@servedapp.co</span>
        </p>
      </motion.div>
      
    </motion.div>
  );
}