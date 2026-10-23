// tells — crawl. Fetches every origin in domains.txt, runs the signature
// registry over the response, writes an evidence-bearing snapshot, and diffs
// it against the previous run.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CATEGORY_ORDER,
  describeUnknowns,
  detectSite,
  extractContext,
  fetchSite,
  loadSignatures,
  titleOf,
} from './lib.mjs';

const root = process.cwd();
const dataDir = join(root, 'data');
const day = new Date().toISOString().slice(0, 10);
const CONCURRENCY = 8;

function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  return Promise.all(workers).then(() => results);
}

async function readDomains() {
  const raw = await readFile(join(root, 'domains.txt'), 'utf8');
  const seen = new Set();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const host = trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (host.includes('.')) seen.add(host);
  }
  return [...seen];
}

async function readPreviousSnapshot(excludeDay) {
  let files = [];
  try {
    files = await readdir(join(dataDir, 'snapshots'));
  } catch {
    return null;
  }
  const candidates = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .filter((d) => d < excludeDay)
    .sort();
  if (candidates.length === 0) return null;
  const latest = candidates[candidates.length - 1];
  return JSON.parse(await readFile(join(dataDir, 'snapshots', `${latest}.json`), 'utf8'));
}

function looksChallenged(html) {
  return /just a moment|cf-browser-verification|enable javascript and cookies to continue|attention required/i.test(
    html.slice(0, 4000),
  );
}

const signatures = await loadSignatures(join(root, 'signatures'));
const domains = await readDomains();

console.log(`tells ${day}: ${domains.length} origins, ${signatures.length} signatures`);

let finished = 0;

const pairs = await pool(domains, CONCURRENCY, async (domain) => {
  const response = await fetchSite(domain);
  const context = extractContext(response.headers, response.html);
  const detections = response.ok ? detectSite(signatures, context) : [];
  const html = response.html || '';

  const site = {
    url: `https://${domain}/`,
    final_url: response.final_url,
    status: response.status,
    ok: response.ok,
    ms: response.ms,
    html_bytes: Buffer.byteLength(html),
    title: titleOf(html),
    challenged: response.ok && detections.length === 0 && looksChallenged(html),
    detections,
  };

  if (response.reason) site.reason = response.reason;
  if (!response.ok && [401, 403, 429, 451, 503].includes(response.status)) site.blocked = true;
  if (response.status === 0) site.blocked = false;

  site.unknowns = describeUnknowns(site, detections);
  if (response.ok && !html) {
    site.unknowns.push(`Response was not HTML (${response.content_type || 'unknown content type'})`);
  }

  finished += 1;
  if (finished % 25 === 0 || finished === domains.length) {
    console.log(`  ${finished}/${domains.length}`);
  }

  return [domain, site];
});

const sites = Object.fromEntries(pairs);
const all = Object.values(sites);
const inspected = all.filter((s) => s.ok);

const latest = {
  generated_at: new Date().toISOString(),
  date: day,
  signatures: signatures.length,
  targets: domains.length,
  inspected: inspected.length,
  blocked: all.filter((s) => s.blocked).length,
  challenged: all.filter((s) => s.challenged).length,
  detections: inspected.reduce((total, s) => total + s.detections.length, 0),
  sites,
};

const snapshot = {
  date: day,
  generated_at: latest.generated_at,
  sites: Object.fromEntries(
    Object.entries(sites).map(([domain, site]) => [
      domain,
      { status: site.status, ok: site.ok, stack: site.detections.map((d) => d.id) },
    ]),
  ),
};

const previous = await readPreviousSnapshot(day);
const names = new Map(signatures.map((s) => [s.id, s.name]));
const categories = new Map(signatures.map((s) => [s.id, s.category]));
const changes = [];

if (previous) {
  for (const [domain, current] of Object.entries(snapshot.sites)) {
    const before = previous.sites[domain];
    if (!before || !before.ok || !current.ok) continue;
    const had = new Set(before.stack);
    const has = new Set(current.stack);
    for (const id of has) {
      if (!had.has(id)) {
        changes.push({ domain, kind: 'added', id, name: names.get(id) || id, category: categories.get(id) || 'unknown' });
      }
    }
    for (const id of had) {
      if (!has.has(id)) {
        changes.push({ domain, kind: 'removed', id, name: names.get(id) || id, category: categories.get(id) || 'unknown' });
      }
    }
  }
}

changes.sort((a, b) => a.domain.localeCompare(b.domain) || a.kind.localeCompare(b.kind));

const changeDoc = {
  date: day,
  against: previous ? previous.date : null,
  counts: {
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
    sites: new Set(changes.map((c) => c.domain)).size,
  },
  changes,
};

await mkdir(join(dataDir, 'snapshots'), { recursive: true });
await mkdir(join(dataDir, 'changes'), { recursive: true });

await writeFile(join(dataDir, 'latest.json'), JSON.stringify(latest) + '\n');
await writeFile(join(dataDir, 'snapshots', `${day}.json`), JSON.stringify(snapshot) + '\n');
await writeFile(join(dataDir, 'changes', `${day}.json`), JSON.stringify(changeDoc, null, 2) + '\n');

for (const category of CATEGORY_ORDER) {
  const count = inspected.reduce(
    (total, site) => total + site.detections.filter((d) => d.category === category).length,
    0,
  );
  console.log(`  ${category.padEnd(10)} ${count}`);
}

console.log(
  `done: ${inspected.length}/${domains.length} inspected, ${latest.blocked} blocked, ` +
    `${latest.detections} detections, ${changes.length} changes` +
    (previous ? ` vs ${previous.date}` : ' (no previous snapshot)'),
);
