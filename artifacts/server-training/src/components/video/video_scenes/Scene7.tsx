import { motion } from 'framer-motion';
import { MiaCharacter } from '../MiaCharacter';

export function Scene7() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
        
        <motion.div 
          className="w-64 h-[400px] mb-8"
          initial={{ scale: 0.8, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ delay: 0.3, type: 'spring' }}
        >
          <MiaCharacter pose="waving" expression="smile" className="w-full h-full" />
        </motion.div>

        <motion.h1 
          className="text-5xl font-bold text-[#0f1e3c] mb-12 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          Welcome to the team.
        </motion.h1>

        <motion.button 
          className="px-12 py-6 bg-[#f59e0b] text-white font-black rounded-full text-2xl shadow-2xl shadow-[#f59e0b]/40 hover:scale-105 transition-transform"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1.5, type: 'spring', stiffness: 200, damping: 15 }}
        >
          Mark training complete
        </motion.button>

      </div>
      
      {/* Confetti / Shapes background */}
      <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              backgroundColor: i % 3 === 0 ? '#f59e0b' : i % 3 === 1 ? '#34d399' : '#0f1e3c',
              width: Math.random() * 20 + 10,
              height: Math.random() * 20 + 10,
              left: `${Math.random() * 100}%`,
              top: '100%',
              opacity: 0.6
            }}
            animate={{
              top: '-10%',
              rotate: Math.random() * 360,
              x: Math.random() * 200 - 100
            }}
            transition={{
              duration: Math.random() * 3 + 4,
              delay: Math.random() * 2 + 1.5,
              repeat: Infinity,
              ease: 'linear'
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
