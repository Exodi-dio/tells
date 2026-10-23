import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUnknowns, detectSite, extractContext } from '../src/lib.mjs';

const signatures = [
  {
    id: 'nextjs',
    name: 'Next.js',
    category: 'framework',
    rules: [
      { type: 'header', name: 'x-powered-by', pattern: '^Next\\.js', confidence: 'high' },
      { type: 'script', pattern: '/_next/static/', confidence: 'high' },
      { type: 'html', pattern: 'id="__next"', confidence: 'medium' },
    ],
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'cms',
    rules: [{ type: 'meta', name: 'generator', pattern: '^WordPress', confidence: 'high' }],
    version: 'WordPress\\s*([0-9.]+)',
  },
  {
    id: 'plausible',
    name: 'Plausible',
    category: 'analytics',
    rules: [{ type: 'script', pattern: 'plausible\\.io/js/', confidence: 'high' }],
  },
  {
    id: 'laravel',
    name: 'Laravel',
    category: 'framework',
    rules: [{ type: 'cookie', name: 'laravel_session', confidence: 'high' }],
  },
];

const detect = (html, headers = new Headers()) => detectSite(signatures, extractContext(headers, html));

test('a server header is enough, with high confidence', () => {
  const headers = new Headers({ 'x-powered-by': 'Next.js' });
  const found = detect('<html></html>', headers);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'nextjs');
  assert.equal(found[0].confidence, 'high');
  assert.equal(found[0].evidence[0].kind, 'header');
  assert.match(found[0].evidence[0].detail, /x-powered-by: Next\.js/);
});

test('a script URL is enough', () => {
  const found = detect('<script src="/_next/static/chunks/main.js"></script>');
  assert.equal(found[0].id, 'nextjs');
  assert.equal(found[0].evidence[0].detail.includes('/_next/static/chunks/main.js'), true);
});

test('the strongest matching rule sets the confidence', () => {
  const found = detect('<div id="__next">', new Headers({ 'x-powered-by': 'Next.js' }));
  assert.equal(found[0].confidence, 'high');
  assert.equal(found[0].evidence.length, 2);
});

test('nothing matches, nothing is claimed', () => {
  const found = detect('<html><body>hello</body></html>');
  assert.equal(found.length, 0);
});

test('version is only reported when the evidence contains it', () => {
  const found = detect('<meta name="generator" content="WordPress 6.7.1">');
  assert.equal(found[0].id, 'wordpress');
  assert.equal(found[0].version, '6.7.1');
});

test('cookies are matched by name from Set-Cookie', () => {
  const fakeHeaders = {
    entries: () => [['content-type', 'text/html']],
    getSetCookie: () => ['laravel_session=abc123; Path=/; HttpOnly'],
  };
  const found = detect('<html></html>', fakeHeaders);
  assert.equal(found[0].id, 'laravel');
  assert.match(found[0].evidence[0].detail, /laravel_session/);
});

test('unknowns name every core category that did not match', () => {
  const notes = describeUnknowns(
    { ok: true, challenged: false, html_bytes: 5000 },
    [{ category: 'framework' }, { category: 'hosting' }],
  );
  assert.ok(notes.some((n) => n.includes('cms')));
  assert.ok(notes.some((n) => n.includes('analytics')));
  assert.ok(!notes.some((n) => n.includes('framework')));
});

test('a failed fetch is reported as not inspected, never as an empty stack', () => {
  const notes = describeUnknowns({ ok: false, blocked: true, reason: 'HTTP 403' }, []);
  assert.ok(notes[0].includes('HTTP 403'));
  assert.ok(notes.some((n) => n.includes('means nothing')));
});
