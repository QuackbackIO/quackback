# Auto-rehost External Images + MCP Content Metadata Design

**Status:** Approved, pending implementation
**Author:** James Morton
**Date:** 2026-04-13

## Problem

Quackback accepts markdown as the input format for rich content across posts, changelogs, and help center articles. MCP-authored content (and any API caller) that includes images writes external URLs directly into the stored `contentJson`:

```markdown
![Screenshot](https://some-external-host.example.com/screenshot.png)
```

The external host can rot, get rate-limited, or disappear. Workspace-authored content should be self-hosted on the workspace's own S3-compatible storage so it survives independently of whoever originally uploaded the image.

Today there is no MCP `upload_image` tool and no way for an LLM agent to hand Quackback raw bytes. The cleanest fix — mirroring Linear's API behavior — is to auto-rehost any external image the server sees when content is saved.

Additionally, the MCP tool descriptions don't make the content format explicit. LLM agents have to guess whether `content` is markdown, HTML, or something else, and they have no way to learn about the auto-rehost behavior without trial and error.

## Goals

1. Any `contentJson` written by the service layer for posts, changelogs, or help center articles has all external image URLs rewritten to workspace-hosted URLs — whether the content arrived as markdown or as pre-built JSON.
2. Per-image failures never break a save. External URLs are kept in place as a fallback when fetch or upload fails.
3. MCP tool descriptions clearly communicate the content format, supported markdown features, and auto-rehost behavior so LLM agents can author correctly on the first try.

## Non-goals

- Custom TipTap markdown nodes (callouts, button CTAs, etc.). Separate feature.
- Rich content for comments. Comments stay plain text; adding `contentJson` to the comments schema is a separate feature.
- Backfilling existing content that already has external URLs. A one-shot migration script can run later using the same rehost utility.
- A dedicated `upload_image` MCP tool. Auto-rehost covers the LLM-has-a-URL case, which is the common path; the raw-bytes case can be added later with a direct signed-upload tool.
- Widget messages (no `contentJson`).
- The existing `/api/upload/image` endpoint behavior — unchanged. It's already the path used by the web editor for drag-and-drop / paste uploads.

## Architecture

### Single conversion pipeline

All three content types (posts, changelogs, articles) already funnel through a single conversion helper, `markdownToTiptapJson()` at `apps/web/src/lib/server/markdown-tiptap.ts:59`. The service layer calls it in six places: `createPost`, `updatePost`, `createChangelog`, `updateChangelog`, `createArticle`, `updateArticle`. Each of those sites is the hook point for rehost.

### New module

`apps/web/src/lib/server/content/rehost-images.ts` — stateless server-only module.

```ts
export type RehostContentType = 'post' | 'changelog' | 'help-center'

export async function rehostExternalImages(
  json: TiptapContent,
  opts: { contentType: RehostContentType; principalId?: PrincipalId }
): Promise<TiptapContent>
```

Responsibilities:

- Walk the TipTap JSON tree recursively, collect all `{ type: 'image', attrs: { src } }` nodes up to the per-save count cap.
- Dedupe by `src`: same URL appearing N times is fetched once, all nodes share the rewritten URL.
- For each unique candidate, run the per-image pipeline (see Data flow below).
- Return a deep-cloned tree with rewritten `src` values. Input is never mutated — the tree we return is the tree that gets written to the DB.
- Never throw. Top-level try/catch returns the original `contentJson` unchanged on unexpected errors and logs at `error` level.

### New storage helper

`apps/web/src/lib/server/storage/s3.ts` gets one new export:

```ts
export async function uploadImageBuffer(
  buffer: Buffer,
  mimeType: string,
  prefix: 'post-images' | 'changelog-images' | 'help-center'
): Promise<{ url: string }>
```

Internal implementation mirrors the existing `uploadImageFromFormData`: same bucket, same public URL construction, same prefix directory conventions. The only difference is the input is a pre-read buffer instead of a `FormData` field. Uses the same S3 client instance.

### Service layer integration

Each of the six service call sites wraps its existing `markdownToTiptapJson(content)` with `rehostExternalImages(..., { contentType, principalId })`. The wrapper is applied regardless of whether the `contentJson` came from markdown parsing or from `input.contentJson` directly. A caller that passes pre-built JSON with external URLs still gets them rehosted.

Example (`post.service.ts:125` shown, others are structurally identical):

```ts
const parsedContentJson = input.contentJson ?? markdownToTiptapJson(content)
const contentJson = await rehostExternalImages(parsedContentJson, {
  contentType: 'post',
  principalId: authorId,
})
// ... existing insert using contentJson
```

Same pattern on the update path (`post.service.ts:264`) with the post's actual principal/author id.

### Configuration

Three new env vars, all with sensible defaults:

| Env                          | Default            | Purpose                                 |
| ---------------------------- | ------------------ | --------------------------------------- |
| `REHOST_MAX_BYTES`           | `10485760` (10 MB) | Per-image size cap                      |
| `REHOST_MAX_IMAGES_PER_SAVE` | `20`               | Max number of images processed per save |
| `REHOST_FETCH_TIMEOUT_MS`    | `10000`            | Per-image fetch timeout                 |

Same-origin detection reads the existing `S3_PUBLIC_URL_PREFIX` env var already used by `storage/s3.ts`. No new env is added for that.

## Data flow

For a single save, end-to-end:

1. API or MCP request lands in a service (e.g. `createPost(input)`).
2. Service derives `contentJson`: either from `markdownToTiptapJson(input.content)` or `input.contentJson` if provided directly.
3. Service calls `rehostExternalImages(contentJson, { contentType: 'post', principalId })`.
4. Inside `rehostExternalImages`:
   1. Top-level try/catch wraps the whole function.
   2. If `isS3Configured()` is false → return input unchanged, info log once, done.
   3. Deep-clone the input JSON.
   4. Walk the clone, collect up to `REHOST_MAX_IMAGES_PER_SAVE` unique image `src` values into a `Map<string, string | null>` (null = "not yet processed"). Record references to each node that has that src so we can patch them at the end.
   5. For each unique src, run the pipeline:
      - **Same-origin check.** If `src.startsWith(S3_PUBLIC_URL_PREFIX)` → the map entry stays the original src (no rewrite needed). Continue.
      - **Data URI path.** If `src.startsWith('data:image/')`:
        - Parse the mime type and base64 segment.
        - If mime is `svg+xml` → reject (keep original, warn). Continue.
        - If mime not in allow-list → reject (keep original, warn). Continue.
        - Decode base64 to buffer.
        - If buffer length > `REHOST_MAX_BYTES` → reject (keep original, warn). Continue.
        - Upload via `uploadImageBuffer(buffer, mime, prefix)`. Map the new URL.
      - **HTTP(S) fetch path.** Otherwise:
        - Create `AbortController` with `REHOST_FETCH_TIMEOUT_MS` timer.
        - `fetch(src, { signal })`.
        - If response not ok → reject (warn). Continue.
        - Check `content-type` header; if not in allow-list or is SVG → reject (warn). Continue.
        - Check `content-length` header; if declared and > `REHOST_MAX_BYTES` → reject (warn). Continue.
        - Read body as `ArrayBuffer`, convert to `Buffer`. If actual size > `REHOST_MAX_BYTES` → reject (warn). Continue.
        - Upload via `uploadImageBuffer(buffer, mimeType, prefix)`. Map the new URL.
      - **All paths:** any thrown exception is caught, the map entry stays the original src, one warning is logged. The per-image failure never propagates out.
   6. Walk the cloned tree again, patching each collected image node's `src` to the mapped value (which is either the rewritten URL or the original URL on failure).
   7. Return the cloned tree.
5. Service receives the (possibly rewritten) `contentJson`. Writes to the DB as normal.
6. Response returned to caller.

**Note on image count cap:** If a doc has more than 20 images, only the first 20 (in traversal order) are considered for rehost. Images beyond the cap keep their original src untouched and a single warning is logged summarizing how many were skipped. We don't hard-fail on this — the goal is to not let LLM spam runaway cost the server; the doc still saves correctly.

**Note on MIME allow-list:** `image/png`, `image/jpeg`, `image/webp`, `image/gif`. `image/svg+xml` is explicitly rejected on both the data-URI and HTTP paths because SVGs can contain script payloads. `image/avif` is excluded for now pending user need.

## Error handling

Three failure tiers, strictest innermost:

### Per-image failure (expected, silent-ish)

Any fetch error, upload error, timeout, bad mime type, SVG, oversized image, or corrupt data URI. Caught in the per-image loop. The image's `src` keeps its original value in the rewritten tree. A structured warning is logged:

```
[content:rehost-images] skipped image
  contentType=post
  principalId=user_01abc...
  src=https://external.example.com/img.png
  reason=fetch-timeout
```

Log reasons enum: `same-origin-skip` (info, not warn), `svg-rejected`, `mime-rejected`, `oversized`, `fetch-timeout`, `fetch-error`, `upload-error`, `data-uri-decode-error`, `count-cap-exceeded`.

### S3 not configured (dev path)

`isS3Configured()` returns false. `rehostExternalImages` logs one info line and returns the input unchanged. This matches current dev behavior where `/api/upload/image` also 503s on unconfigured S3 — authors in dev keep their external URLs intact.

### Unexpected error (safety net)

A traversal bug, a null mime, a thrown exception inside the top-level try/catch. Return the original `contentJson` unchanged, log at `error` level with the exception. Saves must never fail because of rehost logic.

**What does NOT propagate to callers:** Under no circumstances does a rehost failure cause `createPost`, `createArticle`, `createChangelog`, or any update to throw an error visible to the MCP/API caller. Rehost is strictly best-effort.

## MCP tool metadata update

The metadata update is a separate commit from the rehost logic, but lives in the same feature branch.

**File:** `apps/web/src/lib/server/mcp/tools.ts`

**Rich-content tools get a "Content format" block appended to their tool-level description.** The block is a shared multi-line string constant (to stay DRY across tools). It covers:

- Content is GitHub-flavored Markdown (`### format: markdown (GFM)`)
- Supported features: headings (h1–h3), bold/italic/strikethrough, links, ordered and bulleted lists, task lists (`- [ ]`), inline code and fenced code blocks with language hint, blockquotes, tables, horizontal rules, images
- Image embedding: `![alt](https://...)`, external URLs are auto-rehosted to workspace storage on save
- Image constraints: PNG/JPEG/WebP/GIF only (no SVG), max 10 MB per image, max 20 images per save; images exceeding limits keep their original URL as a fallback
- One-line example markdown payload

**Applied to tools:**

- `create_post`
- `create_changelog`, `update_changelog`
- `create_article`, `update_article`

**Field-level `.describe()` strings on `content`** get updated in parallel with a one-line hint: `"Markdown (GFM). Images: ![alt](url), auto-rehosted to workspace storage on save. See tool description for full format details."`

**Comment tools** — `add_comment` and `update_comment` — get updated `.describe()` strings and a short tool-description note clarifying that comments are **plain text** (not markdown), max 5000 chars, and rich content is not supported today. No mention of rehost behavior — irrelevant for plain text.

**Tools not touched:** `search`, `get_details`, `triage_post`, `vote_post`, `proxy_vote`, `react_to_comment`, `manage_roadmap_post`, `merge_post`, `unmerge_post`, `delete_*`, `restore_*`, `list_suggestions`, `accept_suggestion`, `dismiss_suggestion`, `restore_suggestion`, `get_post_activity`, `manage_category`. None of them take free-form content.

## Testing

### Unit tests

**New:** `apps/web/src/lib/server/content/__tests__/rehost-images.test.ts`

Mocks global `fetch` and `uploadImageBuffer`. Cases:

1. Single external URL → fetched, uploaded, src rewritten
2. Multiple distinct external URLs → each fetched, each rewritten
3. Same URL twice → fetched once, both nodes rewritten identically (dedupe)
4. Same-origin URL → skipped, src unchanged, no fetch
5. Data URI with PNG → decoded, uploaded, src rewritten
6. Data URI with SVG → kept as-is, warning logged
7. External SVG via http → kept as-is, warning logged
8. Disallowed mime type (`application/pdf`) → kept, warning
9. Oversized image (`content-length` over cap) → kept, warning, no body read
10. Fetch timeout → kept, warning
11. S3 upload throws → kept, warning
12. 21 images in one doc → first 20 rehosted, 21st kept, one summary warning
13. Non-image nodes (paragraph, code block, table) → untouched
14. `isS3Configured()` returns false → input returned unchanged, no fetch calls
15. Top-level try/catch: a traversal bug throws → input returned unchanged, error logged

### Service-level tests

Existing files get new cases:

- `apps/web/src/lib/server/domains/posts/__tests__/post.service.test.ts` — mock `rehostExternalImages`, assert it's called on create + update, assert the mocked return value is what ends up in the DB insert
- `apps/web/src/lib/server/domains/changelog/__tests__/changelog-service.test.ts` — same pattern
- `apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts` — same pattern

One service test per file is enough to lock in the wiring; the behavior is covered by the unit tests.

### MCP metadata tests

The existing `apps/web/src/lib/server/mcp/__tests__/handler.test.ts` doesn't assert description strings — it only checks tool registration and auth. All existing cases should stay green. Add one new case: for each updated tool, confirm the `content` field description string contains the substring `"Markdown"` or `"Plain text"` as appropriate. Cheap smoke test to catch future regressions.

## Operational considerations

**Latency:** Sync rehost adds ~0 ms for a zero-image save (hot path) and roughly `fetch_time + s3_upload_time` per image. A typical 500 KB image over a warm link is well under 1 s total. The 20-image cap bounds the worst case at around 20 s — acceptable for a write path that was already the slowest thing in the request, but worth watching in logs.

**Cost:** S3 storage cost scales with the number of rehosted images; a runaway MCP agent that spams an article with 20 real 10 MB images costs ~200 MB per save. The per-save cap is the primary defense. We do not impose a per-workspace rate limit in this change — if abuse becomes real, it's a separate feature.

**Security:** The fetch path is an SSRF vector if unguarded. Two mitigations:

1. The fetch URL must start with `http://` or `https://` — no `file://`, `ftp://`, or other schemes.
2. Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.169.254 AWS metadata) are blocked via a resolved-host check before fetch. This is implemented as a helper `isPrivateHost(urlHost)` that rejects any hostname resolving to a private or link-local address.

Log the SSRF rejections at warn level with the same "skipped image" format, reason `ssrf-rejected`.

**Observability:** All warnings use the `[content:rehost-images]` log prefix so they can be grepped and eventually piped to a dashboard if rehost becomes a hot metric.

## Migration

No DB migration. No schema changes. No new dependencies beyond what's already in the codebase (`@aws-sdk/client-s3` is already used by `storage/s3.ts`).

Existing content with external URLs in `contentJson` is not touched by this change. A follow-up one-shot backfill script (not part of this plan) can call `rehostExternalImages` on every existing record to migrate historical content.

## Open questions

None. All design decisions are locked:

- Sync processing, not async
- Fail-soft per image (keep external URL)
- MIME allow-list: PNG, JPEG, WebP, GIF
- SVG explicitly rejected
- Data URIs accepted
- Per-image cap 10 MB
- Per-save cap 20 images
- Same-origin detection via `S3_PUBLIC_URL_PREFIX`
- Scope: posts, changelogs, help center articles (comments out of scope)
- MCP metadata: approach B (field descriptions + tool-level "Content format" block)
- SSRF protection via scheme and private-IP checks

## Rollout

One feature branch off `main`: `feat/auto-rehost-external-images`. Single PR. No feature flag — this is a write-path enhancement that only affects new content, fails soft, and has no user-facing UI changes to gate.

The PR contains all of:

1. New `rehost-images.ts` module
2. New `uploadImageBuffer` helper on `storage/s3.ts`
3. Six service call sites updated
4. Unit tests for `rehost-images.ts`
5. Service integration test wiring
6. MCP metadata updates
7. No schema migrations
