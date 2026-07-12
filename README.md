# ZIP Apportionment Initiative

Source for [zipinit.org](https://zipinit.org) — a volunteer, outcome-bound
initiative advancing ZIP-code-based legislative apportionment, beginning
with Maryland. See `charter.html` for the project's purpose and structure,
and `contact.html` for how to reach it.

This is a plain, hand-authored static site. No build step, no framework —
HTML files with a shared stylesheet, deployed as-is. The site is undesigned by design. The focus is on the content. 

## Hosting

- **GitHub Pages**, custom domain via `CNAME` (`zipinit.org`), proxied
  through **Cloudflare**.
- `.nojekyll` is required at the repo root — GitHub Pages runs Jekyll by
  default, which silently drops dotfiles/dot-directories (`.well-known/`
  in particular). Don't remove it.
- Pushing to `main` is what ships to production.

## Layout

```
index.html, brief.html, essay.html, charter.html,       # core pages
representation-is-broken.html, louisiana-v-callais.html,
contact.html
template.html                                            # starting point for new pages
static/style.css                                         # shared stylesheet
policy-papers/<slug>/                                     # long-form comparison papers,
                                                            # each in .org/.html/.md/.txt/.pdf/.zip
pamphlets/<slug>/                                          # condensed flyer versions
mp3-mp4/, ai/                                              # media and AI-briefing docs
robots.txt, sitemap.xml, ai.txt, llms.txt                 # crawlability / AI discoverability
.well-known/security.txt, .well-known/openpgpkey/         # RFC 9116 + WKD (see contact.html)
seo-audit.org                                              # SEO/GEO audit findings and status
CHANGELOG.md                                               # reconstructed project history
```

## Conventions

- **New pages**: start from `template.html` — it already has the
  canonical `<link>`, breadcrumb, footer contact link, and stamp
  conventions the rest of the site uses. Fill in the placeholders.
- **Structured data**: every real page carries JSON-LD tying back to the
  same `Organization`/`WebSite` entities and the `DefinedTerm` for "ZIP
  apportionment" (canonically defined on `essay.html`). Keep `@id`s
  consistent when adding new pages.
- **Sitemap**: every page and downloadable file gets an entry in
  `sitemap.xml` with `lastmod`. Nothing should be reachable-but-orphaned.
- **Contact info**: the canonical address is `expand@zipinit.org`. A PGP
  key is published three ways (download, inline, WKD) — see
  `contact.html` if it ever needs rotating.

## Policy papers (multi-format publishing)

Long-form papers under `policy-papers/<slug>/` are authored once in
Emacs org-mode and exported to every other format from that single
source, so re-exports stay consistent:

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
- The `.html` version is hand-assembled from org's own HTML export
  (extracted and restructured to match the site's template/breadcrumb/
  TOC/footnote conventions) rather than published as org's raw output.
- Rebuild the `.zip` bundle after regenerating any individual format.

## Local preview

No build step — just serve the directory:

```
python3 -m http.server 8934
```

## History

See `CHANGELOG.md` for a reconstructed, dated history of the project, and
`seo-audit.org` for the standing SEO/GEO audit and what's been resolved.
