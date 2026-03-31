# Rich Editor for Posts & Widget

**Date:** 2026-03-31  
**Status:** Approved

## Summary

Bring TipTap rich editor parity to admin feedback posts (full feature set matching changelogs) and introduce a new lightweight TipTap editor to the widget's feedback submission and comment forms. Three project-level settings flags control opt-out per surface.

## Feature Matrix

| Feature                                                               | Admin posts | Widget submissions | Widget comments |
| --------------------------------------------------------------------- | ----------- | ------------------ | --------------- |
| Images                                                                | ✓           | ✓ (auth only)      | ✓ (auth only)   |
| Tables                                                                | ✓           | —                  | —               |
| Video embeds (YouTube)                                                | ✓           | —                  | —               |
| Basic formatting (bold, italic, code, blockquote, headings, dividers) | ✓           | ✓                  | ✓               |
| Slash menu                                                            | ✓           | —                  | —               |
| Bubble menu                                                           | ✓           | —                  | —               |

## Data Model

Three new boolean columns on the project settings table, all defaulting to `true`:

| Column                 | Controls                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `richMediaInPosts`     | Images, tables, and video embeds in the admin post editor                               |
| `videoEmbedsInPosts`   | YouTube embeds in admin posts (sub-flag; only meaningful when `richMediaInPosts` is on) |
| `imageUploadsInWidget` | Image uploads in widget feedback submissions and comments                               |

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
- When `richMediaInPosts` project setting is `false`, fall back to current limited config (headings, code, blockquotes, task lists, dividers only)
- When `richMediaInPosts` is `true` but `videoEmbedsInPosts` is `false`, pass `embeds: false`

## Widget Rich Text Editor

New component: `apps/web/src/components/widget/widget-rich-text-editor.tsx`

```ts
interface WidgetRichTextEditorProps {
  value: string // HTML string
  onChange: (html: string) => void
  placeholder?: string
  imagesEnabled?: boolean
  onImageUpload?: (file: File) => Promise<string> // returns public URL
  className?: string
}
```

**TipTap extensions included:**

- StarterKit (with built-in code block — no lowlight syntax highlighting)
- Placeholder
- Link
- Underline
- ResizableImage (conditionally loaded when `imagesEnabled && onImageUpload`)

**Omitted vs full editor:** no YouTube, no tables, no task lists, no syntax highlighting, no slash menu, no bubble menu.

**Image toolbar:** a single image-attach button renders only when both `imagesEnabled` and `onImageUpload` are present. The auth gate is enforced at the call site — `onImageUpload` is only passed when `isIdentified` is true.

**Content format:** HTML string, stored in the existing `content` field (same as changelogs and admin posts).

### Integration points

- `widget-home.tsx`: replace `<textarea>` (line ~546) with `WidgetRichTextEditor`; pass `onImageUpload` only when `isIdentified && imageUploadsInWidget`
- `widget-comment-form.tsx`: replace `<textarea>` (line ~75) with `WidgetRichTextEditor`; same auth gate

## Settings UI

New **"Content"** card in the project settings page with three toggles:

1. **Rich media in posts** — `richMediaInPosts`
2. **Video embeds in posts** — `videoEmbedsInPosts` (only rendered when rich media is on)
3. **Image uploads in widget** — `imageUploadsInWidget`

Settings persist via the existing project settings mutation. The widget shell already receives project config as props; add `imageUploadsInWidget` to that prop surface and thread it down to `WidgetHome` and `WidgetCommentForm`.

## Content Storage

No schema changes to posts tables — both already store `content` (HTML text) and `contentJson` (TipTap JSON). The widget editor outputs HTML which maps to the existing `content` field. `contentJson` remains optional and is only populated by the admin post editor.

For **comments**: verify that the comments table `content` column accepts HTML and that the portal/widget comment renderer uses `dangerouslySetInnerHTML` (or equivalent safe HTML renderer) rather than plain text. If comments currently render as plain text, the rendering layer needs updating alongside the editor change — no schema migration required, just a render-mode change.
