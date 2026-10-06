import { createContext, useContext } from 'react';

export interface SceneTiming {
  sceneElapsedMs: number;
}

export const SceneTimingContext = createContext<SceneTiming>({ sceneElapsedMs: 0 });

export function useScenePhase(thresholds: number[]): number {
  const { sceneElapsedMs } = useContext(SceneTimingContext);
  let phase = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (sceneElapsedMs >= thresholds[i]) phase = i + 1;
    else break;
  }
  return phase;
}
