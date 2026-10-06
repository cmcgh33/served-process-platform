import { motion } from 'framer-motion';

export function Scene5() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-[#0f1e3c]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -50 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-[5%] left-1/2 -translate-x-1/2 text-center w-full z-30">
        <motion.p
          className="text-sm font-semibold text-white/70 tracking-[0.3em] uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          Court-Ready Affidavit
        </motion.p>
      </div>

      {/* Affidavit Sheet sliding in */}
      <motion.div 
        className="w-full max-w-2xl bg-white min-h-[700px] mt-12 rounded-t-sm shadow-2xl relative p-12 overflow-hidden border-t-[20px] border-slate-200"
        initial={{ y: "100%", rotateX: 20 }}
        animate={{ y: "10%", rotateX: 0 }}
        transition={{ delay: 0.5, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ perspective: 1000, transformOrigin: 'bottom center' }}
      >
        <div className="border-b-2 border-black pb-4 mb-8">
          <h2 className="text-center font-serif text-3xl font-bold tracking-widest text-black">AFFIDAVIT OF SERVICE</h2>
          <p className="text-center font-serif mt-2">CLARK COUNTY DISTRICT COURT</p>
        </div>

        <div className="space-y-6 font-serif text-lg leading-relaxed text-black">
          <p>I, <strong>Mia Server</strong>, being duly sworn, declare under penalty of perjury:</p>
          <p>That on <strong>Friday, Oct 12th at 2:45 PM</strong>, I served the <strong>Summons & Complaint</strong> upon the defendant.</p>
          
          <motion.div 
            className="flex items-center gap-4 p-4 bg-slate-50 border border-slate-200"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.5 }}
          >
            <div className="w-6 h-6 bg-black text-white flex items-center justify-center font-bold text-sm">✓</div>
            <span>GPS Provenance Verified: 36.1699° N, 115.1398° W</span>
          </motion.div>

          <p className="mt-8 pt-8">I declare under penalty of perjury under the law of the State of Nevada that the foregoing is true and correct.</p>
          
          <div className="flex justify-between items-end mt-12">
            <div>
              <motion.div 
                className="font-script text-4xl text-blue-800 mb-2 border-b border-black w-64 pb-2"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2 }}
              >
                <svg width="200" height="50" viewBox="0 0 200 50">
                  <motion.path 
                    d="M 10 30 Q 30 10 50 30 T 90 20 T 150 40" 
                    fill="none" stroke="#1e3a8a" strokeWidth="3" 
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 2, duration: 1 }}
                  />
                </svg>
              </motion.div>
              <p className="text-sm">Signature of Server</p>
            </div>
            
            {/* NRS Stamp */}
            <motion.div 
              className="border-4 border-[#f59e0b] text-[#f59e0b] p-4 rounded-lg transform -rotate-12 font-bold text-xl uppercase tracking-widest text-center"
              initial={{ scale: 3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 3.5, type: 'spring', stiffness: 300, damping: 15 }}
            >
              NRS 53.045<br/>NO NOTARY REQUIRED
            </motion.div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
