import { motion } from 'framer-motion';
import { useScenePhase } from '../timing';

export function Scene1() {
  const phase = useScenePhase([500, 2000, 4000, 6000, 10000]);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0, clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ opacity: 1, clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="text-center z-10 px-20">
        <motion.h1 
          className="text-[6vw] font-display font-bold text-primary leading-[1.1] tracking-tight"
          initial={{ opacity: 0, y: 50 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          The modern way for<br />
          <span className="text-accent">Nevada attorneys</span>
        </motion.h1>
        
        <motion.p 
          className="text-[2.5vw] text-primary/70 mt-6 max-w-4xl mx-auto"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          to handle process serving.
        </motion.p>
      </div>
      
      {/* Decorative crossed-out items */}
      <motion.div 
        className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-12"
        initial={{ opacity: 0 }}
        animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
      >
        {["Chasing servers", "Faxing affidavits", "Wondering"].map((text, i) => (
          <motion.div 
            key={text}
            className="relative text-xl text-primary/40 font-medium"
            initial={{ y: 20, opacity: 0 }}
            animate={phase >= 3 ? { y: 0, opacity: 1 } : { y: 20, opacity: 0 }}
            transition={{ delay: i * 0.2 }}
          >
            {text}
            <motion.div 
              className="absolute top-1/2 left-[-10%] h-[3px] bg-secondary w-[120%]"
              initial={{ scaleX: 0 }}
              animate={phase >= 4 ? { scaleX: 1 } : { scaleX: 0 }}
              style={{ originX: 0 }}
              transition={{ delay: i * 0.2, duration: 0.4 }}
            />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}