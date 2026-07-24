# Nostr Discussion Layer for zipinit.org: Architecture Proposal

Prepared for the ZIP Apportionment Initiative. This document covers the
recommended architecture, relay strategy, moderation model, security review,
Hugo integration, publishing workflow, and phased rollout for adding a
Nostr-based discussion layer to the existing static Hugo site.

Official account: `npub1fthhr5palh5nmv9ly7ksmtusyey3xxf2sx9etmrl4z3uzu80a3uqjsen7k`

---

## 1. Recommended architecture

**Client-side widget, static-first, no project database.** The site stays a
static Hugo build with no server-side application logic. A small, dependency-light
JavaScript component fetches and renders Nostr events in the browser at
runtime, degrading to a plain "read on Nostr" link when JavaScript, relays,
or a signer are unavailable.

Three protocol pieces do the actual work:

- **NIP-01** for the base event/relay protocol.
- **NIP-22** (`kind:1111`) for comments, using `I`/`i` tags to anchor threads
  to the article's canonical URL (the "web" external-content kind, per
  NIP-73), rather than to a project-created root event. This means an
  article's discussion exists the moment anyone comments on its URL; no
  publishing step is required to "open" comments.
- **NIP-7D** (`kind:11`, forum thread root) with NIP-22 replies for the
  standalone topic pages in phase 5, since those need a title and a
  discrete origin post rather than a bare URL anchor.

A small always-on relay operated by the project sits alongside a short list
of public relays: not authoritative, but a caching and durability layer (see
section 3).

No user database, no server-side session state, no stored private keys. The
project's own posting identity is the one exception requiring careful key
handling (section 9).

### Why anchor to canonical URL rather than a generated root event

Two options were on the table: (a) each article generates and stores a
`kind:1111` "root" comment event at publish time, which every subsequent
comment replies to, or (b) comments attach directly to the article's
canonical URL via NIP-22's `I`/`i` external-content tags, with no
project-authored root event at all.

URL-anchoring (b) is the better fit here:

- It requires no publishing action for comments to become possible; an
  article is commentable the moment it has a stable canonical URL, which
  Hugo already guarantees.
- It avoids the failure mode where a root event fails to publish, gets lost
  to a relay outage, or is authored before a last-minute URL change, leaving
  comments orphaned from the article.
- It matches how other NIP-22 deployments (blog comment widgets) already
  work, so existing client libraries and relay indexing assume it.

The tradeoff: URL-anchored comments are keyed on the exact string in the `I`
tag, so URL stability matters a lock. This is addressed directly in section
7 (URL changes and aliases).

---

## 2. Component diagram

```
                          ┌─────────────────────────────┐
                          │        Hugo build (CI)       │
                          │  content/ -> public/ (static) │
                          └───────────────┬───────────────┘
                                          │ deploys
                                          v
┌───────────────────────────────────────────────────────────────────┐
│                      GitHub Pages / Cloudflare                     │
│  Static HTML, CSS, the discussion widget's bundled JS/CSS asset    │
└───────────────────────────────────────────────┬───────────────────┘
                                                 │ served to browser
                                                 v
┌───────────────────────────────────────────────────────────────────┐
│                          Visitor's browser                        │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │  Discussion widget (vanilla JS, no framework)              │    │
│  │   - subscribes to relays for this page's comment thread    │    │
│  │   - renders read-only list; expands replies on demand      │    │
│  │   - on "post", calls NIP-07 signer (window.nostr) or       │    │
│  │     a bunker/remote-signer (NIP-46) for mobile              │    │
│  │   - never touches a private key                            │    │
│  └───────────────────────────┬───────────────────────────────┘    │
└───────────────────────────────┼─────────────────────────────────────┘
                                 │ WebSocket (read) / signed event (write)
              ┌──────────────────┼──────────────────┐
              v                  v                  v
      ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
      │ Project relay  │  │ Public relay A │  │ Public relay B │
      │ (own hardware  │  │ (e.g. relay.   │  │ (e.g. nos.lol) │
      │  or hosted VPS)│  │  damus.io)     │  │                │
      └───────┬────────┘  └───────────────┘  └───────────────┘
              │
              v
     ┌────────────────────┐
     │ Periodic archival   │
     │ job (CI cron or     │
     │ small script) pulls │
     │ events -> JSON in   │
     │ the git repo         │
     └────────────────────┘

Separate, offline path for the official account's own posts:
┌───────────────────┐        ┌──────────────────┐
│ Journal front      │  CI    │ Signing service   │  publishes
│ matter (Hugo build)│ -----> │ (small, isolated, │ ---------->  relays
│ triggers a job      │        │  holds nsec via   │
└───────────────────┘        │  secret store)     │
                              └──────────────────┘
```

---

## 3. Data flow

### Reading (official feed, article comments, forum topics)

1. Page loads; the widget's script initializes with a config object (relay
   list, this page's canonical URL or `naddr`/`nevent`, official pubkey).
2. It opens short-lived WebSocket subscriptions to the configured relays,
   requesting: for the official feed, `kind:1` (and later long-form
   `kind:30023`) authored by the official pubkey; for article comments,
   `kind:1111` events tagged with this page's URL; for forum topics,
   `kind:11` root plus `kind:1111` replies scoped to that root.
3. Events from multiple relays are merged and deduplicated by event ID.
   Signatures are verified client-side before anything is rendered.
4. The widget renders a flat list of top-level items first. Reply chains
   are fetched and rendered only when a visitor expands a thread branch, to
   keep the default view light.
5. Local moderation data (blocklist, trust list; section 5) is applied
   client-side to hide, collapse, or de-emphasize matching events before
   render; nothing sent by a relay is ever eval'd or inserted as raw HTML.

### Publishing (visitor comment)

1. Visitor writes a plaintext comment in the widget's reply box.
2. Widget checks for `window.nostr` (NIP-07 extension). If absent, it shows
   setup guidance rather than an error, and offers a NIP-46 "remote signer"
   / bunker connection as the mobile-friendly path (a QR code or
   `bunker://` URI a mobile signer app can accept, so no browser extension
   is required on a phone).
3. Widget constructs a `kind:1111` event with root/parent `I`/`i`/`K`/`k`
   tags pointing at the article's canonical URL (or, for forum topics, the
   relevant `kind:11` root), asks the signer to sign it, and publishes it to
   the read/write relay set with a short timeout per relay.
4. UI shows a "publishing..." state per relay and confirms once at least one
   relay accepts it (or reports failure if all reject/timeout).
5. Nothing is buffered or queued server-side; there is no server in this
   path at all.

### Publishing (official Journal article to Nostr)

1. Hugo build (or a follow-up CI step) detects a new/updated Journal article
   with `nostrPublish: true` in front matter.
2. CI calls a small, separate signing service (not the GitHub Actions
   runner itself) with the article's title, summary, canonical URL, and
   tags. That service holds the official `nsec` in a secret manager, builds
   and signs a `kind:1` (short announcement) and/or `kind:30023` (long-form
   mirror) event, and publishes to the relay set.
3. The service returns the event ID; a small CI step can write it back into
   the article's front matter (`nostrEventId`) purely for the `rel="alternate"`
   link and "view on Nostr" button, not as something comments depend on.

---

## 4. Relay strategy

**Small, curated default set, not a shotgun approach.**

- Default read/write set: 3 to 5 well-run public relays with good uptime
  and reasonable spam filtering (examples to evaluate at implementation
  time, since relay reputations shift: relay.damus.io, nos.lol, relay.nostr.band,
  purplerelay.com), plus the project's own relay.
- **Project relay role: supplementary and caching, not authoritative.**
  Treat the network of public relays as the actual distribution layer; the
  project relay exists to guarantee the project's own posts and the
  comments on project pages are retrievable even if public relays churn,
  and to give the archival job a stable source. It should not be the sole
  relay clients query, or a relay outage becomes a site outage.
- **Read vs write relays**: read from the full default set (broader
  visibility into what visitors are saying); write official posts to the
  full set plus the project relay; write visitor comments to the default
  set only (visitors do not need write access to the project relay
  specifically, and a project relay that accepts arbitrary visitor writes
  is a bigger moderation and spam surface than one that only mirrors).
- **Fallback behavior**: the widget queries relays in parallel with a short
  per-relay timeout (2 to 4 seconds is reasonable), and renders whatever has
  arrived when the slowest acceptable timeout elapses, rather than blocking
  on every relay responding. A single relay failing to connect should never
  block render.
- **Deduplication**: by event ID (`id` field) across relays; last-write-wins
  is not a concern here since events are immutable and content-addressed.
- **Spam exposure**: public relays carry the general Nostr firehose;
  filtering by tag (this page's URL, this thread's root) already narrows
  results substantially, and client-side moderation (section 5) handles the
  rest.
- **Configurability without a rebuild**: relay list should live in a small
  static JSON file served alongside the widget (e.g. `/nostr-relays.json`),
  not hardcoded into the bundled JS. Updating it is a static file edit and
  redeploy, not a Hugo content change, so it is fast but still versioned in
  git.
- **Official account's advertised relay list (NIP-65)**: worth reading and
  factoring in as a hint (if the official account is set up to publish a
  relay list event, the widget can add those relays to its query set for
  the official feed specifically), but the site's own curated default
  should remain the baseline so comment-thread queries do not depend on the
  official account's personal relay choices.

---

## 5. Moderation model

The site cannot delete events from the broader network, but it fully
controls what it chooses to display, and that is the lever to use.

**Layers, from least to most centralized:**

1. **In the browser (default, always-on)**: a static blocklist (pubkeys and
   event IDs) shipped as a JSON file, checked client-side before render.
   Matching content is hidden, not just flagged, since a visible-but-marked
   spam event still clutters the thread.
2. **Trust tiers, not binary approve/deny**: three buckets work well for a
   small advocacy site: (a) the official account, visually marked; (b) a
   short "recognized" list (contributors, known good-faith participants)
   whose comments render normally by default; (c) everyone else, whose
   first comment on the site is collapsed behind a "show first-time
   commenter" toggle rather than hidden outright, so legitimate first-time
   critics are not silenced but a flood of throwaway spam accounts does not
   dominate the page.
3. **Build-time**: none needed for comments themselves, but the blocklist
   and trust-tier JSON files are edited in the repo and shipped through the
   normal Hugo build/deploy, giving a reviewable git history of moderation
   decisions.
4. **Serverless endpoint**: not recommended for phase 1 to 4. Adding one
   only to run spam scoring introduces a server dependency the rest of the
   architecture deliberately avoids. Revisit only if volume genuinely
   demands automated scoring later.
5. **Project relay**: can apply its own NIP-01 event validation and rate
   limiting on write, which helps if the project relay is ever opened to
   visitor writes, but per section 3 it currently is not.
6. **Community reports**: a lightweight "report" button that publishes a
   `kind:1984` (NIP-56 reporting) event, so reports are themselves visible
   Nostr data other clients and moderators can act on, without building a
   custom reporting backend.

**Additional tools to evaluate rather than commit to immediately:**

- Minimum proof-of-work on accepted comments (NIP-13): a blunt anti-spam
  tool that also raises the bar for casual first-time legitimate
  commenters; better reserved as a project-relay-only setting if abuse
  volume warrants it, not a blanket requirement.
- Keyword/content filters: useful as a supplement to the blocklist, prone
  to false positives; keep them advisory (flag for review) rather than
  auto-hiding.
- UI-level rate limiting: straightforward and worth doing regardless
  (disable the post button briefly after submission) since it costs
  nothing and blunts accidental double-posts as much as abuse.

**Transparency**: the discussion section should carry a short, permanent
note along the lines of "Comments are drawn from the public Nostr network.
This site hides some content it judges to be spam or abusive, but that
content may still be visible elsewhere on Nostr" and a link to a short,
plain-language moderation policy page. Distinguishing collapsed-by-trust-tier
from hidden-by-blocklist in the UI (a small "1 comment hidden" affordance
that expands, versus true silent removal) keeps the system honest about
what it is doing.

---

## 6. Security and threat model

All Nostr event content is untrusted input, full stop, regardless of
signature validity: a validly signed event can still contain a script tag,
a malicious link, or oversized content.

| Risk | Mitigation |
|---|---|
| XSS from event content | Comments render as plain text only. NIP-22 already mandates plaintext `.content` (no HTML/Markdown), which the widget should enforce defensively by never using `innerHTML` on event content, treating it as a text node regardless of what the raw string contains. |
| Unsafe Markdown/HTML rendering | Official long-form posts (`kind:30023`) do permit Markdown; if these are rendered anywhere on the site, run content through a strict allow-list sanitizer (e.g. DOMPurify) after Markdown parsing, never raw. |
| Malicious links/embedded media | Render links as inert text plus an explicit "open link" affordance rather than auto-linking and auto-embedding; do not fetch or preview arbitrary linked media by default. |
| NIP-07 signer abuse | The widget only ever asks the signer to sign the exact event object it constructs and displays for confirmation; it never requests broad permissions or attempts to sign silently in the background. |
| Event spoofing / impersonation of the official account | Signature verification is mandatory before render (a forged pubkey claim is caught immediately by signature check). Additionally, the official account is visually marked only when its NIP-05 identifier resolves and matches, not merely when the pubkey string matches, since pubkey display can be visually spoofed with similar-looking npubs. |
| NIP-05 verification | Fetched over HTTPS from the domain the identifier claims (e.g. `zip@zipinit.org` resolves against `zipinit.org/.well-known/nostr.json`), cached briefly client-side; a failed or mismatched lookup removes the "verified" badge rather than failing open. |
| Relay poisoning (a relay serving altered events) | Irrelevant to integrity since events are signed and the signature covers the content; a relay can only withhold or reorder events, not forge them undetected. Malicious relays are handled by the multi-relay, deduplicate-and-verify approach already in place. |
| Duplicate/replayed events | Deduplicated by event ID; replays of an already-seen, already-verified event are simply no-ops. |
| Excessively large events | Enforce a client-side size cap on rendered content (truncate with "read more" or refuse to render past a threshold) independent of any relay-side limit, since a relay is not guaranteed to enforce one. |
| Denial of service (flooding a thread) | Pagination/incremental loading (section 10) plus the trust-tier collapsing in section 5 keeps a flood from becoming a rendering or scrolling disaster even if the flood is not fully filtered. |
| Browser storage | No private keys or signing material ever touch browser storage. Any local caching (recent event IDs to speed re-render) uses `sessionStorage` at most, cleared per session, and holds no secrets. |
| Content Security Policy | Ship a CSP that permits WebSocket connections only to the configured relay list, restricts script-src to the site's own bundled assets (no inline scripts, no remote script loading), and disallows `unsafe-eval`. |
| Dependency supply chain | Prefer a small, audited, actively maintained library (see section 8) pinned to an exact version with a lockfile and subresource integrity hash on the bundled asset, rather than pulling from a CDN unpinned. |
| Privacy leaks / visitor IP exposure to relays | Unavoidable in the base case: any browser opening a WebSocket to a relay reveals its IP to that relay, the same as any web request. Document this plainly in the site's privacy notice; do not attempt a false promise of anonymity. Visitors wanting more can be pointed to using their own Nostr client instead of the embedded widget. |
| Metadata leakage from read/write activity | Minimize subscription scope (query only this page's thread, not a broad firehose) so relays cannot easily infer overall site traffic patterns from widget queries; avoid any analytics that would correlate Nostr activity with other visitor behavior. |

---

## 7. Hugo integration and front matter

Proposed front matter, close to the draft but tightened:

```yaml
nostrDiscussion: true       # enable the widget on this page
nostrLocked: false          # true hides the post box, shows existing comments read-only
nostrTrustMode: "collapse"  # "collapse" (default) | "open" (no first-timer collapsing)
nostrPublish: false         # true triggers the CI publishing step for Journal articles
nostrEventId: ""            # populated by CI after nostrPublish runs, for rel="alternate"
```

Renamed a couple of fields from the draft (`nostrCommentsLocked` to
`nostrLocked`, `nostrModerationMode` to `nostrTrustMode`) mainly for
brevity and to avoid the field name implying comment content itself is
being moderated rather than display trust. `nostrRootEvent` is dropped in
favor of URL-anchoring per section 1; `nostrPublish`/`nostrEventId` are
added since the draft's fields covered comments but not the separate
official-publishing workflow.

**Which content types get comments**: Journal articles and policy papers by
default (set at the archetype/section level so individual pages do not need
to opt in one by one); the homepage, charter, and contact pages do not, and
should not need per-page overrides to stay that way.

**Canonical URLs**: already stable in this site's model (explicit `url:`
front matter for top-level pages, Hugo's directory-style permalinks
elsewhere). The widget should read the same canonical URL Hugo already
emits in the page's `<link rel="canonical">` tag, so there is a single
source of truth rather than a second URL computation living in the widget.

**URL changes and aliases**: since comments are keyed to the exact
canonical URL string, a URL change without a Hugo `aliases:` redirect
orphans existing comments from the new URL (they remain visible if you know
the old URL, just not attached to the page anymore). Practical mitigation:
treat "this page's canonical URL is now permanent" as a checklist item
before publishing, same discipline the site already applies to the
`url:` front matter field per the README's conventions; and when a
genuine rename is unavoidable, have the widget optionally accept a list
of prior canonical URLs for a page (a `nostrPriorUrls:` front matter
field) so it can query both the current and historical URL tags and merge
results.

**Translated pages**: share the underlying topic but should get separate
discussion threads keyed to each translation's own canonical URL, since
NIP-22's plaintext-only content field cannot reasonably host a
multilingual merged thread, and readers of one language should not need to
wade through comments in another to find relevant replies.

**Draft/staging URLs**: since Netlify-style preview URLs are not in play
here (this is GitHub Pages, single production domain), the main risk is a
local `hugo server` preview at `localhost:1313` accidentally creating
real, permanently-anchored comment threads if someone tests posting from
it. Mitigation: the widget checks `window.location.hostname` and disables
the post button (read-only) on any hostname other than `zipinit.org`,
regardless of what canonical URL front matter claims.

**Article migrations**: covered by the same aliases/prior-URL mechanism
above; there is no separate migration concern beyond keeping the canonical
URL stable or explicitly carrying the old one forward.

**Bundling JavaScript**: bundle and self-host the widget's JS/CSS as a
static asset copied into `public/` (same passthrough pattern the site
already uses for other static assets), rather than loading from a CDN at
runtime, for both the CSP and supply-chain reasons in section 6.

**Configuration vs content separation**: relay list and moderation
lists live in versioned static JSON files (section 4), not in Hugo content
front matter, so operational changes (adding a relay, blocking a pubkey) do
not require touching article content and are easy to audit as a focused
diff.

**Dev/staging/production differences**: minimal, since there is one
production domain and no staging environment described in the current
hosting setup. If a staging environment is added later, point it at a
separate relay-list config (or a `nostrLocked: true` default) so
staging never creates real production comment threads.

---

## 8. Library vs custom integration

**Recommendation: use an existing, focused low-level library for protocol
mechanics (event construction, signing requests, relay pool management,
verification), and write the UI and moderation logic custom.**

- A general-purpose Nostr toolkit (the ecosystem's `nostr-tools` is the
  most widely used example, small, dependency-light, and focused purely on
  protocol primitives rather than UI) handles the parts that are easy to
  get subtly wrong: event serialization for signing, signature
  verification, relay connection pooling and reconnection, and NIP-19
  encoding for npub/nevent/naddr identifiers. Reimplementing this custom
  is significant, ongoing security surface for very little benefit, since
  the protocol-level logic does not touch this site's specific design
  choices at all.
- The **rendering, moderation, trust-tier collapsing, front-matter
  integration, and progressive-enhancement behavior are genuinely specific
  to this site** and should be hand-written rather than adopting a
  larger, opinionated "drop-in comments widget" package, most of which
  assume a social-feed aesthetic, pull in more dependencies than needed,
  and are harder to audit line by line for the security properties in
  section 6.
- **Maintenance burden**: a small protocol library plus custom UI is
  roughly the maintenance load of "review and bump one small dependency
  occasionally, plus own the rendering code you already understand," which
  is considerably lighter than either a fully custom protocol
  implementation (constant risk of protocol drift as NIPs evolve) or a
  large all-in-one widget (opaque dependency, harder to security-review,
  drags in its own sub-dependencies).
- **Browser compatibility**: WebSocket and the Web Crypto primitives the
  library depends on are broadly supported in evergreen browsers; no
  polyfill strategy should be necessary for a modern-browsers-first
  advocacy site, though the progressive-enhancement requirement (readable
  content without JS) covers the fallback case regardless of browser age.
- **Long-term stability**: pin an exact version, vendor or lock the
  dependency, and treat protocol library upgrades as a deliberate,
  reviewed event rather than an automatic minor-version bump, since a
  library update could silently change signing or verification behavior.

---

## 9. Signing and key management (official account)

Private keys must never live in the Hugo repo, Hugo config, CI logs, or
browser code. Recommended workflow:

1. Generate the official account's key pair once, offline, with a
   dedicated tool (not a browser extension used for anything else).
2. Store the `nsec` in a secrets manager separate from the GitHub repo
   (a small dedicated signing service's own environment secret store, or
   a hardware-backed secret store if the volume of official posts justifies
   the operational overhead; for a small advocacy site's publishing
   cadence, a well-isolated small VPS or serverless function with secrets
   injected at runtime, never logged, is proportionate).
3. **Never put the key in GitHub Actions secrets that get injected into a
   build step that also runs arbitrary Hugo/theme code.** Keep official
   signing entirely out of the main CI pipeline; have the main CI pipeline
   at most call an authenticated endpoint on the separate signing service
   with the article's public metadata (title, URL, tags), never the key
   itself.
4. The signing service's only job is: accept a small, validated payload,
   construct the `kind:1`/`kind:30023` event, sign it, publish it to the
   relay set, and return the event ID. It should authenticate the calling
   CI job (a shared secret or short-lived token, itself stored outside the
   repo) so it cannot be triggered by an arbitrary pull request.
5. Rotate the key if it is ever suspected of exposure, publishing a
   `kind:1776`-style migration notice if the ecosystem convention for key
   rotation is in place at implementation time, and update the NIP-05
   `.well-known/nostr.json` mapping to the new pubkey.

This mirrors the same discipline the project already applies to its PGP
key for `expand@zipinit.org` per the README, just for a different signing
mechanism.

---

## 10. Accessibility and performance

- Semantic HTML throughout: `<article>`/`<section>` for the discussion
  block, an actual `<ol>`/`<li>` structure for threaded replies rather than
  nested `<div>`s, a real `<form>`-equivalent (or accessible custom control)
  for the reply box with a proper `<label>`.
- Keyboard navigation: all expand/collapse controls and the post button
  are reachable and operable via keyboard alone, with visible focus
  states matching the rest of the site's existing (minimal) visual style.
- Screen-reader labels: an `aria-live` region announces "comment posted" /
  "publish failed" status changes without requiring focus to move there.
- Focus handling: opening a reply box moves focus into it; submitting or
  cancelling returns focus to a sensible prior point rather than the top
  of the page.
- Reduced motion: any expand/collapse transition respects
  `prefers-reduced-motion`.
- Pagination/incremental loading: fetch and render top-level comments in
  small batches (a "load more" control) rather than requesting an unbounded
  result set, and only fetch a branch's replies on expand.
- Relay subscription limits: close subscriptions once the initial result
  set is in and no live-update use case is intended for phase 1 to 3 (a
  one-shot fetch, not a standing subscription), to avoid long-lived
  WebSocket connections that cost battery and bandwidth on mobile for no
  visitor-facing benefit at this stage. Consider live subscriptions only if
  and when real-time updates are actually wanted.
- Mobile performance: bundle size for the widget should stay small (a
  protocol library plus hand-written UI, no framework, should comfortably
  fit in a modest budget, well under the size of a typical single hero
  image); lazy-load the widget's script so it does not block the article's
  own content from rendering and being readable immediately.
- Slow connections / relay timeout behavior: per-relay timeout (section 3)
  ensures a slow relay degrades the completeness of the shown comments, not
  the load time of the page around them; the widget should render
  progressively as each relay responds rather than waiting for all of
  them.
- Thousands of events: the size cap (section 6), pagination, and trust-tier
  collapsing together bound how much is ever rendered at once regardless of
  how much a relay returns.

---

## 11. Implementation options compared

| | (1) Fully client-side widget | (2) Static Hugo + small serverless aggregation | (3) Project-operated relay/indexer + client interface |
|---|---|---|---|
| Complexity | Low to moderate | Moderate (adds a backend to maintain) | High |
| Cost | Near zero (static hosting only) | Low, but ongoing (function invocations, cold starts) | Moderate to high (relay hosting, uptime, storage growth) |
| Security | Smallest server-side attack surface; all risk is client-side (section 6) | Adds a server-side surface (the aggregation function itself) | Largest surface: relay software, storage, and its own moderation/auth |
| Privacy | Visitor connects directly to relays (their IP is visible to relays, not to a project server) | Project server can see every visitor's read/write activity if it proxies requests | Project relay sees more visitor activity than option 1 if visitors are steered to it |
| Moderation capability | Client-side only (sections 5), fully adequate for a display-layer decision | Same client-side tools, plus a server-side chokepoint if ever needed | Strongest: full control over what the relay itself accepts or serves |
| Performance | Depends on relay responsiveness; mitigated by parallel queries and timeouts | An extra network hop through the aggregation function before relays | Can be fastest for cache hits once warm; adds an operational tier |
| Reliability | No single point of failure beyond the visitor's own network | Aggregation function becomes a new single point of failure | Relay uptime becomes a real operational responsibility |
| Maintenance burden | Low: a static asset and two small JSON config files | Moderate: a deployed function, its dependencies, its own security patching | High: relay software updates, storage growth, backups, abuse handling |
| Portability | High: nothing project-specific to migrate away from | Moderate: tied to whichever serverless platform is chosen | Lower: relay operational knowledge and data become sunk investment |
| Platform dependency risk | Minimal | Tied to a serverless vendor | Tied to relay software choice and hosting provider |
| Preserves static architecture | Fully | Mostly (one small satellite service) | Partially (a meaningful new operated service) |

**Recommendation: option 1 for phases 1 to 4, evolving into a hybrid of 1
and 3 (a lightweight project relay used only for caching/durability, not
as the primary path) by phase 6.** This keeps the site static and the
attack surface small for as long as possible, and only takes on relay
operation once archival/durability needs (section 12) actually justify it.

---

## 12. Data ownership and durability

Nostr's network should be treated as **transport, not the sole source of
truth**, for anything the project cares about preserving.

- **Cache public events locally**: a periodic job (CI cron, or a small
  script run on the project relay host) pulls the current set of comments
  and official posts and writes them as JSON into the git repo (a
  `data/nostr-archive/` directory), giving a versioned, durable copy
  independent of any relay's continued existence.
- **Export/archive cadence**: a straightforward periodic pull is
  sufficient for a discussion volume this site is likely to see; no
  need for continuous real-time archival in early phases.
- **Storing signed event JSON in git**: yes, for the archive described
  above. This is small, text-based, and diffable, consistent with the
  project's existing "nothing but source in git" discipline.
- **Read-only archive page**: worth adding once volume makes it useful
  (a simple rendered view of the archived JSON, so a comment thread
  remains legible even if every relay carrying it vanished).
- **Operate a project relay**: yes, but per section 4 and 11, as a
  caching/durability layer rather than the primary path.
  Rebuilding threads by querying multiple relays and merging by event ID
  (already how normal reads work) is the day-to-day durability mechanism;
  the periodic git archive is the belt-and-suspenders long-term one.
- **Downloadable discussion archives**: a natural extension of the git
  archive, exposing the same JSON (or a rendered static page of it) as a
  downloadable file per article.
- **Answer for "what's necessary over several years"**: the periodic
  git-archived JSON export is the actual durability guarantee; relays,
  including the project's own, should be assumed to be a convenience layer
  that can be lost without losing the underlying record, since the archive
  is what survives relay churn, policy changes, or the project itself
  changing relay operators.

---

## 13. Phased implementation plan

**Phase 1: Read-only official account feed**
- Components: widget (fetch + render only), relay config JSON, `/discussion/`
  page template.
- Security: signature verification, plaintext rendering, CSP for the new
  page.
- Testing: relay-unavailable fallback, malformed-event handling, XSS
  payload in a test event's content field.
- Deployment: static asset + one new Hugo page/template; no CI changes
  beyond copying the new static assets.
- Exit criteria: feed renders correctly across the site's supported
  browsers, degrades cleanly with JS or relays disabled.
- Deferred: replies/threading, comment posting, moderation UI.

**Phase 2: Read-only article discussions**
- Components: per-article widget instance, front matter fields
  (`nostrDiscussion`, `nostrLocked`), canonical URL wiring.
- Security: same as phase 1, plus verifying `I`/`i` tag matching logic
  is exact (no partial-match false positives across articles).
- Testing: URL-alias edge case, empty-thread messaging, comment-count
  accuracy.
- Deployment: theme partial included in article/policy-paper templates.
- Exit criteria: comments correctly scoped per canonical URL; zero-comment
  state reads clearly to visitors unfamiliar with Nostr.
- Deferred: posting, trust tiers (can default to "open" until posting
  exists).

**Phase 3: NIP-07 signing and comment submission**
- Components: signer detection, event construction/signing flow, NIP-46
  remote-signer path for mobile, publish-status UI.
- Security: strict validation of user input before event construction,
  rate limiting in the UI, CSP covering signer communication.
- Testing: extension present/absent, remote-signer flow on a real mobile
  device, partial-relay-acceptance handling, oversized-comment rejection.
- Deployment: no backend change; still a static asset update.
- Exit criteria: a visitor with no prior project relationship can install
  a signer, post a comment, and see it appear without confusion.
- Deferred: moderation tooling beyond the static blocklist, forum topics.

**Phase 4: Moderation tools and reporting**
- Components: blocklist/trust-tier JSON files, collapsed-comment UI,
  NIP-56 report button, moderation policy page.
- Security: ensure moderation data itself cannot be used as an injection
  vector (validate pubkey/event ID formats strictly).
- Testing: known-bad-pubkey suppression, first-timer collapsing UX,
  report submission.
- Deployment: two new static config files plus their maintenance process.
- Exit criteria: a test spam event is reliably hidden or collapsed without
  hiding legitimate first-time critical comments.
- Deferred: relay-level filtering, automated spam scoring.

**Phase 5: Dedicated forum topics**
- Components: NIP-7D `kind:11` topic roots for each recurring
  objection/question, an index page, per-topic threading via existing
  phase-3/4 infrastructure.
- Security: same as phase 3/4, applied to a new content surface.
- Testing: topic index legibility for Nostr newcomers, thread depth
  handling for a genuinely long-running topic.
- Deployment: a small number of official `kind:11` events published once
  (via the signing service, section 9), plus a new index template.
- Exit criteria: a visitor unfamiliar with Nostr can find and follow a
  named topic thread without confusion about what "forum" means here.
- Deferred: nothing further planned beyond this scope; further categories
  can be added incrementally as new `kind:11` events.

**Phase 6: Archival, relay redundancy, project relay**
- Components: periodic archival job, project relay deployment (caching
  role), downloadable archive pages.
- Security: relay software hardening/patching, backup of archive data
  itself.
- Testing: simulate a public relay disappearing, confirm archive and
  remaining relays still surface the full thread.
- Deployment: new small operated service (the relay) with its own
  uptime/monitoring responsibility, the first genuine departure from
  "purely static hosting" in this plan.
- Exit criteria: a full relay outage across all public relays still
  leaves comments visible via the project relay or the archive.
- Deferred: nothing, this is the terminal phase of the current scope.

---

## 14. Rough maintenance expectations

- **Ongoing, low-effort**: reviewing/updating the blocklist and trust list
  as needed, occasional relay-list curation if a relay degrades.
- **Occasional**: dependency version bumps for the protocol library,
  re-review of the widget bundle after any such bump.
- **Only from phase 6 onward**: relay software patching and uptime
  monitoring, which is the one piece of this plan with real ongoing
  operational weight; everything before that stays close to the site's
  current "push to `main`, CI builds and deploys" maintenance model.
- **Signing service** (section 9): minimal day-to-day attention once set
  up, but deserves a periodic access/secret review given it is the one
  place the official private key lives.

---

## 15. Open decisions

- Exact default relay list (needs evaluation of current uptime/spam
  reputation at implementation time, not locked in this document).
- Where the signing service and, later, the project relay are hosted (a
  small VPS the project already controls versus a managed platform).
- Whether NIP-46 remote-signer support ships in phase 3 or is deferred to a
  later mobile-specific pass, depending on how much mobile traffic the site
  actually sees.
- Exact wording and placement of the moderation-transparency notice and
  policy page.
- Whether official long-form articles get a full `kind:30023` mirror or
  only a `kind:1` announcement plus canonical link, balancing content
  duplication against discoverability inside native Nostr clients.
- Threshold and exact mechanism for eventually standing up the project
  relay in phase 6 (volume-based trigger versus a fixed timeline).
- Whether a `kind:1984` report ever warrants a human-reviewed queue outside
  of "just another event the moderator can see," once report volume (if
  any) is observed.

---

## 16. Proof-of-concept scope

A phase 1 to 2 slice is the right size for a first proof of concept:

- One `/discussion/` page rendering the official feed, read-only.
- Comments enabled on a single Journal article (not the whole section
  yet), read-only, using the exact canonical-URL-anchoring approach from
  section 1.
- Relay config as a static JSON file with 3 relays, no project relay yet.
- No posting, no moderation tooling beyond a hardcoded empty blocklist
  (proving the mechanism exists without needing real entries yet).
- Success criteria: renders correctly, degrades cleanly without JS, passes
  a manual XSS-payload test event, and reads as a discussion area rather
  than a Nostr application to someone with no prior Nostr familiarity.

This validates the core architectural bet (URL-anchored NIP-22 comments,
client-side-only, static-first) before any investment in signing, NIP-46,
moderation tooling, or relay operation.
