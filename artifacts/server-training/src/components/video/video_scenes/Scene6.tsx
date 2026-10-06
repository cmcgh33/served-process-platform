import { motion } from 'framer-motion';
import { MiaCharacter } from '../MiaCharacter';

export function Scene6() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-slate-50"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: 50 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-[8%] left-1/2 -translate-x-1/2 text-center w-full z-30">
        <motion.p
          className="text-sm font-semibold text-[#0f1e3c]/60 tracking-[0.3em] uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          Earnings & Payouts
        </motion.p>
      </div>

      <div className="flex w-full max-w-5xl items-center justify-center gap-16 z-20">
        <motion.div 
          className="w-1/3"
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <MiaCharacter pose="point-right" expression="smile" className="w-full h-[450px]" />
        </motion.div>

        <div className="w-1/2 relative perspective-[1000px]">
          <motion.div 
            className="bg-gradient-to-br from-[#0f1e3c] to-[#1e3a8a] rounded-3xl p-10 shadow-2xl text-white overflow-hidden relative"
            initial={{ rotateY: -30, x: 100, opacity: 0 }}
            animate={{ rotateY: 0, x: 0, opacity: 1 }}
            transition={{ delay: 0.8, type: 'spring', damping: 20 }}
          >
            {/* Background design */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>
            
            <h3 className="text-white/70 text-xl font-medium mb-2 uppercase tracking-wider">Available Balance</h3>
            
            <motion.div 
              className="text-6xl font-black mb-6 tracking-tight flex items-baseline gap-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.5 }}
            >
              $4,800<span className="text-3xl text-white/50">.00</span>
            </motion.div>

            <motion.div 
              className="inline-flex items-center gap-2 bg-[#34d399]/20 text-[#34d399] px-4 py-2 rounded-full font-bold mb-10 border border-[#34d399]/30"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 2, type: 'spring' }}
            >
              <div className="w-2 h-2 rounded-full bg-[#34d399] animate-pulse"></div>
              Payout Cadence: Weekly • Friday
            </motion.div>

            <div className="flex gap-4">
              <motion.button 
                className="flex-1 py-4 bg-[#f59e0b] text-white font-bold rounded-xl text-xl shadow-lg shadow-[#f59e0b]/20 relative overflow-hidden"
                whileHover={{ scale: 1.05 }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 2.5 }}
              >
                Pay Now
                {/* Cursor clicking animation */}
                <motion.div 
                  className="absolute z-50 pointer-events-none"
                  initial={{ x: 100, y: 100, opacity: 0 }}
                  animate={{ x: "50%", y: "50%", opacity: [0, 1, 1, 0], scale: [1, 1, 0.8, 1] }}
                  transition={{ delay: 3.5, duration: 1.5 }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" className="drop-shadow-md">
                    <path d="M4 4l16 5-6.5 2L15 20l-4-5-5-2V4z" fill="white" />
                  </svg>
                </motion.div>
                
                {/* Ripple effect on click */}
                <motion.div 
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: [0, 10], opacity: [0, 0.5, 0] }}
                  transition={{ delay: 4.2, duration: 0.5 }}
                />
              </motion.button>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
