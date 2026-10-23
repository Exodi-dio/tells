// tells — search the census.
//
// One fetch of a compact index, then a plain array scan on every keystroke.
// No server, no query leaving the browser, no analytics on what you looked up.

const input = document.getElementById('q');
const results = document.getElementById('results');
const hint = document.getElementById('hint');

let index = null;
let names = {};
let pending = null;
let loaded = 0;

const slug = (domain) => domain.replace(/[^a-z0-9.-]/gi, '_');

async function load() {
  if (index) return index;
  if (pending) return pending;
  hint.textContent = 'loading the census index…';
  pending = Promise.all([
    fetch('api/index.json').then((r) => r.json()),
    fetch('api/names.json').then((r) => r.json()),
  ])
    .then(([rows, map]) => {
      index = rows;
      names = map;
      loaded = rows.length;
      hint.textContent = `${loaded.toLocaleString()} domains indexed · nothing leaves your browser`;
      return index;
    })
    .catch(() => {
      hint.textContent = 'could not load the index — reload to try again';
      pending = null;
      return [];
    });
  return pending;
}

function row(domain, ok, ids) {
  const a = document.createElement('a');
  a.href = `sites/${slug(domain)}.html`;

  const d = document.createElement('span');
  d.className = 'd';
  d.textContent = domain;
  a.append(d);

  const stack = ids
    .slice(0, 3)
    .map((id) => names[id] || id)
    .join(' · ');

  const c = document.createElement('span');
  c.className = 'c';
  c.textContent = ok ? stack || 'no tell matched' : 'not inspectable';
  a.append(c);

  return a;
}

function render(query) {
  results.replaceChildren();
  const needle = query.trim().toLowerCase();
  if (!needle || !index) return;

  const hits = [];
  for (const [domain, ok, ids] of index) {
    if (domain.includes(needle)) {
      hits.push([domain, ok, ids]);
      if (hits.length >= 30) break;
    }
  }

  if (hits.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = `No domain matching "${query.trim()}" is in tonight's census. The census covers the top ranked domains; it is not the whole web.`;
    results.append(empty);
    return;
  }

  for (const [domain, ok, ids] of hits) results.append(row(domain, ok, ids));
}

let timer;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await load();
    render(input.value);
  }, 60);
});

input.addEventListener('focus', load, { once: true });

input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const first = results.querySelector('a');
  if (first) window.location.href = first.href;
});

// Deep link: ?q=stripe.com prefills and runs the search, so a lookup is a
// shareable URL.
const preset = new URLSearchParams(window.location.search).get('q');
if (preset) {
  input.value = preset;
  load().then(() => render(preset));
}
