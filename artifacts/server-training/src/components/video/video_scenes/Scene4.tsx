import { motion } from 'framer-motion';
import { MiaCharacter } from '../MiaCharacter';

export function Scene4() {
  const outcomes = [
    { label: "Personal", color: "bg-slate-100 text-slate-600" },
    { label: "Substitute (NRCP 4.2)", color: "bg-[#0f1e3c] text-white shadow-lg ring-2 ring-[#0f1e3c]/50 ring-offset-2", active: true },
    { label: "Posting", color: "bg-slate-100 text-slate-600" },
    { label: "Non-est", color: "bg-slate-100 text-slate-600" }
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-slate-50"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, filter: "blur(10px)" }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-[6%] left-1/2 -translate-x-1/2 text-center w-full z-30">
        <motion.p
          className="text-sm font-semibold text-[#0f1e3c]/60 tracking-[0.3em] uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          Logging Attempts
        </motion.p>
      </div>

      <div className="flex w-full max-w-6xl items-center justify-between px-10 z-20 mt-10">
        
        {/* Left: House + Mia */}
        <div className="w-1/2 relative h-[500px] flex items-end">
          {/* Simple flat house */}
          <motion.div 
            className="absolute bottom-0 left-10 w-80 h-80"
            initial={{ scale: 0, opacity: 0, transformOrigin: 'bottom center' }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5, type: 'spring', damping: 15 }}
          >
            <div className="w-full h-full relative">
              {/* Roof */}
              <div className="absolute top-0 left-0 w-full h-32 bg-red-400" style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}></div>
              {/* Body */}
              <div className="absolute bottom-0 left-[10%] w-[80%] h-48 bg-white border-2 border-slate-200">
                {/* Door */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-32 bg-amber-700"></div>
                {/* Window */}
                <div className="absolute top-8 left-4 w-12 h-12 bg-sky-200 border-4 border-white"></div>
                <div className="absolute top-8 right-4 w-12 h-12 bg-sky-200 border-4 border-white"></div>
              </div>
            </div>
          </motion.div>

          <motion.div 
            className="absolute bottom-0 left-48 w-48 h-[350px] z-10"
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            <MiaCharacter pose="phone" expression="talking" className="w-full h-full" />
          </motion.div>
        </div>

        {/* Right: UI Panel */}
        <div className="w-1/2">
          <motion.div 
            className="bg-white rounded-3xl shadow-2xl p-8 border border-slate-100"
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 1, type: 'spring' }}
          >
            <h3 className="text-xl font-bold text-slate-400 mb-6 uppercase tracking-wider">Select Outcome</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              {outcomes.map((o, i) => (
                <motion.div 
                  key={i}
                  className={`p-4 rounded-xl font-bold text-center ${o.color}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.2 + (i * 0.1) }}
                >
                  {o.label}
                </motion.div>
              ))}
            </div>

            {/* NRCP 4.2 Callout */}
            <motion.div 
              className="bg-amber-50 border border-amber-200 rounded-xl p-6 relative overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              transition={{ delay: 2, type: 'spring' }}
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-[#f59e0b]"></div>
              <h4 className="font-bold text-[#f59e0b] mb-2 flex items-center gap-2">
                ⚠️ Nevada Requirement
              </h4>
              <ul className="text-[#0f1e3c] space-y-2 font-medium">
                <li className="flex items-center gap-2">✓ Person 18+ at dwelling</li>
                <li className="flex items-center gap-2">✓ Follow-up mailing required</li>
              </ul>
            </motion.div>
            
            <motion.button 
              className="w-full mt-8 py-4 bg-[#0f1e3c] text-white font-bold rounded-xl text-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2.5 }}
            >
              Save Attempt
            </motion.button>
          </motion.div>
        </div>

      </div>
    </motion.div>
  );
}
