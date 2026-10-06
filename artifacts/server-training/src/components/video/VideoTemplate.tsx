import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';
import { Scene7 } from './video_scenes/Scene7';

export const SCENE_DURATIONS = {
  scene1: 9300,
  scene2: 17400,
  scene3: 8100,
  scene4: 64800,
  scene5: 14100,
  scene6: 13000,
  scene7: 4600,
};

const SCENE_KEYS = Object.keys(SCENE_DURATIONS) as Array<keyof typeof SCENE_DURATIONS>;
const SCENE_ENDS = SCENE_KEYS.reduce<number[]>((acc, k) => {
  acc.push((acc[acc.length - 1] ?? 0) + SCENE_DURATIONS[k]);
  return acc;
}, []);
const TOTAL_MS = SCENE_ENDS[SCENE_ENDS.length - 1];

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  scene1: Scene1,
  scene2: Scene2,
  scene3: Scene3,
  scene4: Scene4,
  scene5: Scene5,
  scene6: Scene6,
  scene7: Scene7,
};

export default function VideoTemplate() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-[#0f1e3c]">
        <button
          onClick={() => setStarted(true)}
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-[#0f1e3c] text-white cursor-pointer group"
          aria-label="Play training video"
        >
          <div className="w-28 h-28 rounded-full bg-[#f59e0b] flex items-center justify-center mb-8 shadow-2xl transition-transform group-hover:scale-110">
            <svg className="w-12 h-12 text-[#0f1e3c] ml-1.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div className="font-sans font-black text-4xl tracking-tight mb-3">SERVED.</div>
          <div className="text-white/80 text-lg">Tap to play server training</div>
          <div className="text-white/50 text-sm mt-2">~2 minutes 11 seconds · with sound</div>
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
  const sceneKey = SCENE_KEYS[currentScene];
  const SceneComponent = SCENE_COMPONENTS[sceneKey];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-50 font-sans">
      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}voiceover.mp3`}
        preload="auto"
        className="hidden"
      />

      {/* Persistent background layers */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-[0.03] top-[-20%] left-[-10%]"
          style={{ background: 'radial-gradient(circle, #0f1e3c, transparent)' }}
          animate={{ x: ['-5%', '5%', '-5%'], y: ['5%', '-5%', '5%'] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[80px] opacity-[0.04] bottom-[-20%] right-[-10%]"
          style={{ background: 'radial-gradient(circle, #f59e0b, transparent)' }}
          animate={{ x: ['5%', '-5%', '5%'], y: ['-5%', '5%', '-5%'] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
        />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              'linear-gradient(#0f1e3c 1px, transparent 1px), linear-gradient(90deg, #0f1e3c 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={sceneKey} />}
      </AnimatePresence>

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
              className="h-full bg-[#f59e0b] transition-[width] duration-150 ease-linear"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-2">
              <button
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="w-10 h-10 rounded-full bg-[#f59e0b] text-[#0f1e3c] flex items-center justify-center shadow-lg hover:scale-105 transition"
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
