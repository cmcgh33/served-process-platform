import { motion } from 'framer-motion';
import { MiaCharacter } from '../MiaCharacter';

export function Scene1() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8 }}
    >
      <div className="absolute top-[15%] left-1/2 -translate-x-1/2 text-center w-full z-20">
        <motion.h1 
          className="text-5xl md:text-7xl font-bold text-[#0f1e3c] tracking-tight"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, type: 'spring' }}
        >
          Welcome to <span className="text-[#f59e0b]">SERVED.</span>
        </motion.h1>
      </div>
      <motion.div 
        className="relative w-80 h-[500px] mt-20"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.8, type: 'spring', damping: 20 }}
      >
        <MiaCharacter pose="waving" expression="smile" className="w-full h-full" />
      </motion.div>
    </motion.div>
  );
}
