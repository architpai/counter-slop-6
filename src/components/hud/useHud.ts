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

/**
 * Subscribe to one primitive derived from a slice (`select` must be a stable, module-level function): the component
 * re-renders only when the derived value changes, not on every replacement of the slice.
 */
export function useHudSelect<K extends HudKey, T extends string | number | boolean | null>(
  store: HudStore, key: K, select: (state: HudState[K]) => T,
): T {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(key, listener),
    [store, key],
  );
  const getSnapshot = useCallback(() => select(store.getSnapshot(key)), [store, key, select]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
