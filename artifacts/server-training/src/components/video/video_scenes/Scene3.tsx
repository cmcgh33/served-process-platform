import { motion } from 'framer-motion';
import { MiaCharacter } from '../MiaCharacter';

export function Scene3() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-[8%] left-1/2 -translate-x-1/2 text-center w-full z-30">
        <motion.p
          className="text-sm font-semibold text-[#0f1e3c]/70 tracking-[0.3em] uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          GPS Tracking
        </motion.p>
      </div>

      {/* Map Background */}
      <div className="absolute inset-0 bg-[#e2e8f0] overflow-hidden">
        {/* Abstract Map Grid/Roads */}
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" className="opacity-20">
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#0f1e3c" strokeWidth="2" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />
          {/* A major road */}
          <path d="M 0 300 Q 400 300 600 100 T 1200 200" fill="none" stroke="#f59e0b" strokeWidth="12" strokeLinecap="round" />
        </svg>

        {/* Route Line Animation */}
        <motion.svg width="100%" height="100%" className="absolute inset-0 z-10 drop-shadow-xl" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
          <motion.path 
            d="M 200 600 C 400 600 500 400 700 400 S 900 300 1000 350"
            fill="none" 
            stroke="#34d399" 
            strokeWidth="16" 
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 1.5, duration: 4, ease: "easeInOut" }}
          />
          
          {/* Moving Pin */}
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: [0, 1, 1],
              offsetDistance: ["0%", "100%"] 
            }}
            transition={{ delay: 1.5, duration: 4, ease: "easeInOut" }}
            style={{ 
              offsetPath: 'path("M 200 600 C 400 600 500 400 700 400 S 900 300 1000 350")'
            }}
          >
            <circle cx="0" cy="0" r="20" fill="white" />
            <circle cx="0" cy="0" r="14" fill="#0f1e3c" />
            <motion.circle cx="0" cy="0" r="30" fill="none" stroke="#0f1e3c" strokeWidth="3"
              animate={{ scale: [1, 2], opacity: [1, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          </motion.g>
        </motion.svg>
      </div>

      {/* Phone Mockup in Foreground */}
      <div className="absolute bottom-[-10%] right-[10%] z-20 w-80">
        <motion.div 
          className="relative bg-white rounded-[3rem] shadow-2xl border-[8px] border-slate-800 p-6 h-[600px] flex flex-col"
          initial={{ y: "100%", rotate: 10 }}
          animate={{ y: 0, rotate: -5 }}
          transition={{ delay: 0.8, type: 'spring', damping: 15 }}
        >
          <div className="w-32 h-6 bg-slate-800 rounded-full mx-auto mb-6"></div>
          
          <div className="bg-[#0f1e3c] text-white p-4 rounded-xl mb-4">
            <h4 className="font-bold">In Progress</h4>
            <p className="text-sm opacity-80">123 Main St</p>
          </div>

          <div className="flex-grow flex flex-col justify-end pb-8">
            <motion.button 
              className="w-full py-4 bg-[#34d399] text-[#0f1e3c] font-black rounded-full text-xl shadow-lg relative overflow-hidden"
              whileTap={{ scale: 0.95 }}
            >
              <motion.div 
                className="absolute inset-0 bg-white/30"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 2], opacity: [0.5, 0] }}
                transition={{ delay: 1.2, duration: 0.8 }}
              />
              Start Route
            </motion.button>
            <p className="text-center text-slate-400 text-sm mt-4">GPS broadcasting active</p>
          </div>
        </motion.div>
      </div>
      
      {/* Mia */}
      <motion.div 
        className="absolute bottom-0 left-[10%] z-20 w-72 h-[450px]"
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <MiaCharacter pose="phone" expression="talking" className="w-full h-full" />
      </motion.div>

    </motion.div>
  );
}
