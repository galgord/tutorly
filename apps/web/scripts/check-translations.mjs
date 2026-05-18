#!/usr/bin/env node
// Translation completeness check: every key in en/common.json must also exist
// in pt/common.json AND he/common.json. Run as `node scripts/check-translations.mjs`.
// Exit code 0 = ok, 1 = missing keys.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, '..', 'src', 'locales');

const en = JSON.parse(readFileSync(join(base, 'en', 'common.json'), 'utf8'));
const pt = JSON.parse(readFileSync(join(base, 'pt', 'common.json'), 'utf8'));
const he = JSON.parse(readFileSync(join(base, 'he', 'common.json'), 'utf8'));

function collectKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...collectKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function get(obj, path) {
  return path.split('.').reduce((acc, p) => (acc == null ? undefined : acc[p]), obj);
}

const enKeys = collectKeys(en);
const missing = { pt: [], he: [] };
for (const k of enKeys) {
  if (get(pt, k) === undefined) missing.pt.push(k);
  if (get(he, k) === undefined) missing.he.push(k);
}

const totalMissing = missing.pt.length + missing.he.length;
if (totalMissing === 0) {
  console.log(`translations ok — ${enKeys.length} keys in en, all present in pt + he`);
  process.exit(0);
}

console.error(`translation gaps detected:`);
if (missing.pt.length) console.error(`  pt missing (${missing.pt.length}): ${missing.pt.join(', ')}`);
if (missing.he.length) console.error(`  he missing (${missing.he.length}): ${missing.he.join(', ')}`);
process.exit(1);
