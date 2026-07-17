# ZIP Apportionment Initiative

Source for [zipinit.org](https://zipinit.org) — a volunteer, outcome-bound
initiative advancing ZIP-code-based legislative apportionment, beginning
with Maryland. See `content/charter.md` for the project's purpose and
structure, and `content/contact.md` for how to reach it.

The site is built with [Hugo](https://gohugo.io) using a bespoke, non-reusable
theme (`themes/zipinit/`). The undesigned-by-design visual identity is
unchanged from the original hand-authored site — Hugo just replaced hand-copied
HTML boilerplate with shared templates and Markdown content. The focus is
still on the content.

## Hosting

- **GitHub Pages**, custom domain via `CNAME` (`zipinit.org`), proxied
  through **Cloudflare**.
- Deployed via **GitHub Actions** (`.github/workflows/hugo.yml`): every push
  to `main` builds the site with Hugo and publishes it through Pages' native
  Actions integration. The repo's Pages source setting must be set to
  "GitHub Actions" (Settings → Pages → Source) for this to work.
- The `CNAME` file lives in `static/CNAME` so it's copied into `public/`
  (and therefore into the deployed artifact) on every build — the custom
  domain mapping depends on `CNAME` reaching the deployed site, not on a
  bare file sitting in the repo. There's also an inert copy at the repo
  root, which doesn't affect deployment but is otherwise harmless.
- `.nojekyll` lives in `static/.nojekyll` for the same reason — Hugo copies
  it into the built artifact, where it prevents GitHub Pages from running a
  Jekyll pass that would silently drop `.well-known/`.
- Nothing is committed to git except source — `public/` is gitignored and
  only ever exists as a local preview or as the Actions build artifact.

## Layout

The Hugo project lives directly at the repo root; `hugo build` (or bare
`hugo`) writes generated output to `public/` (Hugo's default `publishDir`,
gitignored):

```
hugo.toml                                   # config
content/                                    # Markdown source
  _index.md, brief.md, essay.md, charter.md,
  representation-is-broken.md, louisiana-v-callais.md, contact.md
  policy-papers/<slug>/index.md             # long-form comparison papers
  pamphlets/<slug>/index.md                 # condensed flyer versions
themes/zipinit/                             # the theme: layouts, partials, shortcodes, style.css
archetypes/default.md                       # starting point for new pages (`hugo new <path>.md`)

static/                                     # passthrough SOURCE files (robots.txt, sitemap.xml,
                                             #   ai.txt, llms.txt, CNAME, .nojekyll, preview.jpg,
                                             #   .well-known/, ai/, mp3-mp4/, presentations/, and
                                             #   each policy-paper/pamphlet's non-HTML export
                                             #   formats) — Hugo copies these into public/ as-is

public/                                     # GENERATED, gitignored — never commit this
.github/workflows/hugo.yml                  # builds + deploys public/ on every push to main
todo/                                       # project notes, not site content
```

## Building

CI handles production builds and deploys on every push to `main` — there's
nothing to run manually to ship a change. Locally, `hugo` (or `hugo build`)
regenerates `public/` for previewing before you push:

```
hugo
python3 -m http.server 8934 -d public
```

`hugo build` does not delete stale output in `public/` on its own between
runs, but since `public/` is never committed this doesn't matter in
practice — delete it and rebuild if you want a truly clean output
(`rm -rf public && hugo`).

## Conventions

- **New pages**: `hugo new <path>.md` (uses `archetypes/default.md`), or copy
  an existing content file's front matter as a starting point. Top-level pages
  need an explicit `url:` front matter field to land at their historical path
  (e.g. `url: /brief.html`) instead of Hugo's default directory-style permalink.
- **Structured data**: `themes/zipinit/layouts/partials/jsonld.html`
  emits JSON-LD for every page, tying back to the same `Organization`/`WebSite`
  entities and the `DefinedTerm` for "ZIP apportionment" (canonically defined
  in `content/essay.md`). Front matter (`jsonldType`, `jsonldDatePublished`,
  `jsonldDateModified`, `jsonldAbout`) controls which shape a given page gets
  — see existing content files for examples.
- **Shortcodes**: recurring semantic blocks (`hero`, `cta`, `callout`, `meta`,
  `formats`, `citation`, `video`) live in `themes/zipinit/layouts/shortcodes/`
  and wrap raw HTML in `.Inner` — matching the site's existing CSS classes in
  `style.css` rather than introducing new markup.
- **Footnotes**: use native Markdown footnote syntax (`[^1]` ... `[^1]: ...`) —
  Goldmark's built-in footnote rendering already carries the `.footnotes` CSS
  class this site's stylesheet targets.
- **Sitemap**: `sitemap.xml` is hand-maintained (not Hugo-generated — Hugo's
  built-in sitemap doesn't know about the PDFs/media/org files this site lists).
  Every page and downloadable file gets an entry with `lastmod`. Nothing should
  be reachable-but-orphaned.
- **Contact info**: the canonical address is `expand@zipinit.org`. A PGP
  key is published three ways (download, inline, WKD) — see
  `content/contact.md` if it ever needs rotating.

## Policy papers (multi-format publishing)

Long-form papers are authored once in Emacs org-mode and exported to every
other format from that single source, so re-exports stay consistent. The
`.org`/`.md`/`.txt`/`.pdf`/`.zip` exports live in
`static/policy-papers/<slug>/` (pamphlets: `static/pamphlets/<slug>/`)
as static passthrough files — Hugo would otherwise try to parse `.org`/`.md`
siblings as their own content pages if they lived next to `index.md`. Rebuild
and re-copy them there after regenerating any individual format:

```
emacs --batch paper.org --eval "(require 'ox-md)"    -f org-md-export-to-markdown
emacs --batch paper.org --eval "(require 'ox-ascii)" -f org-ascii-export-to-ascii
emacs --batch paper.org --eval "(require 'ox-latex)" -f org-latex-export-to-pdf
```

Requires `texlive-latex-extra texlive-latex-recommended texlive-fonts-recommended`
for the PDF export (`wrapfig`/`rotating`/`ulem`/`capt-of` aren't in the base
TeX Live install).

Notes for anyone editing a paper's `.org` source:

- Citation/byline info (author, organization, URL, email) must be a
  real org list (`- item`), not a single dot-separated line — otherwise
  it exports as a run-on string in every format instead of an actual list.
- `#+OPTIONS: num:t` is required for the PDF to get a populated table of
  contents at all — `num:nil` emits starred LaTeX sections, which never
  register `\addcontentsline`. `ox-md`/`ox-ascii` don't print visible
  number prefixes from this either way, except `ox-ascii`, which does
  print them on body headings (a known inconsistency, currently accepted
  for numbering consistency between the PDF and plain-text version).
- `ox-md`'s table export is raw HTML by default (many Markdown renderers
  strip it) — needs manual conversion to a GFM pipe table after each
  export.
- The PDF needs `\hypersetup{colorlinks=true, pdfborder={0 0 0}, ...}`
  (already in each paper's `#+LATEX_HEADER`) or PDF viewers that respect
  link-annotation borders (Firefox's pdf.js, GNOME Document Viewer) will
  draw a visible box around every link. Chrome's built-in viewer hides
  these by default regardless, which can mask the problem during a quick
  check.
- The `.html` version is the Hugo-rendered `index.md` (see
  `content/policy-papers/<slug>/index.md`), hand-converted from org's
  HTML export to Markdown + shortcodes rather than published as org's raw
  output.
- Rebuild the `.zip` bundle after regenerating any individual format.

## Local preview

For a quick live-reloading preview while editing, use Hugo's own dev server
(serves from a temporary in-memory/on-disk render, never touches `public/`):

```
hugo server
```

Then open `http://localhost:1313`. To check the exact production build
instead (see Building, above), serve `public/` directly after running `hugo`.
