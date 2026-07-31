// One-time maintenance script: copies clinic imagery from the former Tilda CDN
// into version-controlled, compressed local WebP assets.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const site = resolve(root, 'site');
const output = resolve(site, 'assets/images');
const temp = await mkdtemp(resolve(tmpdir(), 'amirdent-images-'));
const extensions = new Set(['.html', '.css', '.js', '.json']);

async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (extensions.has(extname(entry.name))) result.push(path);
  }
  return result;
}

try {
  await mkdir(output, { recursive: true });
  const sourceFiles = await walk(site);
  const contents = new Map();
  const urls = new Set();
  const pattern = /https:\/\/static\.tildacdn\.com\/[^"' )<\\]+/g;
  for (const file of sourceFiles) {
    const text = await readFile(file, 'utf8');
    contents.set(file, text);
    for (const match of text.matchAll(pattern)) urls.add(match[0]);
  }

  const replacements = new Map();
  for (const url of urls) {
    const digest = createHash('sha256').update(url).digest('hex').slice(0, 10);
    const sourcePath = resolve(temp, `${digest}${extname(new URL(url).pathname) || '.img'}`);
    const targetName = `${digest}.webp`;
    const targetPath = resolve(output, targetName);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Cannot download ${url}: ${response.status}`);
    await writeFile(sourcePath, Buffer.from(await response.arrayBuffer()));
    const conversion = spawnSync('cwebp', ['-quiet', '-q', '82', '-metadata', 'none', sourcePath, '-o', targetPath]);
    if (conversion.status !== 0) throw new Error(`cwebp failed for ${url}: ${conversion.stderr}`);
    replacements.set(url, `/assets/images/${targetName}`);
  }

  for (const [file, original] of contents) {
    let next = original;
    for (const [url, local] of replacements) next = next.split(url).join(local);
    if (next !== original) await writeFile(file, next);
  }
  console.log(`Vendored ${replacements.size} images into /assets/images`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
