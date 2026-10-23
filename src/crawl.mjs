// tells — crawl one shard of the night's list.
//
// The census is too big for one runner, so the workflow splits it: each shard
// takes every Nth domain (round-robin, so the famous sites spread across
// shards instead of hammering one CDN from one machine) and writes a shard
// file. merge.mjs is the only thing that sees the whole night.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const day = new Date().toISOString().slice(0, 10);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const shard = Number(arg('shard', 0));
const shards = Number(arg('shards', 1));
const domainFile = arg('domains', join(root, 'cache', 'domains.txt'));
const concurrency = Number(process.env.CRAWL_CONCURRENCY || 16);

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

function looksChallenged(html) {
  return /just a moment|cf-browser-verification|enable javascript and cookies to continue|attention required/i.test(
    html.slice(0, 4000),
  );
}

const raw = await readFile(domainFile, 'utf8');
const all = raw.split('\n').map((line) => line.trim()).filter(Boolean);
const mine = all.filter((_, index) => index % shards === shard);

const signatures = await loadSignatures(join(root, 'signatures'));

console.log(
  `shard ${shard + 1}/${shards}: ${mine.length} of ${all.length} domains, ${signatures.length} signatures`,
);

let finished = 0;
const started = Date.now();

const pairs = await pool(mine, concurrency, async (domain) => {
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

  site.unknowns = describeUnknowns(site, detections);
  if (response.ok && !html) {
    site.unknowns.push(`Response was not HTML (${response.content_type || 'unknown content type'})`);
  }

  finished += 1;
  if (finished % 100 === 0 || finished === mine.length) {
    const rate = finished / Math.max(1, (Date.now() - started) / 1000);
    console.log(`  ${finished}/${mine.length}  ${rate.toFixed(1)}/s`);
  }

  return [domain, site];
});

const sites = Object.fromEntries(pairs);
const values = Object.values(sites);
const inspected = values.filter((s) => s.ok);

const payload = {
  shard,
  shards,
  day,
  sites,
  stats: {
    targets: mine.length,
    inspected: inspected.length,
    blocked: values.filter((s) => s.blocked).length,
    challenged: values.filter((s) => s.challenged).length,
    detections: inspected.reduce((total, s) => total + s.detections.length, 0),
    elapsed_ms: Date.now() - started,
  },
};

await mkdir(join(root, 'cache'), { recursive: true });
await writeFile(join(root, 'cache', `shard-${shard}.json`), JSON.stringify(payload));

for (const category of CATEGORY_ORDER) {
  const count = inspected.reduce(
    (total, site) => total + site.detections.filter((d) => d.category === category).length,
    0,
  );
  if (count) console.log(`  ${category.padEnd(10)} ${count}`);
}

console.log(
  `shard ${shard + 1}/${shards} done: ${inspected.length}/${mine.length} inspected, ` +
    `${payload.stats.detections} detections in ${(payload.stats.elapsed_ms / 1000).toFixed(0)}s`,
);
