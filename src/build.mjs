// tells — static site builder. Turns data/latest.json and the change log into
// a set of plain HTML pages. No framework, no client-side JavaScript.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CATEGORY_ORDER, esc, slug } from './lib.mjs';

const root = process.cwd();
const dist = join(root, 'dist');
const REPO = 'https://github.com/Exodi-dio/tells';
const DOCS = 'https://github.com/Exodi-dio/tells#method';

const LABEL = { cms: 'CMS' };
const label = (category) => LABEL[category] || category.charAt(0).toUpperCase() + category.slice(1);

const dateLabel = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const shortDate = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function bytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

const CSS = `
:root{--bg:#0a0b0d;--panel:#111318;--panel2:#161920;--line:#232733;--text:#e7e9ef;--muted:#8d94a6;--dim:#5f6675;--add:#7ee787;--rem:#ff7b72;--accent:#8ab4ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Inter,sans-serif;background-image:radial-gradient(900px 420px at 50% -180px,#1b2333 0%,transparent 70%)}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header.site{border-bottom:1px solid var(--line);background:rgba(10,11,13,.85);backdrop-filter:blur(8px);position:sticky;top:0;z-index:5}
header.site .wrap{display:flex;align-items:center;gap:18px;height:52px}
.brand{font-family:ui-monospace,monospace;font-weight:600;color:var(--text);font-size:15px;letter-spacing:-.02em}
nav{margin-left:auto;display:flex;gap:16px;font-size:13px}
nav a{color:var(--muted)}
.hero{margin:60px 0 0}
.hero h1{font-size:clamp(29px,5vw,44px);line-height:1.08;letter-spacing:-.035em;margin:0;font-weight:650}
.hero h1 em{font-style:normal;color:var(--dim)}
.sub{color:var(--muted);max-width:64ch;margin:16px 0 0;font-size:15.5px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:34px 0 6px}
.stat{background:var(--panel);padding:15px 16px}
.stat b{display:block;font:600 23px/1.15 ui-monospace,monospace}
.stat span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}
h2{font-size:12.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:44px 0 12px;font-weight:600}
.changes{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}
.changes li{display:flex;gap:12px;align-items:baseline;padding:9px 2px;border-bottom:1px solid var(--line);font-size:14px}
.changes .day{color:var(--dim);font:12px ui-monospace,monospace;width:52px;flex:none}
.changes .dom{font-weight:500;min-width:170px;color:var(--text)}
.tag{font:11px ui-monospace,monospace;padding:1px 6px;border-radius:4px;border:1px solid;white-space:nowrap}
.tag.add{color:var(--add);border-color:#2b4a33;background:#101a13}
.tag.rem{color:var(--rem);border-color:#4a2b2e;background:#1a1011}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:13px 14px;display:block;color:var(--text)}
.card:hover{border-color:#39405a;text-decoration:none}
.card .d{font:13px ui-monospace,monospace;font-weight:600;display:flex;align-items:center;gap:7px;word-break:break-all}
.card .t{font-size:12px;color:var(--dim);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:9px}
.chip{font:11px ui-monospace,monospace;color:var(--muted);background:var(--panel2);border:1px solid var(--line);border-radius:4px;padding:1px 5px}
.dot{width:6px;height:6px;border-radius:50%;background:var(--rem);flex:none}
.dot.ok{background:var(--add)}
.pill{font:11px ui-monospace,monospace;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.back{font:12px ui-monospace,monospace;color:var(--muted);display:inline-block;margin:34px 0 8px}
h1.name{font:600 clamp(23px,4vw,33px)/1.15 ui-monospace,monospace;letter-spacing:-.02em;margin:0 0 8px;word-break:break-all}
.meta{color:var(--dim);font:12px ui-monospace,monospace;margin:0 0 6px}
h3{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim);margin:26px 0 8px}
.det{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:11px 14px;margin-bottom:8px}
.det-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.det-h strong{font-size:15px}
.ver{font:11px ui-monospace,monospace;color:var(--muted)}
.conf{font:11px ui-monospace,monospace;padding:1px 6px;border-radius:4px;border:1px solid}
.conf.high{color:var(--add);background:#101a13;border-color:#2b4a33}
.conf.medium{color:#e3b341;background:#1a170e;border-color:#4a3c1a}
.conf.low{color:var(--muted);background:var(--panel2);border-color:var(--line)}
details{margin-top:7px}
summary{cursor:pointer;font-size:12px;color:var(--muted)}
details ul{margin:8px 0 0;padding-left:18px;font:11.5px/1.7 ui-monospace,monospace;color:var(--muted)}
details li{margin:2px 0;word-break:break-all}
.unk{background:#141009;border:1px solid #3a2c14;border-radius:10px;padding:14px 18px;margin-top:30px}
.unk h2{margin:0 0 8px;color:#e3b341}
.unk ul{margin:0;padding-left:18px;color:#c9a94e;font-size:13px}
footer{border-top:1px solid var(--line);margin-top:64px;padding:26px 0 60px;color:var(--dim);font-size:12.5px}
footer p{max-width:74ch}
.empty{color:var(--dim);font-size:13.5px;padding:14px 0}
@media(max-width:640px){.stats{grid-template-columns:repeat(2,1fr)}.changes .dom{min-width:0;flex:1}}
`;

const FOOTER = `
<h2 style="color:var(--muted)">Method</h2>
<p><b>What we do.</b> Once a night, GitHub Actions fetches each origin in
<code>domains.txt</code> over HTTPS with an identifying user agent, a 20&nbsp;second timeout and a 3&nbsp;MB body cap.
We read the response headers, <code>Set-Cookie</code> names, script URLs, meta tags and markup, then run an
open signature registry over them. We never execute the page's JavaScript, never log in, and never store the page itself.</p>
<p><b>What the confidence means.</b> <span class="conf high">high</span> comes from a server header, a cookie name or a
script URL. <span class="conf medium">medium</span> is a markup heuristic. <span class="conf low">low</span> is a hint
that could be coincidence. Every claim lists the exact string that produced it.</p>
<p><b>What we cannot see.</b> Sites that block bots are published as blocked, not as empty. A site with no matching
signature is not necessarily custom-built — only unmatched. Absence of evidence is never reported as evidence of absence.</p>
`;

function shell({ title, body, prefix = '', description }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(
    description ||
      'A nightly public survey of how well-known websites are built, with the evidence for every claim.',
  )}">
<style>${CSS}</style>
</head>
<body>
<header class="site"><div class="wrap">
<a class="brand" href="${prefix}index.html">tells</a>
<nav>
<a href="${prefix}index.html">survey</a>
<a href="${prefix}changes.html">changelog</a>
<a href="${REPO}">github</a>
</nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">${FOOTER}</div></footer>
</body>
</html>`;
}

function evidenceList(evidence) {
  const items = evidence.map((e) => `<li><code>${esc(e.detail)}</code></li>`).join('');
  const count = evidence.length;
  return `<details><summary>${count} piece${count === 1 ? '' : 's'} of evidence</summary><ul>${items}</ul></details>`;
}

function chipNames(site) {
  const order = ['framework', 'cms', 'hosting', 'analytics', 'ecommerce', 'payments'];
  const names = [];
  for (const category of order) {
    const hit = site.detections.find((d) => d.category === category);
    if (hit) names.push(hit.name);
  }
  return names.slice(0, 4);
}

function renderIndex(latest, changeDocs) {
  const sites = Object.entries(latest.sites).sort(([a], [b]) => a.localeCompare(b));
  const recent = [];
  for (const doc of changeDocs) {
    for (const change of doc.changes) recent.push({ ...change, date: doc.date });
    if (recent.length >= 18) break;
  }

  const changesHtml = recent.length
    ? `<ul class="changes">${recent
        .slice(0, 18)
        .map(
          (c) => `<li><span class="day">${esc(shortDate(c.date))}</span>
<a class="dom" href="sites/${esc(slug(c.domain))}.html">${esc(c.domain)}</a>
<span class="tag ${c.kind === 'added' ? 'add' : 'rem'}">${c.kind === 'added' ? '+' : '−'} ${esc(c.name)}</span></li>`,
        )
        .join('')}</ul>`
    : `<p class="empty">No changes recorded yet. The first diff appears on the second nightly run.</p>`;

  const cards = sites
    .map(([domain, site]) => {
      const chips = chipNames(site)
        .map((name) => `<span class="chip">${esc(name)}</span>`)
        .join('');
      const dot = site.ok ? 'ok' : '';
      const title = site.title ? esc(site.title) : site.ok ? 'no title' : esc(site.reason || 'unreachable');
      return `<a class="card" href="sites/${esc(slug(domain))}.html">
<div class="d"><span class="dot ${dot}"></span>${esc(domain)}</div>
<div class="t">${title}</div>
<div class="chips">${chips}</div></a>`;
    })
    .join('\n');

  const body = `
<section class="hero">
<h1>Every site has tells.<br><em>We publish them, with receipts.</em></h1>
<p class="sub">A nightly, public survey of how ${latest.targets} well-known sites are built. Every detection
cites the header, cookie, script URL or markup that proves it — and everything we could not prove is
labelled as unknown.</p>
</section>

<div class="stats">
<div class="stat"><b>${latest.targets}</b><span>sites surveyed</span></div>
<div class="stat"><b>${latest.inspected}</b><span>inspected</span></div>
<div class="stat"><b>${latest.detections}</b><span>detections</span></div>
<div class="stat"><b>${latest.blocked}</b><span>blocked</span></div>
</div>
<p class="meta">Last run ${esc(dateLabel(latest.date))} · ${latest.signatures} signatures · ${latest.challenged} bot challenges</p>

<h2>Changed recently</h2>
${changesHtml}

<h2>Survey</h2>
<div class="grid">
${cards}
</div>`;

  return shell({ title: 'tells — the web, with receipts', body });
}

function renderSite(domain, site, changeDocs) {
  const grouped = new Map();
  for (const detection of site.detections) {
    if (!grouped.has(detection.category)) grouped.set(detection.category, []);
    grouped.get(detection.category).push(detection);
  }

  const sections = CATEGORY_ORDER.filter((c) => grouped.has(c))
    .map((category) => {
      const items = grouped
        .get(category)
        .map((d) => {
          const bits = [`<strong>${esc(d.name)}</strong>`];
          if (d.version) bits.push(`<span class="ver">${esc(d.version)}</span>`);
          bits.push(`<span class="conf ${esc(d.confidence)}">${esc(d.confidence)} confidence</span>`);
          if (d.website) bits.push(`<a href="${esc(d.website)}" rel="nofollow">↗</a>`);
          return `<div class="det"><div class="det-h">${bits.join(' ')}</div>${evidenceList(d.evidence)}</div>`;
        })
        .join('');
      return `<h3>${esc(label(category))}</h3>${items}`;
    })
    .join('');

  const stack = sections || `<p class="empty">No signature matched. That is not proof of a custom build — only that this registry has no rule for it yet.</p>`;

  const unknowns = site.unknowns && site.unknowns.length
    ? `<section class="unk"><h2>What we could not prove</h2><ul>${site.unknowns
        .map((u) => `<li>${esc(u)}</li>`)
        .join('')}</ul></section>`
    : '';

  const history = [];
  for (const doc of changeDocs) {
    for (const change of doc.changes) {
      if (change.domain === domain) history.push({ ...change, date: doc.date });
    }
  }
  const historyHtml = history.length
    ? `<h2>Observed changes</h2><ul class="changes">${history
        .slice(0, 20)
        .map(
          (c) => `<li><span class="day">${esc(shortDate(c.date))}</span>
<span class="tag ${c.kind === 'added' ? 'add' : 'rem'}">${c.kind === 'added' ? '+' : '−'} ${esc(c.name)}</span>
<span class="meta" style="margin:0">${esc(label(c.category))}</span></li>`,
        )
        .join('')}</ul>`
    : '';

  const status = site.ok
    ? `<span class="pill">HTTP ${site.status}</span>`
    : `<span class="pill">${esc(site.reason || 'HTTP ' + site.status)}</span>`;

  const body = `
<a class="back" href="../index.html">← all sites</a>
<h1 class="name">${esc(domain)}</h1>
<p class="meta">${status} · ${bytes(site.html_bytes)} of HTML · ${site.ms} ms${
    site.final_url && !site.final_url.includes('//' + domain + '/') ? ` · served from ${esc(site.final_url)}` : ''
  }</p>

<h2>What it is built with</h2>
${stack}
${unknowns}
${historyHtml}`;

  return shell({
    title: `${domain} — tells`,
    body,
    prefix: '../',
    description: `Stack, hosting and measurement tools observed on ${domain}, with the evidence for each detection.`,
  });
}

function renderChanges(changeDocs) {
  const blocks = changeDocs
    .filter((doc) => doc.changes.length > 0)
    .map((doc) => {
      const rows = doc.changes
        .map(
          (c) => `<li><a class="dom" href="sites/${esc(slug(c.domain))}.html">${esc(c.domain)}</a>
<span class="tag ${c.kind === 'added' ? 'add' : 'rem'}">${c.kind === 'added' ? '+' : '−'} ${esc(c.name)}</span>
<span class="meta" style="margin:0">${esc(label(c.category))}</span></li>`,
        )
        .join('');
      return `<h2>${esc(dateLabel(doc.date))} ${
        doc.against ? `<span style="color:var(--dim);text-transform:none;letter-spacing:0">vs ${esc(doc.against)}</span>` : ''
      }</h2>
<p class="meta">${doc.counts.added} added · ${doc.counts.removed} removed · ${doc.counts.sites} sites</p>
<ul class="changes">${rows}</ul>`;
    })
    .join('');

  const body = `
<section class="hero"><h1>Changelog<em> — what the web changed.</em></h1>
<p class="sub">Each night's diff against the previous snapshot. A removal means a tell stopped appearing,
not necessarily that the software was removed.</p></section>
${blocks || '<p class="empty">No diffs yet.</p>'}`;

  return shell({ title: 'changelog — tells', body, description: 'Nightly diffs of how well-known websites are built.' });
}

const latest = JSON.parse(await readFile(join(root, 'data', 'latest.json'), 'utf8'));

let changeDocs = [];
try {
  const files = (await readdir(join(root, 'data', 'changes'))).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const file of files) {
    changeDocs.push(JSON.parse(await readFile(join(root, 'data', 'changes', file), 'utf8')));
  }
} catch {
  changeDocs = [];
}

await mkdir(join(dist, 'sites'), { recursive: true });
await mkdir(join(dist, 'api'), { recursive: true });

// At census scale we cannot ship a page for every domain: 25k pages of
// template would blow past what Pages will serve comfortably. So the site
// carries a page for the sites with the most to show plus anything that
// changed tonight — and the dataset keeps everything either way.
const PAGE_CAP = Number(process.env.SITE_PAGE_CAP || 3000);
const changedDomains = new Set(changeDocs.flatMap((doc) => doc.changes.map((c) => c.domain)));
const pageSites = new Map(
  Object.entries(latest.sites)
    .filter(([, site]) => site.detections.length > 0)
    .sort((a, b) => b[1].detections.length - a[1].detections.length)
    .slice(0, PAGE_CAP),
);
for (const domain of changedDomains) {
  if (latest.sites[domain]) pageSites.set(domain, latest.sites[domain]);
}

const linked = { ...latest, sites: Object.fromEntries(pageSites) };

await writeFile(join(dist, 'index.html'), renderIndex(linked, changeDocs));
await writeFile(join(dist, 'changes.html'), renderChanges(changeDocs));

for (const [domain, site] of pageSites) {
  await writeFile(join(dist, 'sites', `${slug(domain)}.html`), renderSite(domain, site, changeDocs));
}

await writeFile(join(dist, 'api', 'latest.json'), JSON.stringify(latest) + '\n');
await writeFile(join(dist, 'api', 'changes.json'), JSON.stringify(changeDocs) + '\n');
await writeFile(join(dist, '.nojekyll'), '');

console.log(
  `built ${Object.keys(latest.sites).length} site pages, ${changeDocs.length} change docs -> dist/`,
);
