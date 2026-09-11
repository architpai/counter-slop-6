/**
 * Phase 1 shim. `boot.js` becomes `boot.ts` in phase 6 and this file goes away.
 * Only the surface React touches is typed here; the rest stays `unknown` on
 * purpose so nothing starts depending on a half-invented shape.
 */
export interface GameHandle {
  dispose(): void;
  /** Live engine instances. Must be 1; higher means a leaked mount. */
  readonly live: number;
  beginSolo(): void;
  beginAtWave(n: number): void;
  jumpToWave(n: number): void;
  step(nowMs: number): void;
  readonly ctx: unknown;
  readonly gs: unknown;
  readonly player: unknown;
  readonly enemies: unknown;
  readonly net: unknown;
  readonly hud: unknown;
  readonly input: unknown;
  readonly world: unknown;
  readonly effects: unknown;
  level: unknown;
  nav: unknown;
}

export function boot(canvas: HTMLCanvasElement, hudRoot: HTMLElement): GameHandle;

export function liveInstances(): number;
