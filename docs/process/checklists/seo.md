# Standing SEO checklist

Per-feature SEO review is a **diff against this list**. Amend this file when you learn
something general; do not re-explain it per feature. The venture's organic strategy — which
pages are the money pages and which intents they target — lives in its `CLAUDE.md` or
`knowledge/`; name it in the per-feature review.

## Non-negotiable on any public page
- [ ] One `h1`, and it contains the phrase a person would actually search
- [ ] Title ≤ 60 chars, description ≤ 155, both unique per page, neither generated from a template that repeats
- [ ] URL is readable, lowercase, hyphenated, stable — a URL that changes is a ranking thrown away
- [ ] Server-rendered HTML contains the content. Content that only appears after JS is content that ranks late or never
- [ ] Canonical set; no two URLs serve the same content without one
- [ ] `hreflang` for every language the site serves, each pointing at the others and at itself
- [ ] Internal links use real anchors with descriptive text, not click handlers
- [ ] Images have dimensions and meaningful `alt`; hero image is preloaded
- [ ] Structured data where the page type has one (`Organization`, `LocalBusiness`, `Product`/`Offer`, `BreadcrumbList`, `FAQPage` only if the FAQ is visible on the page)
- [ ] Sitemap includes it; robots does not block it; no accidental `noindex` shipped from a staging default

## Money pages
- [ ] The target intent is in the copy of the page, not only in the metadata, in the language people actually search in
- [ ] Never ship a public page with no indexable text. A widget, a map, an app shell is not content
- [ ] A search or listing widget that fetches its results client-side is a live product decision,
      not a free pass — accept it only while the results contain nothing worth ranking for. The
      day results *are* the thing a page should rank for, the default/first result set must be
      server-rendered or statically snapshotted, with JS only enhancing it. Flag any client-fetch
      pattern that is about to become the page's main content, before it ships that way
- [ ] Freeze the identifier a public URL will be built from **at the moment the underlying record
      is created**, even if the public page itself is a later feature — never derive the URL from
      a field the owner can edit (a display name, a listing title). A rename must never change the
      URL. Cheap as one generated-once column at creation; expensive as a retroactive redirect
- [ ] Where the stated strategy targets a locality or category intent, that attribute is a
      **field captured at data entry**, not derived later from a postcode or geocoded after the
      fact. Retrofitting it after records exist means a data campaign plus a lookup pipeline
- [ ] Authenticated, per-record app routes (a dashboard, account settings) are never in the
      public surface: noindex and out of the sitemap **by construction**, not by remembering to add
      a meta tag per screen. If the site's route-map mechanism only handles a small static set of
      pages, say so before a feature adds dynamic per-record routes that don't fit it

## Gated / not-yet-indexed features
- [ ] A route that is out of scope for indexing this cycle still gets its final, stable URL now,
      decided once — not a placeholder path swapped out later. Opening it to indexing must be a
      `noindex` removal, never a URL change
- [ ] A feature flag and `noindex` are two different controls. "Unreachable while the flag is off"
      says nothing about what happens once the flag is on in production. Register every route —
      indexed or not — in one central route map with an explicit `indexable` flag, so sitemap,
      robots and `<meta name=robots>` are generated from it and cannot drift, and cannot default
      to indexable by omission the day the flag flips
- [ ] A page written once at build time whose backing data changes in production — price, hours,
      live/paused — needs a decided refresh mechanism (rebuild on write, or a carved-out
      server-rendered route) before it is indexed. A stale indexed page is worse than an unindexed one
- [ ] Any link-based access to a personal page (an emailed pass or receipt link) uses a token
      separate from any short, human-typed code, and is `noindex` with a strict `Referrer-Policy` —
      a personal page reachable by URL is a page that can end up indexed or leaked by accident

## Core Web Vitals budget
- [ ] LCP < 2.5s on a mid-range Android over 4G, measured, not assumed
- [ ] CLS < 0.1 — every image and embed reserves space
- [ ] No render-blocking font; text visible during load

## Out of lane
Visual design, brand voice, and whether a feature should exist. File those as P2 or drop them.
