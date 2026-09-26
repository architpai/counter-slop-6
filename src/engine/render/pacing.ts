/**
 * Frame pacing against the GPU, and the quiet start of a match.
 *
 * With vsync off, or on a GPU shared with other work, the page can queue
 * frames far faster than the GPU draws them: on an M4 Pro (ANGLE Metal, Ultra,
 * vsync off, as `tests/tiers.shots.mjs` runs) it ran 54-73 frames ahead.
 * Every call that has to reach the GPU process with data (a texture upload,
 * a new vertex buffer) then waits behind that whole queue: a map streaming in
 * on Ultra blocked frames for 240-340 ms on an idle machine (up to 1.8 s on a
 * busy GPU). `GpuFences` puts a fence after each frame; while something
 * streams (`Renderer.streaming`) boot skips a frame while
 * `MAX_FRAMES_IN_FLIGHT` are unfinished, so no upload waits behind more than
 * that. A skipped frame is not free: the browser sends the next animation
 * frame about a display interval later (17-19 ms), so with nothing to upload
 * none is skipped. With vsync on the browser keeps its own queue shorter than
 * that, and nothing is skipped.
 */

/**
 * Frames the GPU may have queued before the next is skipped. The browser's
 * own pacing (vsync on) keeps fewer unfinished, as the fences read them: 1 on
 * an M4 Pro at 60 Hz, up to 5 under SwiftShader, whose fences read done late.
 * At 3 or 4 the frame loop under SwiftShader skipped a frame in two and
 * stepped unevenly; up to 8 bound Ultra's streaming frames as well as 2 did.
 */
export const MAX_FRAMES_IN_FLIGHT = 6;
/**
 * A fence older than this counts as done: a driver that never signals one
 * must not stop the game. A GPU this slow per frame gets no pacing.
 */
export const FENCE_TIMEOUT_MS = 400;
/** Fences kept at most (more than `MAX_FRAMES_IN_FLIGHT`); renders outside the frame loop (tests, benchmarks) add one each. */
const MAX_FENCES = 12;
/**
 * The first seconds of play (a match starting or resuming): no uploads, no
 * shader programs compiled or first drawn, no sky landing. What streams in
 * the menu is held until then, so the first frames a player moves in are even.
 */
export const MATCH_QUIET_MS = 3000;

/** The slice of WebGL2 the fences use. */
export interface FenceGL {
  readonly SYNC_GPU_COMMANDS_COMPLETE: number;
  readonly SYNC_STATUS: number;
  readonly UNSIGNALED: number;
  fenceSync(condition: number, flags: number): WebGLSync | null;
  getSyncParameter(sync: WebGLSync, pname: number): unknown;
  deleteSync(sync: WebGLSync | null): void;
}

/**
 * One fence per frame, oldest first. The browser updates a fence's state
 * between tasks, never within one, so a check costs nothing and never waits.
 */
export class GpuFences {
  readonly #gl: FenceGL;
  readonly #fences: { sync: WebGLSync; at: number }[] = [];

  constructor(gl: FenceGL) {
    this.#gl = gl;
  }

  /** After a frame's last draw. */
  mark(now: number): void {
    const sync = this.#gl.fenceSync(this.#gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    this.#fences.push({ sync, at: now });
    while (this.#fences.length > MAX_FENCES) this.#gl.deleteSync(this.#fences.shift()!.sync);
  }

  /** Frames marked that the GPU has not finished. The GPU finishes them in order, so the check stops at the first one pending. */
  inFlight(now: number): number {
    const gl = this.#gl, fences = this.#fences;
    while (fences.length > 0) {
      const { sync, at } = fences[0]!;
      // A lost context reports no status: nothing is pending on it.
      if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.UNSIGNALED && now - at < FENCE_TIMEOUT_MS) break;
      gl.deleteSync(sync);
      fences.shift();
    }
    return fences.length;
  }

  /** The GPU is `MAX_FRAMES_IN_FLIGHT` frames behind: skip this one. */
  behind(now: number): boolean {
    return this.inFlight(now) >= MAX_FRAMES_IN_FLIGHT;
  }

  clear(): void {
    for (const { sync } of this.#fences) this.#gl.deleteSync(sync);
    this.#fences.length = 0;
  }
}

/** Is a match live, and is it still in its quiet start (`MATCH_QUIET_MS`)? */
export class MatchClock {
  #live = false;
  #since = -Infinity;

  /** Boot, every frame: is the player in a match (playing, no menu over it)? */
  set(live: boolean, now: number): void {
    if (live && !this.#live) this.#since = now;
    this.#live = live;
  }

  get live(): boolean { return this.#live; }

  quiet(now: number): boolean {
    return this.#live && now - this.#since < MATCH_QUIET_MS;
  }
}
