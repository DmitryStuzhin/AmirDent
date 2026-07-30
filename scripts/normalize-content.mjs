// Removes legacy duplicated representations and obvious test data from a CMS snapshot.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve(import.meta.dirname, '../site/assets/content.json');
const content = JSON.parse(await readFile(file, 'utf8'));
const seen = new Set();
content.services = (content.services || []).filter((service) => {
  const key = [
    String(service.name || service.title || '').trim().toLowerCase(),
    String(service.cat || '').trim().toLowerCase(),
    String(service.price || '').trim().toLowerCase(),
  ].join('|');
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
});
content.doctors = (content.doctors || []).filter(
  (doctor) => String(doctor.name || '').trim().toLowerCase() !== 'нурик'
);
delete content.priceHtml;
content.v = Math.max(5, Number(content.v) || 0);
await writeFile(file, `${JSON.stringify(content, null, 2)}\n`);
console.log(`Normalized ${content.services.length} services and ${content.doctors.length} doctors`);
