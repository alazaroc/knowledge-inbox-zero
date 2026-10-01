# Example / demo fixtures

These files are **synthetic, demo-only fixtures**. They exist so you can try the
app without supplying your own data.

- `sample-profile.json` — a clearly fictional knowledge profile matching the
  `profileSchema` shape from `@app/shared` (`highInterests`, `mediumInterests`,
  `currentlyResearching`, `alreadyKnown`, `avoidContentTypes`, `context`). The
  persona ("Alex Example") is made up.
- `sample-urls.txt` — a short list of **public** documentation URLs, one per
  line (MDN, AWS docs, Node.js, etc.). No personal data.

## Rules

- **Never** put real personal data here (real profiles, private URL lists,
  analysis history, or extracted content). See requirement **NFR-3.2**: the
  repository must not contain real personal data; demo data is provided
  separately and clearly marked.
- Keep real/private data in files the root `.gitignore` excludes
  (e.g. `*.personal.json`, `*.private.json`, `*.local.*`, or the
  `personal-data/` and `secrets/` directories). Those are intentionally
  untracked so private data cannot be committed by accident.
- Only the `sample-*` fixtures in this directory are meant to be committed.
