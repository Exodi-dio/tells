# tells

**Every website has tells. We publish them, with receipts.**

[![ci](https://github.com/Exodi-dio/tells/actions/workflows/ci.yml/badge.svg)](https://github.com/Exodi-dio/tells/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A nightly census of the 25,000 highest-ranked domains on the web — framework, CMS, host,
analytics, ecommerce, payments, fonts, consent. Every detection cites the exact header, cookie,
script URL or markup that produced it. Everything we could not prove is labelled as unknown.

**[Search the census →](https://exodi-dio.github.io/tells/)** · **[State of the web →](https://exodi-dio.github.io/tells/state.html)** · **[Changelog →](https://exodi-dio.github.io/tells/changes.html)**

Not a hand-picked list of sites we felt like crawling. The population is resolved from a public
ranking every night, so the numbers are about the web rather than about our taste.

---

## What a page looks like

```
stripe.com                                    HTTP 200 · 412 KB · 96 ms
────────────────────────────────────────────────────────────────────────────
WHAT IT IS BUILT WITH
  Framework   React                              medium confidence
              └ #root, data-reactroot                      2 pieces of evidence
  Hosting     Cloudflare                         high confidence
              └ server: cloudflare · cf-ray: 8f3c…        2 pieces of evidence
  Analytics   Segment                            high confidence
              └ script cdn.segment.com/analytics.js        1 piece of evidence

WHAT WE COULD NOT PROVE
  · No CMS signature matched
  · No pricing signature matched — a vendor can bill without a script we can see
```

That last section is the point. Most stack detectors quietly print a confident answer for a page
they barely understood. This one tells you what it *didn't* see, and why.

## Why this exists

Two companies already know how every site on the web is built. Neither will give you the history.

- **BuiltWith** sells access to facts that are sitting in a public HTTP response.
- **Wappalyzer**'s rules were open once; the hosted product is now paid and closed.

So the observations are public, the aggregation is proprietary, and the *change over time* —
the genuinely valuable part — is locked in someone's database. That is a strange thing for the
web to accept about itself.

`tells` is the open, versioned, forkable version. A nightly GitHub Action fetches each origin,
runs an open signature registry over the response, commits the snapshot, and publishes the diff.
Snapshots are append-only JSON in this repo. Fork it and you inherit the entire history.

## The receipt

A detection is never just a name. This is the actual shape:

```json
{
  "id": "nextjs",
  "name": "Next.js",
  "category": "framework",
  "confidence": "high",
  "evidence": [
    { "kind": "header", "detail": "x-powered-by: Next.js", "confidence": "high" },
    { "kind": "script", "detail": "script /_next/static/chunks/main-app.js", "confidence": "high" }
  ]
}
```

- `high` — a server header, a cookie name, or a script URL. Server-controlled, hard to fake by accident.
- `medium` — a markup heuristic. A DOM id or class that could be a coincidence.
- `low` — a hint worth publishing, not worth trusting.

Failed fetches are published too, as `blocked`, not as an empty stack. Absence of evidence is never
reported as evidence of absence.

## How it runs

```
public rank list ──► tonight's 25,000 domains
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   20 runners, 16 in flight          one GET per domain,
   round-robin shards                20 s timeout, 3 MB cap
              └─────────────┬─────────────┘
                            ▼
        signatures/*.json ──► detect + attach evidence
                            ▼
  merge ──► data/snapshots/DATE.jsonl ──► diff ──► data/changes/DATE.json
                            ▼
                    dist/ ──► GitHub Pages
```

One GitHub Actions cron and a matrix of twenty runners. No servers, no database, no accounts.
The whole pipeline is Node's standard library plus one JSON file per category. The only
client-side JavaScript on the site is a 3 KB search box that filters an index in your browser.

## Add a signature

The registry is the contribution surface. Adding a product is one object in one file:

```json
{
  "id": "astro",
  "name": "Astro",
  "website": "https://astro.build",
  "rules": [
    { "type": "html", "pattern": "astro-island", "confidence": "high" }
  ]
}
```

See [`signatures/README.md`](signatures/README.md) for the rule types and when each confidence
level is honest. A good signature PR includes the site you verified it against.

The census population comes from a public ranking, resolved fresh each night — nobody adds sites
by hand. What makes a site legible is a signature, so that is the contribution that matters.

## Data

Everything is a plain JSON file in this repo, refreshed nightly:

| Path | What it is |
| --- | --- |
| `data/snapshots/YYYY-MM-DD.jsonl` | One line per domain: status and stack ids. This is the history, and it is committed. |
| `data/changes/YYYY-MM-DD.json` | Diff against the previous snapshot. |
| `api/latest.json` | Full current census with evidence for every detection — built each run, served, **not** committed (it is tens of MB). |
| `api/index.json` | Compact index the search box downloads: domain, status, stack ids. |

Served at `https://exodi-dio.github.io/tells/api/latest.json`.

## What this is not

- **Not a security scanner.** We read what a site chose to send an anonymous visitor.
- **Not proof of absence.** No match means no rule matched. Custom builds look exactly like that.
- **Not a crawler of private things.** One GET per origin per night, public pages only, no auth, no JS execution.
- **Not complete.** Some sites block data-center IPs. We publish that as a first-class result instead of hiding it.

## Roadmap

- [ ] Version extraction for more products (only where the version appears in evidence)
- [ ] `X-Robots-Tag`-aware politeness and a published opt-out list
- [x] Per-category leaderboards: which CDN is winning, which analytics vendor is losing
- [ ] Signature coverage report — which categories are chronically unmatched
- [ ] Weekly digest generated from the diffs

## Contributing

Issues and PRs welcome, especially signature additions and blocked-site reports. If a detection is
wrong, open an issue with the URL and the string that fooled it — a false positive is a bug with our
name on it.

MIT licensed.
