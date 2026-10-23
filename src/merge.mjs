// tells — merge the night's shards into one snapshot.
//
// This is the only place that knows what the whole web looked like tonight,
// so it is also the only place allowed to claim that something changed.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSignatures } from './lib.mjs';

const root = process.cwd();
const dataDir = join(root, 'data');
const cache = join(root, 'cache');
const day = new Date().toISOString().slice(0, 10);

const signatures = await loadSignatures(join(root, 'signatures'));
const names = new Map(signatures.map((s) => [s.id, s.name]));
const categories = new Map(signatures.map((s) => [s.id, s.category]));

async function readShards() {
  let files = [];
  try {
    files = (await readdir(cache)).filter((f) => /^shard-\d+\.json$/.test(f));
  } catch {
    throw new Error('no shard files found — did the crawl jobs upload anything?');
  }
  if (files.length === 0) throw new Error('no shard files found in cache');

  const payloads = [];
  for (const file of files.sort()) {
    payloads.push(JSON.parse(await readFile(join(cache, file), 'utf8')));
  }
  return payloads;
}

async function readDomainSource() {
  try {
    const meta = JSON.parse(await readFile(join(cache, 'domains.json'), 'utf8'));
    return { source: meta.source, list: meta.list, generated_at: meta.generated_at };
  } catch {
    return { source: 'unknown', list: 'unknown' };
  }
}

async function readPreviousSnapshot(excludeDay) {
  let files = [];
  try {
    files = await readdir(join(dataDir, 'snapshots'));
  } catch {
    return null;
  }
  const candidates = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .map((f) => f.slice(0, 10))
    .filter((d) => d < excludeDay)
    .sort();
  if (candidates.length === 0) return null;

  const latest = candidates[candidates.length - 1];
  const text = await readFile(join(dataDir, 'snapshots', `${latest}.jsonl`), 'utf8');
  const sites = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line);
    sites.set(row.d, { status: row.s, ok: Boolean(row.o), stack: row.k });
  }
  return { date: latest, sites };
}

const shards = await readShards();
const sites = {};
const stats = { targets: 0, inspected: 0, blocked: 0, challenged: 0, detections: 0, elapsed_ms: 0 };

for (const shard of shards) {
  Object.assign(sites, shard.sites);
  for (const key of Object.keys(stats)) stats[key] += shard.stats[key] ? shard.stats[key] : 0;
}

const values = Object.values(sites);
const inspected = values.filter((s) => s.ok);
const source = await readDomainSource();

// How often does each signature fire? A rule that matches a large share of
// the web is not necessarily wrong (Cloudflare really is everywhere), but it
// is never taken on faith — the site shows reach next to every signature.
const reached = new Map();
for (const site of inspected) {
  for (const detection of site.detections) {
    reached.set(detection.id, (reached.get(detection.id) || 0) + 1);
  }
}
const health = [...reached.entries()]
  .map(([id, count]) => ({
    id,
    name: names.get(id) || id,
    category: categories.get(id) || 'unknown',
    sites: count,
    share: Number((count / Math.max(1, inspected.length)).toFixed(3)),
  }))
  .sort((a, b) => b.sites - a.sites);

const byCategory = {};
for (const site of inspected) {
  for (const detection of site.detections) {
    const bucket = (byCategory[detection.category] ||= {});
    bucket[detection.id] = (bucket[detection.id] || 0) + 1;
  }
}

const aggregates = Object.entries(byCategory).map(([category, counts]) => ({
  category,
  leaders: Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, sites]) => ({ id, name: names.get(id) || id, sites, share: Number((sites / inspected.length).toFixed(3)) })),
}));

const latest = {
  generated_at: new Date().toISOString(),
  date: day,
  list: source,
  signatures: signatures.length,
  targets: values.length,
  inspected: inspected.length,
  blocked: values.filter((s) => s.blocked).length,
  challenged: values.filter((s) => s.challenged).length,
  detections: inspected.reduce((total, s) => total + s.detections.length, 0),
  elapsed_ms: stats.elapsed_ms,
  health,
  aggregates,
  sites,
};

// The committed history is deliberately tiny: one line per domain, no
// evidence. At 25k domains that is under 2 MB a night, and it is the only
// thing that has to survive for the diff feed to work. Full receipts are
// rebuilt into dist/ on every run and never committed.
const snapshotLines = Object.entries(sites).map(([domain, site]) =>
  JSON.stringify({
    d: domain,
    s: site.status,
    o: site.ok ? 1 : 0,
    k: site.detections.map((d) => d.id),
  }),
);

const previous = await readPreviousSnapshot(day);
const changes = [];

if (previous) {
  for (const [domain, site] of Object.entries(sites)) {
    const before = previous.get(domain);
    if (!before || !before.ok || !site.ok) continue;
    const had = new Set(before.stack);
    const has = new Set(site.detections.map((d) => d.id));
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
await writeFile(join(dataDir, 'snapshots', `${day}.jsonl`), snapshotLines.join('\n') + '\n');
await writeFile(join(dataDir, 'changes', `${day}.json`), JSON.stringify(changeDoc, null, 2) + '\n');

const share = (count) => `${((count / Math.max(1, inspected.length)) * 100).toFixed(1)}%`;

console.log(
  `merged ${shards.length} shards: ${inspected.length}/${values.length} inspected, ` +
    `${latest.blocked} blocked, ${latest.detections} detections`,
);
console.log(`source: ${source.source} ${source.list}`);
console.log(
  `changes: ${changeDoc.counts.sites} sites, +${changeDoc.counts.added}/-${changeDoc.counts.removed}` +
    (previous ? ` vs ${previous.date}` : ' (no previous snapshot)'),
);
console.log('most widespread:');
for (const row of health.slice(0, 8)) {
  console.log(`  ${row.name.padEnd(24)} ${String(row.sites).padStart(6)}  ${share(row.sites)}`);
}
