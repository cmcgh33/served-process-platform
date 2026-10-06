import { motion } from 'framer-motion';
import { MiaCharacter } from '../MiaCharacter';

export function Scene2() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-[8%] left-1/2 -translate-x-1/2 text-center w-full z-20">
        <motion.p
          className="text-sm font-semibold text-[#0f1e3c]/60 tracking-[0.3em] uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          Your Dashboard
        </motion.p>
      </div>

      <div className="flex items-center gap-16 w-full max-w-5xl px-8 mt-12">
        <motion.div 
          className="w-1/3"
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <MiaCharacter pose="point-right" expression="talking" className="w-full h-[450px]" />
        </motion.div>
        
        <div className="w-2/3 relative h-[500px]">
          {/* Background card */}
          <motion.div 
            className="absolute top-20 w-[95%] left-[2.5%] bg-white/50 p-6 rounded-2xl shadow-md border border-slate-200/50 scale-95 blur-[1px]"
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <div className="h-24 bg-slate-200 rounded-lg"></div>
          </motion.div>

          {/* Foreground card */}
          <motion.div 
            className="absolute top-10 w-full bg-white p-8 rounded-2xl shadow-2xl border-2 border-slate-100"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1, scale: [1, 1.02, 1] }}
            transition={{ 
              y: { delay: 1, type: 'spring' },
              opacity: { delay: 1 },
              scale: { delay: 2, duration: 2, repeat: Infinity, ease: "easeInOut" }
            }}
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <motion.div 
                  className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-1 rounded mb-2 inline-block uppercase tracking-wider"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
                >
                  Clark County
                </motion.div>
                <h3 className="font-bold text-2xl text-[#0f1e3c]">Summons & Complaint</h3>
                <p className="text-slate-500 font-medium mt-1">District Court</p>
              </div>
              <motion.div 
                className="bg-[#f59e0b] text-white px-4 py-2 rounded-full font-bold text-xl shadow-lg shadow-amber-500/30"
                initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.8, type: 'spring' }}
              >
                $96.00
              </motion.div>
            </div>
            
            <div className="flex items-center gap-3 text-slate-600 mb-8 p-4 bg-slate-50 rounded-lg">
              <div className="w-10 h-10 rounded-full bg-[#0f1e3c]/10 flex items-center justify-center">📍</div>
              <div>
                <p className="font-bold text-[#0f1e3c]">123 Main St</p>
                <p className="text-sm">Las Vegas, NV 89101</p>
              </div>
            </div>

            <motion.button 
              className="w-full py-4 bg-[#0f1e3c] text-white font-bold rounded-xl text-lg flex justify-center items-center gap-2 overflow-hidden relative"
              whileHover={{ scale: 1.02 }}
            >
              <motion.div 
                className="absolute inset-0 bg-white/20"
                initial={{ x: "-100%" }}
                animate={{ x: "100%" }}
                transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
              />
              Claim Job
            </motion.button>
            
            <motion.div 
              className="mt-4 flex items-center justify-center gap-2 text-sm text-[#f59e0b] font-medium"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.5 }}
            >
              <span>🔒 PILB License Required</span>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
