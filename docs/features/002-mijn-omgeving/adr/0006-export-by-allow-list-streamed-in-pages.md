# ADR-0006 — The export maps by allow-list and is streamed in pages

*2026-11-11 · status: accepted*

## Context
`exportMyData` (`core/shared/my-data.ts`) returns `db.listChannels()` whole; the Google
callback stores `meta.refreshToken` and `meta.accessToken` (scope `business.manage`), so a
downloaded file is a credential (A1). The function also loops every scan run and its samples
in memory; AC-7 asks for 36 checks × up to 500 answers each plus claims, 500 findings and
2,000 events to download within Worker limits. A streamed body outlives the route handler's
async scope, where `getDb()` reads the request's handle (`withDb()`).

## Decision
- `exportChannel(c)` keeps a fixed set of channel fields and only the `meta` keys in
  `CHANNEL_META_EXPORT_KEYS` (listed in `02-architecture.md`); anything else is dropped,
  including keys that do not exist yet.
- A test seeds token values and an unknown secret-looking key and fails if any of those
  strings appears anywhere in the serialised export.
- `streamMyData(db, businessId, opts)` writes the same JSON shape section by section: runs
  in pages of 6 with one samples query and one claims query per page, events in pages of 500.
  The Db handle is passed in, never re-read inside the stream.
- `exportMyData` stays as the in-memory form for tests and reuses the same mappers.

## Consequences
**Good:** a new secret in `meta` cannot leak by default; memory stays bounded; the route keeps
working on Workers with the request's own connection.
**Bad:** a useful new `meta` key is missing from the export until someone adds it to the list
(art. 15 relies on that review); a streamed response that fails halfway leaves a truncated
file (the client sees an incomplete download, not an error page).
**We can no longer:** send the export as one `JSON.stringify` of an object, or add a channel
field to it without touching the allow-list.

## Alternatives rejected
| Option | Why not |
|---|---|
| Strip `refreshToken` and `accessToken` | The next token-like key leaks by default |
| Encrypt the tokens at rest and export the ciphertext | Still a stored secret in a file; does not answer A1's "no secret" |
| Build the object in memory | Tens of MB for the AC-7 history; Worker memory is 128 MB |
| Export as a background job with a mailed link | A storage bucket, signed URLs and a mail for a download that fits in a stream |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
