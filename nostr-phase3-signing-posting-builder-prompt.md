# Builder Prompt: Implement and Ship Posting and Signing (Phase 3)

Use this prompt once the read-only PoC (`/discussion/` feed plus article
comments) is live in production per the previous go-live prompt. This
prompt implements phase 3 of the architecture document: NIP-07 signing,
a NIP-46 remote-signer path for mobile, and comment submission, then takes
that live the same way the read-only feature was shipped.

This builds on top of the existing widget (`static/js/nostr-widget.js`,
`static/nostr/relays.json`, `static/nostr/blocklist.json`, the
`nostr-discussion` shortcode/partial, and the `/discussion/` page). Do not
rebuild those; extend them.

Still explicitly out of scope: moderation tooling beyond the existing
empty blocklist, the project-operated relay, forum topics, and the
official-account publishing workflow. Those remain phases 4 to 6. If you
find yourself building a moderation queue, a project relay, or the
official-post CI pipeline, stop, that is a separate future prompt.

---

## 1. Signer detection and the post affordance

- Replace the currently-disabled/inert post control in the widget with a
  real one, gated on signer availability:
  - If `window.nostr` (NIP-07) is present, enable the reply box directly.
  - If it is not present, show a NIP-46 remote-signer connection option
    (see section 2) as the primary mobile-friendly path, alongside brief,
    plain-language setup guidance for installing a NIP-07 browser
    extension as the desktop alternative. Never show a bare error state;
    always show one of these two paths.
- The reply box itself: a plaintext textarea (NIP-22 content is plaintext
  only, no Markdown/HTML, enforce this by not offering any rich-text
  controls), a visible character limit, and a submit control that is
  disabled while empty or over the limit.
- Threading: the reply box for a top-level comment constructs a
  `kind:1111` event whose root and parent both point at the article's
  canonical URL (`I`/`K` = article URL / `"web"`, `i`/`k` matching). The
  reply box for a reply-to-a-reply points its parent (`e`/`k`) at the
  specific comment being replied to, while the root (`E`/`K`) stays the
  article. Follow the exact tag structure from NIP-22 (uppercase for root
  scope, lowercase for parent, `p`/`P` tags for authors when known).
- For the official feed, replies to a `kind:1` post follow the same
  `kind:1111` NIP-22 comment structure with the post as parent, per the
  architecture document's phase 3 scope; do not build separate NIP-10
  reply handling for this.

## 2. NIP-46 remote signer path

- Implement a "connect a remote signer" flow: generate or accept a
  `bunker://` connection URI, display it as both a copyable string and a
  scannable QR code, and open a NIP-46 session once the visitor's signer
  app approves the connection.
- Keep the NIP-46 client-side session ephemeral: do not persist connection
  state anywhere beyond `sessionStorage` (no `localStorage`, no cookies),
  and re-prompt for a fresh connection on a new browser session rather
  than trying to silently restore a stale one.
- Handle the round-trip explicitly in the UI: "waiting for approval on
  your signer," a timeout if no response arrives within a reasonable
  window (for example 60 seconds), and a clear way to cancel and retry.
- This is the primary path for visitors without a browser extension, so
  test it against at least one real mobile signer app on a real device,
  not just a simulated response, before this ships.

## 3. Event construction and publishing

- Construct the exact `kind:1111` event object client-side, show it to the
  visitor for what it is (a preview of the comment text and, in an
  expandable technical details section, the raw tags) before requesting a
  signature, so nothing is signed the visitor did not see.
- Request the signature via `window.nostr.signEvent(...)` (NIP-07) or the
  active NIP-46 session, whichever applies. Never construct or hold a
  private key anywhere in this code path.
- Publish the signed event to the visitor-write relay set. Per the
  architecture document's relay strategy, this is the default public
  relay set only, not the project relay (visitor writes do not go to a
  project-operated relay in this design).
- Publish in parallel to each relay with a short per-relay timeout, and
  report per-relay outcome: show "published" once at least one relay
  accepts it, and show which relays failed if any did, rather than a
  single opaque success/failure state.
- Optimistically render the visitor's own comment locally the moment
  signing succeeds (before relay confirmation), clearly marked as "still
  publishing" until at least one relay confirms, so the interface does
  not feel like it swallowed the input.
- If every relay rejects or times out, show a clear failure message and
  let the visitor retry without re-typing the comment (keep the drafted
  text in the reply box).

## 4. Input validation and UI-level rate limiting

- Validate before constructing the event: non-empty after trimming,
  under the character limit, no attempt to inject tags the visitor should
  not control (the widget builds the tag set, the visitor only supplies
  `.content`).
- Rate limit in the UI: briefly disable the submit control after a
  successful publish (a few seconds is enough) to blunt accidental
  double-posts and casual flooding, independent of anything the relays or
  a future moderation layer might add.
- Reject and clearly explain (rather than silently truncate) any content
  over the size cap already established for rendering, so a visitor is
  not confused later about why their comment appears cut off.

## 5. Security review additions for this phase

Extend the existing threat-model coverage (already applied to reading)
to the new write path:

- **NIP-07/NIP-46 signer abuse**: the widget requests a signature only
  for the exact event it just displayed to the visitor; it never
  constructs a second event behind the scenes or requests broader signer
  permissions than signing this one event.
- **Impersonation**: nothing about the posting flow should make it
  possible for a visitor's comment to render with the official-account
  badge; that badge remains gated purely on the NIP-05 match already
  built for reading, which a visitor's own pubkey will not satisfy.
- **CSP**: confirm `connect-src` still covers exactly the relay set in use
  (visitor-write relays, same as the read set per the architecture
  document) and add whatever NIP-46 relay/transport the chosen bunker flow
  requires; do not broaden `connect-src` beyond what is actually needed.
- **Browser storage**: confirm no signing material, connection secret, or
  private key touches `localStorage`; NIP-46 session state, if cached at
  all, stays in `sessionStorage` and holds no key material itself (NIP-46
  is designed so the client never sees the key, confirm the library used
  actually honors that).
- **Dependency additions**: if a NIP-46 helper library is added on top of
  the existing protocol library, pin it the same way, and note the exact
  version in your handback.

## 6. Accessibility additions for this phase

- Reply box: proper `<label>`, focus moves into it when a reply is
  opened, and back to a sensible point after submit or cancel (per the
  architecture document's accessibility section, already partially built
  for the read-only case; extend it here rather than introducing a second
  pattern).
- `aria-live` announcements for signer-connection state changes
  ("waiting for approval," "connected," "publishing," "published,"
  "failed") so a screen-reader user is not left guessing at a
  silently-changing button state.
- Keyboard-only path: confirm the entire connect-a-signer through
  publish-a-comment flow is operable without a mouse, including the QR
  code screen (which needs a text-copyable fallback regardless, per
  section 1).

## 7. Testing checklist for this phase

- [ ] NIP-07 extension present: comment constructs correctly, signs,
      publishes, and renders with a "still publishing" then "published"
      state.
- [ ] No NIP-07 extension: NIP-46 remote-signer path is offered instead
      of an error; connecting a real mobile signer app completes the
      flow end to end.
- [ ] Partial relay acceptance (one relay accepts, others time out or
      reject): UI correctly reports "published" once one succeeds, with
      the per-relay detail available, not just a blanket failure.
- [ ] All relays reject or time out: clear failure state, drafted text is
      preserved for retry.
- [ ] Oversized comment: rejected with a clear message before any signing
      request is made, not after.
- [ ] Reply-to-a-reply produces the correct parent/root tag structure
      (verify by inspecting the raw published event, not just the
      rendered UI).
- [ ] Rate limiting: rapid repeated submit attempts are blocked briefly
      after a successful publish.
- [ ] No signing material appears in `localStorage` at any point (check
      dev tools application storage directly).
- [ ] Keyboard-only run-through of the full connect-then-post flow.
- [ ] `aria-live` announcements fire correctly at each state transition
      (verify with a screen reader, not just by reading the code).

## 8. Sitemap, changelog, and CSP finalization for go-live

Same discipline as the previous go-live prompt, applied to this
increment:

- Update `CHANGELOG.md` with a dated entry once this ships, in the file's
  existing style, for example:
  ```
  ## <merge date>
  - Added NIP-07 and NIP-46 comment posting to the discussion widget
  - Added publish-status and signer-connection UI
  ```
  Adjust to match what actually shipped.
- Confirm the CSP change (any added `connect-src` entries for NIP-46) is
  live in production and does not reintroduce a blocked-resource error
  for the existing read-only functionality.
- No new sitemap entries are needed for this increment (no new pages),
  but bump `lastmod` on `/discussion/` and any article whose comment
  section behavior meaningfully changed.

## 9. Pre-merge and post-deploy review

Follow the same pre-merge checklist as the previous go-live prompt
(no secrets in the diff, `public/` still gitignored, Pages source setting
unchanged), plus:

- [ ] Confirm posting is fully disabled/read-only again if loaded from any
      hostname other than `zipinit.org` (the existing hostname check from
      the read-only build should already cover this; confirm it still
      does now that a real post path exists to guard).
- [ ] Load production after deploy and post one real test comment on a
      low-traffic page using a real signer, confirm it appears correctly,
      then note it in your handback so it can be manually removed from
      the relays if desired (there is no delete mechanism in this design;
      treat any live test post as a real, permanent comment).

## Rollback plan

If signing/posting misbehaves in production, revert the merge commit on
`main` the same way as the read-only rollback; the read-only feed and
article comments should continue working unaffected, since posting is an
additive layer on top of the existing read path, not a replacement for it.
Confirm this additive property in a final check before relying on it as
the rollback plan.

## What to hand back

- Which signer libraries/versions were pinned (NIP-07 helper if any,
  NIP-46 client).
- Confirmation that a real mobile signer app was used for at least one
  end-to-end NIP-46 test, and which app.
- Completed testing checklist with pass/fail per item.
- Confirmation of the CSP, changelog, and sitemap-lastmod updates.
- Note of any live test comment posted to production during verification,
  so it can be reviewed or left in place as the first real comment.
