// Load A/B (AB_ARGS=--load-only): per preset and variant, how many cell-rounds had readyMs / firstPlayableMs below head.
//   node perf/ab-load-count.mjs <tag>
import { readFileSync, readdirSync } from 'node:fs';
const tag = process.argv[2], dir = 'perf/results';
const man = JSON.parse(readFileSync(`${dir}/scratch-${tag}-manifest.json`));
const get = (v, m, p, r) => { const j = JSON.parse(readFileSync(`${dir}/scratch-${tag}-${v}-${m}-${p}-${r}.json`));
  const L = j.cells[0].median.load; return [L.readyMs, L.firstPlayableMs]; };
for (const p of man.presets) for (const v of man.variants.filter(v => v !== 'head')) {
  let n = 0, fr = 0, ff = 0, cells = [];
  for (const m of man.maps) for (let r = 1; r <= man.rounds; r++) { const h = get('head', m, p, r), x = get(v, m, p, r); n++; if (x[0] < h[0]) fr++; if (x[1] < h[1]) ff++; }
  console.log(`${p} ${v}: ready faster ${fr}/${n}, firstPlayable faster ${ff}/${n}`);
}
