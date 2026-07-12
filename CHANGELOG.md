# Changelog

All notable changes to the ZIP Apportionment Initiative site, reconstructed from
git history (`main` branch). Newest first.

## 2026-07-12

- **Added the first policy paper**: "ZIP Apportionment vs. Independent
  Redistricting Commissions vs. Ranked-Choice Voting," published in five
  formats under `policy-papers/` — a site-styled `.html` (breadcrumb,
  table of contents, numbered sections, comparison table, 13 footnotes
  with backlinks), plus `.org`, `.md`, `.txt`, `.pdf`, and a `.zip`
  bundling all of them. Linked from a new "Policy papers" section on the
  homepage and added to `sitemap.xml`.

## 2026-07-11

- **Added a secure contact page** (`contact.html`): Signal, email, and a
  published PGP public key. The key is discoverable three ways — a
  human-readable download, inline on the page, and via Web Key Directory
  (RFC 7929) so WKD-aware mail clients fetch it automatically.
- Added `.well-known/security.txt` (RFC 9116) pointing to the key.
- Added `.nojekyll` — without it, GitHub Pages' default Jekyll build
  silently drops dotfiles/dot-directories like `.well-known/`.
- Linked the contact page from every page's footer.
- Updated the canonical contact address to `expand@zipinit.org` across
  `index.html`'s JSON-LD, `ai.txt`, and `llms.txt`.
- Added a provenance note to the Charter: a one-person, volunteer-run
  project with no funders or board.

## 2026-07-10

- **Fixed `louisiana-v-callais.html`**: the canonical URL and `og:url`
  were pointing at a URL that never existed and 404s live; `og:image`
  still referenced the since-removed `preview.png`; title and meta
  description were both well past SERP truncation limits. Added JSON-LD.
- Merged in `origin/main`'s Louisiana v. Callais commits (page, homepage
  link, sitemap entry) that had diverged from this branch's history, and
  added the missing `lastmod` to that sitemap entry.
- **Applied a round of SEO/GEO audit fixes** across the site:
  - Added JSON-LD (`Organization`, `WebSite`, `DefinedTerm`,
    `Article`/`CreativeWork`) so "ZIP apportionment" is machine-readable
    as a canonical term.
  - Added canonical `<link>` tags site-wide; dropped the duplicate
    `/index.html` sitemap entry that was splitting homepage authority.
  - Added Open Graph/Twitter Card tags to the pages that were missing
    them.
  - Converted the video's `.srt` captions to WebVTT and wired them into
    the `<track>` element (fixing leftover TTS markup and a mojibake
    apostrophe found in the source along the way).
  - Recompressed the 1.3MB `preview.png` OG image to a 132KB `preview.jpg`.
  - Removed tracked `index.html.bak`/`static/style.css.bak` (were live
    at guessable public URLs); added `*.bak` to `.gitignore`.
  - Added the missing `representation-is-broken.html` and `brief.org`
    entries to `sitemap.xml`, and added `lastmod` to every entry.

## 2026-07-09

- **Redesigned the site's visual identity** while keeping it content-first:
  a paper/seal color palette, a deliberate type pairing (condensed sans
  headings, literary serif body, monospace for administrative metadata),
  dashed tear-line rules, breadcrumbs and tables of contents on the
  long-form documents, and styled section numerals.
- Added `dodgeball.org`, a draft essay comparing districting to
  elementary-school team-picking.
- Added `present.html`/`present.org`, a reveal.js slide deck exported via
  org-reveal.

## 2026-04-29

- Added `louisiana-v-callais.html` and linked it from the homepage.
- Updated the sitemap for the new page.

## 2026-04-14

- Removed `.obsidian/` workspace files from version control.
- Homepage clarity pass, plus CSS updates.

## 2026-03-13

This was the SEO/AI-discoverability foundation day — most of what later
audits built on was laid down here:

- Added `robots.txt`, `sitemap.xml`, and the original `ai.txt`/`llms.txt`
  AI-briefing files, plus a dedicated `/ai/` directory with canonical
  summaries and objection-handling documents.
- Added `representation-is-broken.html` (renamed from `rep-is-broke.html`)
  and a sitewide stylesheet.
- Added the preview/OG image and Open Graph tags; later resized the image
  and moved it to the correct path.
- Added GoatCounter analytics (privacy-respecting, no cookies).
- Mobile padding, centering, and template cleanup passes.

## 2026-02-01 to 2026-02-02

- Added the "Representation Is Broken" video, audio, transcript, and
  markdown script.
- Added the first pamphlet (condensed flyer version, in HTML/MD/ODT/PDF).
- Linked the project's GitHub repo from the homepage.

## 2026-01-24 to 2026-01-25

- **First commit**: `index.html`, `brief.html`/`brief.org`, `charter.html`,
  `template.html`, and the original essay PDF/markdown.
- Added `essay.html`.
- Set up the `CNAME` for the custom domain.
- Added the "page last updated" footer line across pages.

---

*This file was reconstructed from `git log` on 2026-07-12 and is not
maintained commit-by-commit going forward; treat it as a snapshot, not a
live log.*
