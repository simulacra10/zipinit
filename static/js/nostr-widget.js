/*
 * Nostr discussion widget (phase 1-2 proof of concept).
 * Read-only: official feed (kind:1) and per-article comments (NIP-22 kind:1111
 * anchored to the page's canonical URL). No posting/signing in this build —
 * see nostr-discussion-architecture.md and nostr-poc-builder-prompt.md.
 *
 * Depends on window.NostrTools (static/nostr/vendor/nostr-tools.*.min.js),
 * loaded as a classic <script> before this file.
 */
(function () {
  "use strict";

  var RELAY_TIMEOUT_MS = 3000;
  var PAGE_SIZE = 20;
  var CONTENT_CAP = 2000;
  var CONFIG_BASE = "/nostr/";

  var configPromise = null;
  var nip05BadgeCache = Object.create(null);

  function loadConfig() {
    if (configPromise) return configPromise;
    configPromise = Promise.all([
      fetch(CONFIG_BASE + "relays.json").then(function (r) { return r.json(); }),
      fetch(CONFIG_BASE + "blocklist.json")
        .then(function (r) { return r.json(); })
        .catch(function () { return { pubkeys: [], eventIds: [] }; })
    ]).then(function (results) {
      var relayConfig = results[0];
      var blocklist = results[1];
      // Decoded once here, cached for the lifetime of the page per the
      // architecture doc — not re-decoded on every render.
      var officialPubkeyHex = window.NostrTools.nip19.decode(relayConfig.officialNpub).data;
      return {
        relays: relayConfig.relays,
        officialPubkeyHex: officialPubkeyHex,
        officialNip05: relayConfig.officialNip05,
        blocklist: blocklist
      };
    });
    return configPromise;
  }

  function isBlocked(event, blocklist) {
    return (
      blocklist.pubkeys.indexOf(event.pubkey) !== -1 ||
      blocklist.eventIds.indexOf(event.id) !== -1
    );
  }

  // Queries relays in parallel via a single subscription, calling onevent as
  // results stream in (so a slow relay doesn't block ones that already
  // answered) and onclose once every relay has either EOSE'd or hit the
  // shared timeout. No standing subscription is kept afterward.
  function queryProgressive(pool, relays, filter, onevent, onclose) {
    var failedRelays = Object.create(null);
    var closer = pool.subscribeEose(relays, filter, {
      maxWait: RELAY_TIMEOUT_MS,
      onevent: onevent,
      oninvalidevent: function () {
        // Malformed events are dropped silently; nothing to render.
      },
      onclose: function (closes) {
        onclose(closes, failedRelays);
      }
    });
    pool.onRelayConnectionFailure = function (url) {
      failedRelays[url] = true;
    };
    return closer;
  }

  function verifiedAndAllowed(event, blocklist) {
    if (isBlocked(event, blocklist)) return false;
    if (!window.NostrTools.verifyEvent(event)) {
      console.warn("nostr-widget: dropped event with invalid signature", event.id);
      return false;
    }
    return true;
  }

  function shortenPubkey(hex) {
    return hex.slice(0, 8) + "…" + hex.slice(-4);
  }

  function formatTime(unixSeconds) {
    try {
      return new Date(unixSeconds * 1000).toLocaleString();
    } catch (e) {
      return "";
    }
  }

  // Renders event.content as plain text only, regardless of what the string
  // contains — NIP-22 mandates plaintext content, and this is enforced here
  // defensively rather than trusted from the relay.
  function renderContentNode(content) {
    var wrap = document.createElement("div");
    wrap.className = "nostr-content";
    var truncated = content.length > CONTENT_CAP;
    var shown = truncated ? content.slice(0, CONTENT_CAP) : content;
    var textNode = document.createTextNode(shown + (truncated ? "…" : ""));
    wrap.appendChild(textNode);
    if (truncated) {
      var full = false;
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "nostr-readmore";
      toggle.textContent = "Read more";
      toggle.addEventListener("click", function () {
        full = !full;
        wrap.textContent = "";
        wrap.appendChild(
          document.createTextNode(full ? content : shown + "…")
        );
        toggle.textContent = full ? "Show less" : "Read more";
        wrap.appendChild(toggle);
      });
      wrap.appendChild(toggle);
    }
    return wrap;
  }

  function checkOfficialBadge(config, pubkeyHex) {
    if (pubkeyHex !== config.officialPubkeyHex) return Promise.resolve(false);
    if (nip05BadgeCache[pubkeyHex] !== undefined) {
      return Promise.resolve(nip05BadgeCache[pubkeyHex]);
    }
    return window.NostrTools.nip05
      .queryProfile(config.officialNip05)
      .then(function (profile) {
        var ok = !!profile && profile.pubkey === pubkeyHex;
        nip05BadgeCache[pubkeyHex] = ok;
        return ok;
      })
      .catch(function () {
        // Fail closed: a failed or mismatched lookup removes the badge
        // rather than showing it anyway.
        nip05BadgeCache[pubkeyHex] = false;
        return false;
      });
  }

  function renderEventItem(event, config, options) {
    var li = document.createElement("li");
    li.className = "nostr-item";

    var article = document.createElement("article");
    var header = document.createElement("div");
    header.className = "nostr-item-meta";

    var author = document.createElement("span");
    author.className = "nostr-author";
    author.textContent = shortenPubkey(event.pubkey);
    header.appendChild(author);

    var time = document.createElement("time");
    time.dateTime = new Date(event.created_at * 1000).toISOString();
    time.textContent = formatTime(event.created_at);
    header.appendChild(time);

    article.appendChild(header);
    article.appendChild(renderContentNode(event.content));

    checkOfficialBadge(config, event.pubkey).then(function (isOfficial) {
      if (isOfficial) {
        var badge = document.createElement("span");
        badge.className = "nostr-badge";
        badge.textContent = "Official account";
        header.insertBefore(badge, time);
      }
    });

    if (options.allowExpand) {
      var expandBtn = document.createElement("button");
      expandBtn.type = "button";
      expandBtn.className = "nostr-expand";
      expandBtn.setAttribute("aria-expanded", "false");
      expandBtn.textContent = "View replies";
      var repliesContainer = document.createElement("ol");
      repliesContainer.className = "nostr-replies";
      repliesContainer.hidden = true;
      var loaded = false;

      expandBtn.addEventListener("click", function () {
        var expanded = expandBtn.getAttribute("aria-expanded") === "true";
        expandBtn.setAttribute("aria-expanded", String(!expanded));
        repliesContainer.hidden = expanded;
        if (!expanded) {
          expandBtn.textContent = "Hide replies";
          if (!loaded) {
            loaded = true;
            options.loadReplies(event, repliesContainer);
          }
        } else {
          expandBtn.textContent = "View replies";
        }
      });

      article.appendChild(expandBtn);
      article.appendChild(repliesContainer);
    }

    li.appendChild(article);
    return li;
  }

  function setStatus(statusEl, message) {
    statusEl.textContent = message;
  }

  function mountFeed(root, config) {
    var pool = new window.NostrTools.SimplePool();
    var listEl = root.querySelector(".nostr-list");
    var statusEl = root.querySelector(".nostr-status");
    var loadMoreBtn = root.querySelector(".nostr-load-more");

    var seenTopLevel = 0;
    var events = [];
    var untilCursor = undefined;

    function isReply(event) {
      // NIP-10: a kind:1 with an "e" tag is a reply to another note, not a
      // top-level post — excluded from the official feed's top-level list.
      for (var i = 0; i < event.tags.length; i++) {
        if (event.tags[i][0] === "e") return true;
      }
      return false;
    }

    function loadReplies(parentEvent, container) {
      var innerStatus = document.createElement("p");
      innerStatus.className = "nostr-status";
      innerStatus.setAttribute("aria-live", "polite");
      innerStatus.textContent = "Loading replies…";
      container.appendChild(innerStatus);

      var filter = { kinds: [1111], "#e": [parentEvent.id], limit: 50 };
      var found = [];
      queryProgressive(
        pool,
        config.relays,
        filter,
        function (event) {
          if (!verifiedAndAllowed(event, config.blocklist)) return;
          found.push(event);
        },
        function (closes, failedRelays) {
          innerStatus.remove();
          if (found.length === 0) {
            var allFailed = closes.length > 0 && Object.keys(failedRelays).length >= config.relays.length;
            var empty = document.createElement("p");
            empty.className = "nostr-status";
            empty.textContent = allFailed
              ? "Couldn't reach any relay to load replies."
              : "No replies yet.";
            container.appendChild(empty);
            return;
          }
          found.sort(function (a, b) { return a.created_at - b.created_at; });
          found.forEach(function (event) {
            container.appendChild(
              renderEventItem(event, config, { allowExpand: false })
            );
          });
        }
      );
    }

    function loadPage() {
      setStatus(statusEl, "Loading posts…");
      loadMoreBtn.hidden = true;
      var filter = { kinds: [1], authors: [config.officialPubkeyHex], limit: PAGE_SIZE };
      if (untilCursor) filter.until = untilCursor;

      var pageEvents = [];
      queryProgressive(
        pool,
        config.relays,
        filter,
        function (event) {
          if (isReply(event)) return;
          if (!verifiedAndAllowed(event, config.blocklist)) return;
          pageEvents.push(event);
        },
        function (closes, failedRelays) {
          var allFailed = closes.length > 0 && Object.keys(failedRelays).length >= config.relays.length;
          if (allFailed && pageEvents.length === 0) {
            setStatus(statusEl, "Couldn't reach any relay. Try again later, or read on Nostr directly.");
            return;
          }
          pageEvents.sort(function (a, b) { return b.created_at - a.created_at; });
          // De-dup against anything already rendered (relays can repeat
          // results across "load more" pages near the pagination boundary).
          pageEvents = pageEvents.filter(function (e) {
            return events.indexOf(e.id) === -1;
          });

          if (pageEvents.length === 0 && seenTopLevel === 0) {
            setStatus(statusEl, "No posts yet.");
            return;
          }

          pageEvents.forEach(function (event) {
            events.push(event.id);
            seenTopLevel++;
            untilCursor = event.created_at - 1;
            listEl.appendChild(
              renderEventItem(event, config, { allowExpand: true, loadReplies: loadReplies })
            );
          });

          setStatus(statusEl, seenTopLevel + " post" + (seenTopLevel === 1 ? "" : "s") + " shown.");
          if (pageEvents.length === PAGE_SIZE) {
            loadMoreBtn.hidden = false;
          }
        }
      );
    }

    loadMoreBtn.addEventListener("click", loadPage);
    loadPage();
  }

  function mountComments(root, config) {
    var pool = new window.NostrTools.SimplePool();
    var listEl = root.querySelector(".nostr-list");
    var statusEl = root.querySelector(".nostr-status");
    var countEl = root.querySelector(".nostr-count");
    var loadMoreBtn = root.querySelector(".nostr-load-more");
    var canonicalUrl = root.getAttribute("data-canonical-url");

    var seenIds = [];
    var untilCursor = undefined;

    function loadReplies(parentEvent, container) {
      var innerStatus = document.createElement("p");
      innerStatus.className = "nostr-status";
      innerStatus.setAttribute("aria-live", "polite");
      innerStatus.textContent = "Loading replies…";
      container.appendChild(innerStatus);

      var filter = { kinds: [1111], "#e": [parentEvent.id], "#I": [canonicalUrl], limit: 50 };
      var found = [];
      queryProgressive(
        pool,
        config.relays,
        filter,
        function (event) {
          if (!verifiedAndAllowed(event, config.blocklist)) return;
          found.push(event);
        },
        function (closes, failedRelays) {
          innerStatus.remove();
          if (found.length === 0) {
            var allFailed = closes.length > 0 && Object.keys(failedRelays).length >= config.relays.length;
            var empty = document.createElement("p");
            empty.className = "nostr-status";
            empty.textContent = allFailed
              ? "Couldn't reach any relay to load replies."
              : "No replies yet.";
            container.appendChild(empty);
            return;
          }
          found.sort(function (a, b) { return a.created_at - b.created_at; });
          found.forEach(function (event) {
            container.appendChild(
              renderEventItem(event, config, { allowExpand: false })
            );
          });
        }
      );
    }

    function loadPage() {
      setStatus(statusEl, "Loading comments…");
      loadMoreBtn.hidden = true;
      // Root-scope NIP-22 filter: kind:1111 comments anchored directly to
      // this page's canonical URL ("web" external-content kind, NIP-73).
      var filter = { kinds: [1111], "#I": [canonicalUrl], "#K": ["web"], limit: PAGE_SIZE };
      if (untilCursor) filter.until = untilCursor;

      var pageEvents = [];
      queryProgressive(
        pool,
        config.relays,
        filter,
        function (event) {
          // Exclude replies-to-a-comment (they carry a lowercase "e" parent
          // tag distinct from the root "I" tag) from the top-level list.
          for (var i = 0; i < event.tags.length; i++) {
            if (event.tags[i][0] === "e") return;
          }
          if (!verifiedAndAllowed(event, config.blocklist)) return;
          pageEvents.push(event);
        },
        function (closes, failedRelays) {
          var allFailed = closes.length > 0 && Object.keys(failedRelays).length >= config.relays.length;
          if (allFailed && pageEvents.length === 0 && seenIds.length === 0) {
            setStatus(statusEl, "Couldn't reach any relay. Comments may still exist on Nostr even though none loaded here.");
            countEl.textContent = "";
            return;
          }
          pageEvents.sort(function (a, b) { return b.created_at - a.created_at; });
          pageEvents = pageEvents.filter(function (e) {
            return seenIds.indexOf(e.id) === -1;
          });

          if (pageEvents.length === 0 && seenIds.length === 0) {
            setStatus(statusEl, "No comments yet.");
            countEl.textContent = "0 comments";
            return;
          }

          pageEvents.forEach(function (event) {
            seenIds.push(event.id);
            untilCursor = event.created_at - 1;
            listEl.appendChild(
              renderEventItem(event, config, { allowExpand: true, loadReplies: loadReplies })
            );
          });

          countEl.textContent = seenIds.length + " comment" + (seenIds.length === 1 ? "" : "s");
          setStatus(statusEl, "");
          if (pageEvents.length === PAGE_SIZE) {
            loadMoreBtn.hidden = false;
          }
        }
      );
    }

    loadMoreBtn.addEventListener("click", loadPage);
    loadPage();
  }

  function mount(root) {
    var mode = root.getAttribute("data-mode");
    var locked = root.getAttribute("data-locked") === "true";

    loadConfig().then(function (config) {
      if (mode === "feed") {
        mountFeed(root, config);
      } else {
        mountComments(root, config);
      }
      // Posting is out of scope for this build; the post box (if present in
      // markup) stays permanently disabled here so phase 3 has a clear,
      // already-wired attachment point without implying posting works now.
      var postBox = root.querySelector(".nostr-post-box");
      if (postBox) {
        postBox.setAttribute("aria-disabled", "true");
        var postFields = postBox.querySelectorAll("textarea, button");
        for (var i = 0; i < postFields.length; i++) postFields[i].disabled = true;
      }
      if (locked) {
        var postBoxLocked = root.querySelector(".nostr-post-box");
        if (postBoxLocked) postBoxLocked.hidden = true;
      }
    }).catch(function (err) {
      console.error("nostr-widget: failed to load config", err);
      var statusEl = root.querySelector(".nostr-status");
      if (statusEl) setStatus(statusEl, "Couldn't load the discussion configuration.");
    });
  }

  function init() {
    var roots = document.querySelectorAll(".nostr-discussion[data-mode]");
    for (var i = 0; i < roots.length; i++) {
      mount(roots[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
