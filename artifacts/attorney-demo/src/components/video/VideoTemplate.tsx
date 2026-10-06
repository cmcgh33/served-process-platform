import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';
import { SceneTimingContext } from './timing';

// Per-scene durations in ms — derived from the actual VO clip lengths so
// scene transitions land exactly on narration boundaries. Total ~93.5s.
const SCENE_DURATIONS = {
  open: 12904,
  postJob: 12016,
  pricing: 26656,
  tracking: 12016,
  vault: 10000,
  close: 16520,
} as const;
const SCENE_KEYS = Object.keys(SCENE_DURATIONS) as Array<keyof typeof SCENE_DURATIONS>;
// Cumulative end-time (ms) of each scene — audio currentTime is the source of truth.
const SCENE_ENDS = SCENE_KEYS.reduce<number[]>((acc, k) => {
  acc.push((acc[acc.length - 1] ?? 0) + SCENE_DURATIONS[k]);
  return acc;
}, []);
const TOTAL_MS = SCENE_ENDS[SCENE_ENDS.length - 1];

export default function VideoTemplate() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-primary">
        <button
          onClick={() => setStarted(true)}
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-primary text-white cursor-pointer group"
          aria-label="Play demo"
        >
          <div className="w-28 h-28 rounded-full bg-secondary flex items-center justify-center mb-8 shadow-2xl transition-transform group-hover:scale-110">
            <svg className="w-12 h-12 text-primary ml-1.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div className="font-display font-black text-4xl tracking-tight mb-3">SERVED.</div>
          <div className="text-white/80 text-lg">Tap to play the demo</div>
          <div className="text-white/50 text-sm mt-2">~95 seconds · with sound</div>
        </button>
      </div>
    );
  }

  return <VideoPlayer />;
}

function VideoPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentScene, setCurrentScene] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Audio is the timing source of truth — scene index follows currentTime.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));

    const onTime = () => {
      const ms = a.currentTime * 1000;
      setElapsedMs(ms);
      const idx = SCENE_ENDS.findIndex((end) => ms < end);
      setCurrentScene(idx === -1 ? SCENE_KEYS.length - 1 : idx);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused || a.ended) {
      if (a.ended) a.currentTime = 0;
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  };
  const restart = () => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    setElapsedMs(0);
    setCurrentScene(0);
    a.play().catch(() => {});
  };
  const stop = () => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    setElapsedMs(0);
    setCurrentScene(0);
  };

  const progressPct = Math.min(100, (elapsedMs / TOTAL_MS) * 100);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}voiceover.mp3`}
        preload="auto"
        className="hidden"
      />

      {/* Persistent Background Layer */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Subtle noise texture */}
        <div 
          className="absolute inset-0 opacity-[0.03]" 
          style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}
        ></div>

        {/* Floating abstract geometric shapes in background */}
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
          animate={{
            x: ['-20%', '10%', '-10%'],
            y: ['-20%', '0%', '-10%'],
            scale: [1, 1.2, 0.9]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        />
        
        <motion.div 
          className="absolute right-0 bottom-0 w-[60vw] h-[60vw] rounded-full blur-[80px] opacity-[0.08]"
          style={{ background: 'radial-gradient(circle, var(--secondary) 0%, transparent 70%)' }}
          animate={{
            x: ['10%', '-20%', '0%'],
            y: ['10%', '-10%', '10%']
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Persistent Branding */}
      <motion.div 
        className="absolute top-8 left-10 z-50 flex items-center gap-3"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 1 }}
      >
        <img src={`${import.meta.env.BASE_URL}served-icon.png`} alt="SERVED." className="w-9 h-9 rounded-md object-cover" />
        <span className="font-display font-bold text-xl tracking-tight text-primary">SERVED.</span>
      </motion.div>

      <SceneTimingContext.Provider value={{ sceneElapsedMs: elapsedMs - (SCENE_ENDS[currentScene - 1] ?? 0) }}>
        <AnimatePresence mode="sync">
          {currentScene === 0 && <Scene1 key="open" />}
          {currentScene === 1 && <Scene2 key="postJob" />}
          {currentScene === 2 && <Scene3 key="pricing" />}
          {currentScene === 3 && <Scene4 key="tracking" />}
          {currentScene === 4 && <Scene5 key="vault" />}
          {currentScene === 5 && <Scene6 key="close" />}
        </AnimatePresence>
      </SceneTimingContext.Provider>

      {/* Player controls */}
      <div className="absolute bottom-0 left-0 right-0 z-[60] px-6 pb-5 pt-12 bg-gradient-to-t from-black/55 via-black/25 to-transparent pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <div
            role="progressbar"
            aria-label="Video progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
            className="h-1.5 w-full rounded-full bg-white/20 overflow-hidden mb-3"
          >
            <div
              className="h-full bg-secondary transition-[width] duration-150 ease-linear"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-2">
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="w-10 h-10 rounded-full bg-secondary text-primary flex items-center justify-center shadow-lg hover:scale-105 transition"
              >
                {isPlaying ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
                ) : (
                  <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>
              <button
                onClick={restart}
                aria-label="Restart"
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
              </button>
              <button
                onClick={stop}
                aria-label="Stop"
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>
              </button>
            </div>
            <div className="text-xs tabular-nums text-white/85">
              {fmt(elapsedMs)} <span className="text-white/45">/ {fmt(TOTAL_MS)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmt(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
