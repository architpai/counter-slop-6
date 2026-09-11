'use client';

import { useEffect, useRef, useState } from 'react';
import { Hud } from '@/components/hud/Hud';
import { HudStore } from '@/engine/hud/store';
import type { GameHandle } from '@/engine/boot';

declare global {
  interface Window {
    __game?: GameHandle;
  }
}

/**
 * Owns the canvas and the HUD root, and owns exactly one engine instance.
 *
 * StrictMode mounts, unmounts and remounts in development. The engine creates a
 * WebGL context, an AudioContext, a PeerJS peer and a rAF chain, so a leaked
 * instance is not a small leak. Two guards keep it to one:
 *   - `cancelled` covers unmounting while the dynamic import is still in flight
 *   - `handle.dispose()` releases everything the engine took
 */
export default function GameMount() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(() => new HudStore());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // StrictMode replays this effect with the same React-owned store. Make the
    // view available before boot, so even an early boot failure stays visible.
    store.activate();
    let cancelled = false;
    let handle: GameHandle | null = null;

    import('@/engine/boot')
      .then(({ boot }) => {
        if (cancelled) return;
        handle = boot(canvas, store);
        window.__game = handle;
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      handle?.dispose();
      if (window.__game === handle) delete window.__game;
      handle = null;
    };
  }, [store]);

  return (
    <>
      <canvas ref={canvasRef} id="game" aria-label="First-person game view" />
      <Hud store={store}>
        {error !== null && <BootError message={error} />}
      </Hud>
    </>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <div className="boot-error" role="alert">
      <h1>The game could not start</h1>
      <p>
        Check that WebGL is enabled and that the network can load the game
        libraries. Then reload this page.
      </p>
      <pre>{message}</pre>
      <button type="button" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}
