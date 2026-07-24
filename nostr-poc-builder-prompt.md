# Builder Prompt: Nostr Discussion Layer, Proof of Concept

Use this prompt to implement the proof of concept for the zipinit.org Nostr
discussion layer, scoped to phases 1 to 2 of the architecture document
(`nostr-discussion-architecture.md`), per its section 16. Read that document
first; this prompt only restates and operationalizes the decisions it
already made, it does not re-derive them.

Assumption made in scoping this prompt: "builder prompt" means an
implementation task for a coding agent working directly in the zipinit.org
Hugo repo, not a design discussion. If a different phase or the full six-phase
build was intended instead of the PoC slice, say so and this prompt can be
adjusted.

---

## Role and constraints

You are implementing inside an existing Hugo site (repo layout, theme
conventions, and deployment model are described in `README.md` at the repo
root; read it before making changes). Follow the site's existing
conventions exactly:

- Shortcode-style semantic blocks live in `themes/zipinit/layouts/shortcodes/`
  and wrap raw HTML in `.Inner`, matching existing CSS classes in
  `style.css`. Do not introduce a new CSS framework, build step, or
  JavaScript framework. Vanilla JS and the site's existing CSS conventions
  only.
- `static/` is for passthrough source files Hugo copies as-is into
  `public/`. New static assets (widget JS/CSS, relay config, blocklist)
  belong there.
- `public/` is generated and gitignored. Never write to it directly or
  commit anything in it.
- New pages follow the existing front-matter and `url:` conventions
  (`archetypes/default.md` as the starting point for top-level pages that
  need an explicit path).
- The `themes/zipinit/layouts/partials/jsonld.html` structured-data pattern
  should not be broken by whatever you add; if the discussion widget adds
  a new page, give it appropriate `jsonldType` front matter consistent with
  existing content files.

## Scope: what to build

**In scope (phase 1):**
1. A `/discussion/` page that renders a read-only feed of the official
   account's own posts (`kind:1`), not replies/reposts/reactions from
   others.
2. Expand-to-view-replies on any post in that feed (fetch and render
   `kind:1111` replies to that post only when expanded).

**In scope (phase 2):**
3. An optional, read-only discussion section on Journal articles and
   policy papers, rendering `kind:1111` comments anchored to the page's
   canonical URL (NIP-22 `I`/`i` tags, `K`/`k` value `"web"`), including
   threaded replies, official-account identification, comment count, and
   clear "no comments yet" messaging.
4. Hugo front matter to enable/disable this per page.

**Explicitly out of scope for this build (do not implement yet):**
- Posting or signing of any kind (no NIP-07, no NIP-46, no post button
  beyond a disabled/read-only state).
- Moderation tooling beyond a hardcoded, empty blocklist JSON file (its
  presence and wiring should be built now; populating it with real entries
  is not).
- The project-operated relay, archival job, and NIP-7D forum topics
  (phases 5 to 6).
- Any publishing workflow for official posts (assume the official account's
  `kind:1` posts already exist on the configured relays from normal manual
  use of a Nostr client).

If you find yourself about to add posting, signing, or moderation UI beyond
the empty blocklist, stop, since that is out of scope for this build.

## Official account and canonical data

- Official npub: `npub1fthhr5palh5nmv9ly7ksmtusyey3xxf2sx9etmrl4z3uzu80a3uqjsen7k`
  (decode to hex pubkey once, in the widget's config, not on every render).
- Canonical URL for each page: read it from the same value Hugo already
  emits in `<link rel="canonical">`; do not compute a second canonical URL
  in the widget.

## Files to create or modify

1. **`static/nostr/relays.json`** (or similar path, keep it under `static/`
   so it ships as a versioned static asset per section 4 of the
   architecture doc): a JSON array of 3 relay WebSocket URLs. Use
   placeholder, clearly-commented-as-placeholder relay URLs if you do not
   have a final vetted list yet; do not silently invent authoritative-sounding
   ones. Structure:
   ```json
   {
     "relays": ["wss://...", "wss://...", "wss://..."],
     "officialPubkeyHex": "...",
     "officialNip05": "zip@zipinit.org"
   }
   ```

2. **`static/nostr/blocklist.json`**: empty structure, wired into the
   widget's render path now so phase 4 only has to populate it, not build
   the plumbing:
   ```json
   { "pubkeys": [], "eventIds": [] }
   ```

3. **`static/js/nostr-widget.js`** (or under a `static/nostr/` asset
   directory, match whatever convention the theme already uses for other
   bundled JS if one exists): the widget itself. Requirements:
   - Use `nostr-tools` (or an equivalent small, focused, actively
     maintained protocol library per section 8 of the architecture
     document) for event verification, relay pool handling, and NIP-19
     decoding. Vendor/pin the exact version; do not load it from an
     unpinned CDN at runtime. If you cannot fetch the dependency in this
     environment, stub the exact function calls you would make against it
     and note clearly in a code comment that the dependency needs to be
     installed and pinned before this ships.
   - Read `relays.json` and `blocklist.json` at runtime via `fetch`, not
     bundled into the JS.
   - Query relays in parallel with a short per-relay timeout (2 to 4
     seconds); render progressively as each relay responds; never block on
     every relay.
   - Deduplicate by event ID across relays.
   - Verify every event's signature before rendering it; discard anything
     that fails verification, silently (log to console only).
   - Never use `innerHTML` on event content. Render comment/post text as a
     text node only, regardless of what the string contains.
   - Apply the blocklist (pubkey or event ID match) before render, hiding
     matches entirely.
   - Cap rendered content length per event (truncate with a "read more"
     toggle past a reasonable threshold, for example 2000 characters) to
     bound worst-case oversized events.
   - Mark the official account visually only when its NIP-05 identifier
     resolves via HTTPS fetch to `zipinit.org/.well-known/nostr.json` and
     matches the pubkey; do not mark it based on pubkey string match alone.
   - Disable any post-related UI entirely; render it in an obviously
     inert/disabled state rather than omitting it, so the phase 3 build
     has a clear attachment point. Do not wire it to any signer.
   - Only fetch top-level comments/posts on load; fetch a thread's replies
     only when a visitor expands it (no standing subscriptions, one-shot
     fetches, close the WebSocket once the initial batch is in).
   - Paginate top-level results in batches ("load more") rather than
     requesting an unbounded set.

4. **`themes/zipinit/layouts/shortcodes/nostr-discussion.html`** (or a
   partial, following whichever pattern the theme already uses for
   optional per-article sections): includes the widget's script and
   mounts a container `<div>` reading this page's canonical URL, the
   `nostrDiscussion`/`nostrLocked` front matter, and passing them to the
   widget as data attributes or an inline config object.

5. **A new top-level page** for `/discussion/` (front matter with an
   explicit `url:` field per the site's top-level-page convention, an
   appropriate `jsonldType`), mounting the widget in "official feed" mode
   rather than "article comments" mode.

6. **Front matter additions** to the Journal and policy-paper archetypes
   (or directly to `archetypes/default.md` if that is shared, check first):
   ```yaml
   nostrDiscussion: true
   nostrLocked: false
   ```
   Default `nostrDiscussion: true` at the section level for Journal and
   policy papers per section 7 of the architecture document, so individual
   articles do not need to opt in one by one. Do not add these fields to
   the homepage, charter, or contact page archetypes.

7. **A short CSP update** (wherever the site's headers are currently set,
   check `hugo.toml`, a `_headers` file if one exists for the hosting
   setup, or a meta tag in the base template) permitting WebSocket
   connections only to the URLs listed in `relays.json`, restricting
   `script-src` to the site's own bundled assets, and disallowing
   `unsafe-eval`. If no CSP currently exists on the site, add a minimal one
   scoped to this feature rather than a site-wide policy, and say so
   explicitly in your summary of changes so it can be reviewed.

8. **Visual style**: match the site's existing restrained, minimal look
   (see `style.css` and existing shortcodes like `callout`/`meta`). The
   discussion section should read as a modest, secondary block near the
   bottom of an article, not a prominent social-media-style module. No new
   font, no new color palette, no icon library beyond what the theme
   already uses.

## NIP-22 event shape to fetch and render

For article comments, fetch `kind:1111` events where:
```
["I", "<canonical article URL>"]
["K", "web"]
```
appear in the tags (root scope, since this build only supports top-level
comments plus one level of expand-to-view-replies, not arbitrary nesting).
When expanding a reply branch, fetch `kind:1111` events whose `i`/`e` tags
point at the specific parent comment being expanded.

For the official feed, fetch `kind:1` events authored by the official
pubkey (not tagging or mentioning it) for the top-level list; on expand,
fetch `kind:1111` (and, if present, legacy `kind:1` NIP-10 style replies,
but do not build special handling for that unless you find it is actually
in use by the account's existing followers) tagged as replies to that
specific event.

## Accessibility requirements (build these in now, not later)

- Semantic structure: `<article>`/`<ol>`/`<li>` for the comment list, not
  nested `<div>`s.
- Keyboard-reachable expand/collapse controls with visible focus states.
- An `aria-live` region for load-status messages ("loading comments",
  "no comments yet", "failed to reach relays").
- Respect `prefers-reduced-motion` for any expand/collapse transition.

## No-JS and no-relay fallback

- The article content itself must remain fully readable with JavaScript
  disabled; the discussion section should degrade to a simple static
  message ("View or join this discussion using a Nostr client") with a
  link, not a blank space or a broken widget.
- If relay connections fail entirely, show a clear message rather than an
  infinite loading state or a silent empty list.
- If the page is loaded from any hostname other than `zipinit.org`
  (covers local `hugo server` previews), keep read behavior working but
  do not wire up anything that implies posting is possible, since posting
  itself is out of scope for this build regardless.

## Testing checklist before calling this done

Match section 16 of the architecture document:
- [ ] `/discussion/` renders the official account's own posts, correctly
      excluding replies/reposts/reactions from the top-level list.
- [ ] Expanding a post shows its replies.
- [ ] One Journal article renders its comment section correctly scoped to
      its own canonical URL (verify a comment tagged to a different URL
      does not appear).
- [ ] Zero-comment state reads clearly to someone unfamiliar with Nostr.
- [ ] Comment count displayed matches the actual rendered count.
- [ ] A hand-crafted test event with `<script>` or HTML in its content
      field renders as inert text, not executed markup.
- [ ] Disabling JavaScript leaves the article readable, with a plain
      fallback message in place of the widget.
- [ ] Simulating all three configured relays as unreachable produces a
      clear failure message, not a hang or blank section.
- [ ] The official account is marked as such only when NIP-05 resolution
      succeeds; a mismatch or failed lookup removes the badge rather than
      showing it anyway.
- [ ] Blocklist wiring works against a manually added test entry, then can
      be reset to empty before shipping.
- [ ] No content from the widget is inserted via `innerHTML` anywhere in
      the code (grep for it as a final check).

## What to hand back

- The new/modified files listed above.
- A short note on which relay URLs you used (placeholder vs real) and
  where the CSP was added, since both need a final decision before this
  goes to production per the architecture document's open decisions
  (section 15).
- Confirmation of which testing-checklist items were actually verified
  versus which need a human to check in a real browser (for example, the
  NIP-07-absent fallback UI, if you stub any post-related UI at all).

Do not expand scope beyond what is listed above. If something in the
architecture document seems to call for more (for example, wiring up
actual posting), leave it as a clearly marked TODO referencing the phase
it belongs to, rather than building it now.
