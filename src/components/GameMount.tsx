'use client';

import { useEffect, useRef, useState } from 'react';
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
  const hudRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hud = hudRef.current;
    if (!canvas || !hud) return;

    let cancelled = false;
    let handle: GameHandle | null = null;

    import('@/engine/boot')
      .then(({ boot }) => {
        if (cancelled) return;
        handle = boot(canvas, hud);
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
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="game" aria-label="First-person game view" />
      <div ref={hudRef} id="hud">
        {error !== null && <BootError message={error} />}
      </div>
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
