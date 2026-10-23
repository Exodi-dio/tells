// tells — detection core. No dependencies, on purpose: an auditor can read
// every line that decides what we claim about a website.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const UA = 'tells/0.1 (+https://github.com/Exodi-dio/tells; public web survey)';
export const MAX_BYTES = 3_000_000;

export const CATEGORY_ORDER = [
  'framework',
  'cms',
  'hosting',
  'analytics',
  'ecommerce',
  'payments',
  'fonts',
  'consent',
];

// Categories where "nothing matched" is worth saying out loud.
export const CORE_CATEGORIES = ['framework', 'cms', 'hosting', 'analytics'];

const RANK = { low: 1, medium: 2, high: 3 };

const regexCache = new Map();
function test(pattern, text) {
  if (!pattern) return false;
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern, 'i');
    regexCache.set(pattern, re);
  }
  return re.test(text);
}

export function clip(value, max = 160) {
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function loadSignatures(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const signatures = [];
  const seen = new Map();

  for (const file of files) {
    const raw = JSON.parse(await readFile(join(dir, file), 'utf8'));
    const category = raw.category;
    if (!category) throw new Error(`${file}: missing top-level "category"`);
    if (!Array.isArray(raw.signatures)) throw new Error(`${file}: missing "signatures" array`);

    for (const sig of raw.signatures) {
      if (!sig.id || !sig.name) throw new Error(`${file}: signature needs id and name`);
      if (!Array.isArray(sig.rules) || sig.rules.length === 0) {
        throw new Error(`${file}: signature "${sig.id}" has no rules`);
      }
      for (const rule of sig.rules) {
        if (!rule.type) throw new Error(`${file}: signature "${sig.id}" has a rule with no type`);
      }
      if (seen.has(sig.id)) {
        throw new Error(`duplicate signature id "${sig.id}" in ${file} and ${seen.get(sig.id)}`);
      }
      seen.set(sig.id, file);
      signatures.push({ ...sig, category: sig.category || category, file });
    }
  }
  return signatures;
}

export function extractContext(headers, html) {
  const headerMap = {};
  const entries = typeof headers.entries === 'function' ? [...headers.entries()] : Object.entries(headers);
  for (const [key, value] of entries) headerMap[String(key).toLowerCase()] = String(value);

  const cookieLines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const cookies = [];
  for (const line of cookieLines) {
    const pair = String(line).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.push({ name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1) });
  }

  const scripts = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) scripts.push(m[1]);

  const metas = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /\b(?:name|property|http-equiv)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (name && content) metas[name[1].toLowerCase()] = content[1];
  }

  return { headers: headerMap, cookies, scripts, metas, html };
}

export function matchRule(rule, ctx) {
  const confidence = rule.confidence || 'medium';

  if (rule.type === 'header') {
    const value = ctx.headers[String(rule.name).toLowerCase()];
    if (value === undefined) return null;
    if (rule.pattern && !test(rule.pattern, value)) return null;
    return { kind: 'header', detail: `${rule.name.toLowerCase()}: ${clip(value)}`, confidence };
  }

  if (rule.type === 'cookie') {
    const hit = ctx.cookies.find((c) =>
      rule.pattern ? test(rule.pattern, c.name) : c.name.toLowerCase() === String(rule.name).toLowerCase(),
    );
    if (!hit) return null;
    return { kind: 'cookie', detail: `cookie ${hit.name}=${clip(hit.value, 40)}`, confidence };
  }

  if (rule.type === 'script') {
    const hit = ctx.scripts.find((src) => test(rule.pattern, src));
    if (!hit) return null;
    return { kind: 'script', detail: `script ${clip(hit, 120)}`, confidence };
  }

  if (rule.type === 'html') {
    const hit = new RegExp(rule.pattern, 'i').exec(ctx.html);
    if (!hit) return null;
    return { kind: 'html', detail: `markup ${clip(hit[0], 120)}`, confidence };
  }

  if (rule.type === 'meta') {
    const value = ctx.metas[String(rule.name).toLowerCase()];
    if (value === undefined) return null;
    if (rule.pattern && !test(rule.pattern, value)) return null;
    return { kind: 'meta', detail: `meta ${rule.name.toLowerCase()}: ${clip(value)}`, confidence };
  }

  throw new Error(`unknown rule type "${rule.type}"`);
}

export function detectSite(signatures, ctx) {
  const found = [];

  for (const sig of signatures) {
    const evidence = [];
    let best = null;

    for (const rule of sig.rules) {
      const match = matchRule(rule, ctx);
      if (!match) continue;
      evidence.push(match);
      if (!best || RANK[match.confidence] > RANK[best]) best = match.confidence;
    }

    if (evidence.length === 0) continue;

    const detection = {
      id: sig.id,
      name: sig.name,
      category: sig.category,
      confidence: best,
      evidence,
    };
    if (sig.website) detection.website = sig.website;

    if (sig.version) {
      const haystack = evidence.map((e) => e.detail).join('\n');
      const m = new RegExp(sig.version).exec(haystack);
      if (m && m[1]) detection.version = m[1];
    }

    found.push(detection);
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function describeUnknowns(site, detections) {
  const notes = [];

  if (!site.ok) {
    notes.push(`Not inspected: ${site.reason || 'request failed'}`);
    if (site.blocked) notes.push('Blocked by bot protection — absence of detections here means nothing');
    return notes;
  }

  if (site.challenged) {
    notes.push('Server returned a bot-challenge page, not the real site — detections are unreliable');
  }

  for (const category of CORE_CATEGORIES) {
    if (!detections.some((d) => d.category === category)) {
      notes.push(`No ${category} signature matched`);
    }
  }

  if (site.html_bytes < 2048) {
    notes.push('Response was under 2 KB — too small to trust');
  }

  return notes;
}

export function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return clip(m[1].replace(/\s+/g, ' ').trim(), 120) || null;
}

export function slug(domain) {
  return domain.replace(/[^a-z0-9.-]/gi, '_');
}

async function readCapped(response, max) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(Buffer.from(value));
    if (total >= max) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchSite(domain) {
  const url = `https://${domain}`;
  const started = Date.now();

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });

    const contentType = response.headers.get('content-type') || '';
    let html = '';

    if (/text\/html|application\/xhtml/i.test(contentType)) {
      html = await readCapped(response, MAX_BYTES);
    } else if (response.body) {
      await response.body.cancel().catch(() => {});
    }

    return {
      ok: response.ok,
      status: response.status,
      final_url: response.url,
      content_type: contentType,
      headers: response.headers,
      html,
      ms: Date.now() - started,
    };
  } catch (error) {
    const name = error && error.name;
    return {
      ok: false,
      status: 0,
      final_url: url,
      content_type: '',
      headers: new Headers(),
      html: '',
      ms: Date.now() - started,
      reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout after 20s' : String((error && error.message) || error),
    };
  }
}
