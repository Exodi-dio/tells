# Signature registry

Every detection in `tells` comes from one of these files. There is no build step
and no dependency: `src/lib.mjs` reads the JSON, compiles each `pattern` as a
case-insensitive regular expression, and runs it against the part of the
response named by `type`.

## File shape

```json
{
  "category": "cms",
  "signatures": [
    {
      "id": "ghost",
      "name": "Ghost",
      "website": "https://ghost.org",
      "version": "Ghost\\s*([0-9.]+)",
      "rules": [
        { "type": "meta", "name": "generator", "pattern": "^Ghost", "confidence": "high" }
      ]
    }
  ]
}
```

- `category` is required at the top level and is inherited by every signature in the file.
- `id` must be unique across the whole registry. It is the stable key used in diffs.
- `version` is optional. If present, it is a regex with one capture group, run over
  the matched evidence. It is **not** run over the whole page.
- A signature matches if **any** rule matches. Confidence is the strongest rule that matched.

## Rule types

| `type` | Matched against | `name` | `pattern` |
| --- | --- | --- | --- |
| `header` | response header value | header name (case-insensitive) | optional, applied to the value |
| `cookie` | cookie **name** only | — | required (or exact name if no pattern) |
| `script` | each `<script src>` URL | — | required |
| `html` | the first 3 MB of markup | — | required |
| `meta` | `<meta>` content, by name/property/http-equiv | meta name | optional |

## Confidence

Pick deliberately — this is the product:

- **high** — server header, cookie name, or script URL. Server-controlled, hard to fake accidentally.
- **medium** — markup heuristic. A class name or DOM id that could be a coincidence.
- **low** — a hint worth publishing but not worth trusting on its own.

Never add a rule that would match a competitor's product. A false positive here is
published, with our name on it, every night.

## Rules of the road

1. One signature per product. If two products are indistinguishable from outside, say so in the PR.
2. Prefer the rule the vendor cannot remove without breaking themselves (a CDN header over a CSS class).
3. No rules against `robots.txt`-disallowed paths — we only read the page we were served.
4. Adding a signature takes one file edit and one JSON object. That is the whole contribution surface.
