# Rich Editor for Posts & Widget

**Date:** 2026-03-31
**Status:** Approved

## Summary

Bring full TipTap rich editor parity to both admin feedback posts and the widget's feedback submission form, matching the existing changelog editor. Widget comments remain plain text. The existing `RichTextEditor` component is reused directly — no new editor component needed. Three project-level settings flags control opt-out per surface.

## Feature Matrix

| Feature                                                               | Admin posts | Widget submissions | Widget comments |
| --------------------------------------------------------------------- | ----------- | ------------------ | --------------- |
| Images                                                                | ✓           | ✓ (auth only)      | —               |
| Tables                                                                | ✓           | ✓                  | —               |
| Video embeds (YouTube)                                                | ✓           | ✓                  | —               |
| Basic formatting (bold, italic, code, blockquote, headings, dividers) | ✓           | ✓                  | ✓ (plain text)  |
| Slash menu                                                            | ✓           | ✓                  | —               |
| Bubble menu                                                           | ✓           | ✓                  | —               |

## Data Model

Three new boolean columns on the project settings table, all defaulting to `true`:

| Column                 | Controls                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `richMediaInPosts`     | Images, tables, and video embeds in the admin post editor                               |
| `videoEmbedsInPosts`   | YouTube embeds in admin posts (sub-flag; only meaningful when `richMediaInPosts` is on) |
| `imageUploadsInWidget` | Image uploads in widget feedback submissions (authenticated users only)                 |

Migration: add columns with `DEFAULT true NOT NULL`.

## Upload Infrastructure

Two new server functions in `apps/web/src/lib/server/functions/uploads.ts`:

- **`getPostImageUploadUrlFn`** — requires admin role, prefix `'post'`. Mirrors `getChangelogImageUploadUrlFn` exactly.
- **`getWidgetImageUploadUrlFn`** — requires active widget Bearer token session (same auth pattern as other widget server functions), prefix `'widget'`. Anonymous users are blocked server-side.

Both reuse the existing presigned S3 URL flow. No new storage infrastructure.

## Admin Post Editor

File: `apps/web/src/components/admin/feedback/post-form-fields.tsx`

- Enable `images: true`, `tables: true`, `embeds: true` on `RichTextEditor`
- Wire in `useImageUpload({ prefix: 'post' })` calling `getPostImageUploadUrlFn`
- When `richMediaInPosts` is `false`, fall back to current limited config (headings, code, blockquotes, task lists, dividers only)
- When `richMediaInPosts` is `true` but `videoEmbedsInPosts` is `false`, pass `embeds: false`

## Widget Submission Form

File: `apps/web/src/components/widget/widget-home.tsx`

Replace the `<textarea>` (line ~546) with the existing `RichTextEditor` component — full feature parity with changelogs. Pass `useImageUpload({ prefix: 'widget', uploadFn: getWidgetImageUploadUrlFn })` only when `isIdentified && imageUploadsInWidget`. Anonymous users see the full editor minus the image toolbar.

No new editor component needed.

## Widget Comments

No changes. `widget-comment-form.tsx` stays as a plain textarea.

## Settings UI

New **"Content"** card in the project settings page with three toggles:

1. **Rich media in posts** — `richMediaInPosts`
2. **Video embeds in posts** — `videoEmbedsInPosts` (only rendered when rich media is on)
3. **Image uploads in widget** — `imageUploadsInWidget`

Settings persist via the existing project settings mutation. The widget shell receives project config as props; add `imageUploadsInWidget` to that prop surface and thread it down to `WidgetHome`.

## Content Storage

No schema changes needed. Posts already store `content` (HTML) and `contentJson` (TipTap JSON). The widget submission form outputs HTML to the existing `content` field on posts; `contentJson` is also populated since `RichTextEditor` handles both. Widget comments remain plain text strings — no change.
