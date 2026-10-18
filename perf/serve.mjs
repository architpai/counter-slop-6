// Static server for the production build (`next build` with `output: 'export'` writes `out/`; `next start` does not
// serve an export). No deps: node:http over `out/`, real MIME types, no compression, no caching headers.
//   node perf/serve.mjs [port=4173] [dir=out]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

export function serve(port = 4173, dir = resolve(fileURLToPath(new URL('..', import.meta.url)), 'out')) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      let st = statSync(file);
      if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    } catch {
      try { const st = statSync(file + '.html'); res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': st.size }); createReadStream(file + '.html').pipe(res); }
      catch { res.writeHead(404).end('not found'); }
    }
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4173);
  await serve(port, process.argv[3]);
  console.log(`serving out/ on http://127.0.0.1:${port}/`);
}
