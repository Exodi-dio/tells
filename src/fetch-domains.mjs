// tells — resolve the night's domain list.
//
// We deliberately do not ship a frozen list in the repo. A census is only
// worth reading if the population is today's population, so this asks a
// public ranking service what the web looks like now, and falls back to a
// second source if the first is down. Whichever one wins is recorded in
// data/latest.json so every published number can be traced back to a list.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const target = Number(process.env.TARGET_DOMAINS || 25000);
const UA = 'tells/0.1 (+https://github.com/Exodi-dio/tells; public web survey)';

const timeout = (ms) => AbortSignal.timeout(ms);

async function get(url, ms = 120_000) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    signal: timeout(ms),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  return response;
}

// Tranco: research-grade, daily, no key, no signup.
async function tranco() {
  const meta = await (await get('https://tranco-list.eu/api/lists/date/latest', 30_000)).json();
  const csv = await (await get(meta.download, 180_000)).text();
  return { source: 'tranco', list: meta.list_id, csv };
}

// Majestic Million: the boring fallback that has never moved.
async function majestic() {
  const csv = await (await get('https://downloads.majestic.com/majestic_million.csv', 180_000)).text();
  return { source: 'majestic', list: 'majestic-million', csv };
}

function parseCsv(csv, limit) {
  const domains = [];
  const seen = new Set();
  const lines = csv.split('\n');

  for (let i = 0; i < lines.length && domains.length < limit; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',');
    if (i === 0 && /rank|domain|global/i.test(line)) continue;

    // Rank first, name last: holds for Tranco ("1,google.com") and Majestic
    // ("1,1,google.com,0.0,...").
    const host = (cells[cells.length - 1] || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host || !host.includes('.') || host.includes(' ') || seen.has(host)) continue;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;            // bare IPs are not sites
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) continue;       // reject junk and punycode noise
    seen.add(host);
    domains.push(host);
  }

  return domains;
}

let resolved;
try {
  resolved = await tranco();
  console.log(`list: tranco ${resolved.list}`);
} catch (error) {
  console.warn(`tranco unavailable (${error.message}); falling back to majestic`);
  resolved = await majestic();
  console.log(`list: ${resolved.source}`);
}

const domains = parseCsv(resolved.csv, target);
if (domains.length < target * 0.5) {
  throw new Error(`only parsed ${domains.length} domains, refusing to publish a partial census`);
}

const payload = {
  generated_at: new Date().toISOString(),
  source: resolved.source,
  list: resolved.list,
  requested: target,
  domains,
};

await mkdir(join(root, '.cache'), { recursive: true });
await writeFile(join(root, '.cache', 'domains.json'), JSON.stringify(payload));
await writeFile(join(root, '.cache', 'domains.txt'), domains.join('\n') + '\n');

console.log(`resolved ${domains.length} domains from ${resolved.source}`);
console.log(`  first: ${domains.slice(0, 5).join(', ')}`);
