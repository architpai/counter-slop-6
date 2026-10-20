import { layoutRequest } from './lightmapLayout';
import type { BakedTriangles } from './lightmap';
import type { LaidOut, LayoutReply } from './lightmapLayout';
import type { Bounds } from '../types';

/**
 * The renderer's side of the layout worker (render/lightmapWorker.ts, which
 * runs `runLayoutRequest` from render/lightmapLayout.ts): one worker a
 * session, made on the first bake to lay out, its answers matched to tickets.
 */

/** A posted layout: `layout` set once `done`; `failed` when the worker threw or died. */
export interface LayoutTicket {
  readonly job: number;
  done: boolean;
  failed: boolean;
  layout: LaidOut | null;
}

let worker: Worker | null | undefined;
let jobs = 0;
const tickets = new Map<number, LayoutTicket>();

function failAll(): void {
  for (const ticket of tickets.values()) ticket.failed = true;
  tickets.clear();
}

/** The session's layout worker, made on first use; null with no `Worker`, or once it failed. */
function layoutWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined') return null;
  try {
    const made = new Worker(new URL('./lightmapWorker.ts', import.meta.url), { type: 'module' });
    made.onmessage = (event: MessageEvent<LayoutReply>) => {
      const reply = event.data, ticket = tickets.get(reply.job);
      if (!ticket) return;
      tickets.delete(reply.job);
      if (reply.error !== undefined) {
        ticket.failed = true;
        return;
      }
      ticket.layout = reply.layout;
      ticket.done = true;
    };
    // A worker that failed to load or died: every layout in it, and every later one, stays on the main thread.
    made.onerror = made.onmessageerror = () => {
      made.terminate();
      if (worker === made) worker = null;
      failAll();
    };
    worker = made;
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Post a bake's layout to the worker. Null with no worker: the caller lays
 * it out on the main thread. The ticket fills in on a later task.
 */
export function postLayout(triangles: BakedTriangles, bounds: Bounds, density: number): LayoutTicket | null {
  const target = layoutWorker();
  if (!target) return null;
  const job = ++jobs, ticket: LayoutTicket = { job, done: false, failed: false, layout: null };
  try {
    target.postMessage(layoutRequest(job, triangles, bounds, density));
  } catch {
    return null;
  }
  tickets.set(job, ticket);
  return ticket;
}

/** Forget a ticket whose layout is no longer wanted (the level changed, or the main thread finished first). */
export function dropLayout(ticket: LayoutTicket | null): void {
  if (ticket) tickets.delete(ticket.job);
}
