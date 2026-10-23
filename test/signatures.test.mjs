// Regression tests against the real signature set. Every case here exists
// because the nightly run actually produced that false positive.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { detectSite, extractContext, loadSignatures } from '../src/lib.mjs';

const DIR = fileURLToPath(new URL('../signatures', import.meta.url));
const signatures = await loadSignatures(DIR);

const ids = (html, headers = new Headers()) =>
  detectSite(signatures, extractContext(headers, html)).map((d) => d.id);

test('a prose mention of a product is not a detection', () => {
  const html = '<html><body><p>We migrated off WooCommerce last year.</p></body></html>';
  assert.ok(!ids(html).includes('woocommerce'), 'the word alone must not count as evidence');
});

test('a plugin asset path is a detection', () => {
  const html =
    '<link rel="stylesheet" href="https://example.com/wp-content/plugins/woocommerce/style.css">';
  const woo = detectSite(signatures, extractContext(new Headers(), html)).find(
    (d) => d.id === 'woocommerce',
  );
  assert.ok(woo, 'expected WooCommerce from the plugin path');
  assert.equal(woo.confidence, 'high');
});

test('server: GitHub.com is not proof of GitHub Pages', () => {
  // github.com and *.github.io both answer with this header, so it cannot
  // distinguish the application from Pages. We would rather say nothing.
  const headers = new Headers({ server: 'GitHub.com', 'x-github-request-id': 'abc' });
  assert.ok(!ids('<html><body>hello</body></html>', headers).some((id) => id.includes('github')));
});
