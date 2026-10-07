// Node module hooks so tools can run the game's TypeScript directly (node --experimental-transform-types):
// the `@/` alias, extensionless relative imports, and JSON imports without an import attribute,
// as the bundler resolves them for the game.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

export async function resolve(specifier, context, next) {
  let target = specifier;
  if (specifier.startsWith('@/')) target = pathToFileURL(path.join(src, specifier.slice(2))).href;
  if ((target.startsWith('.') || target.startsWith('file:')) && context.parentURL?.startsWith('file:')) {
    const file = fileURLToPath(new URL(target, context.parentURL));
    for (const candidate of [file, `${file}.ts`, `${file}.tsx`, path.join(file, 'index.ts')]) {
      if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }
  return next(target, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.json')) {
    return { format: 'module', shortCircuit: true, source: `export default ${await readFile(fileURLToPath(url), 'utf8')};` };
  }
  return next(url, context);
}
