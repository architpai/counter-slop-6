import { replyTransfer, runLayoutRequest } from './lightmapLayout';
import type { LayoutReply, LayoutRequest } from './lightmapLayout';

/**
 * The bake layout worker (render/lightmapJob.ts posts to it): each request's
 * layout, at once, and its `uv1` buffers moved back.
 */
const scope = self as unknown as Worker;

scope.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const request = event.data;
  let reply: LayoutReply;
  try {
    reply = { job: request.job, layout: runLayoutRequest(request) };
  } catch (error) {
    reply = { job: request.job, layout: null, error: String(error) };
  }
  scope.postMessage(reply, replyTransfer(reply));
};
