'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { HudKey, HudState, HudStore } from '@/engine/hud/store';

/** Subscribe to one stable HUD slice. */
export function useHud<K extends HudKey>(store: HudStore, key: K): HudState[K] {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(key, listener),
    [store, key],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(key), [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
