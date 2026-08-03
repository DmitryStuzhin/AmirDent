import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const site = resolve(root, 'site');
const errors = [];

async function files(dir) {
  const result = [];
  for (const name of await readdir(dir)) {
    const path = resolve(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}

const allFiles = await files(site);
const htmlFiles = allFiles.filter((file) => file.endsWith('.html'));
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const name = relative(root, file);
  if (/<a[^>]+href=["']#["']/.test(html)) errors.push(`${name}: empty # link`);
  if (/<form[\s\S]*?<label(?![^>]*\bfor=)/.test(html)) errors.push(`${name}: form label without for`);
  if (
    !/admin\.html$/.test(file) &&
    !/404\.html$/.test(file) &&
    !/mobile\.html$/.test(file) &&
    !/<meta name="description"/.test(html)
  ) {
    errors.push(`${name}: missing description`);
  }
}

const content = JSON.parse(await readFile(resolve(site, 'assets/content.json'), 'utf8'));
const doctorNames = (content.doctors || []).map((doctor) => String(doctor.name || '').trim().toLowerCase());
if (doctorNames.includes('нурик')) errors.push('content.json: test doctor "Нурик" is present');

const names = new Map();
for (const service of content.services || []) {
  const key = String(service.name || service.title || '').trim().toLowerCase();
  if (!key) continue;
  names.set(key, (names.get(key) || 0) + 1);
}
for (const [name, count] of names) {
  if (count > 1) errors.push(`content.json: duplicate service "${name}" (${count})`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${htmlFiles.length} HTML files: OK`);
}
