---
date: 2026-02-01
topic: changelog-ui
---

# Changelog Creation & Display UI

## What We're Building

A complete changelog feature that allows admins to create beautiful, rich-text changelog entries announcing shipped features and product updates. The system will:

1. **Admin UI**: Dialog-based changelog creation following the existing post creation pattern
2. **Rich Text Editor**: Enhanced Tiptap editor with headers, images, code blocks (shared across app)
3. **Image Upload**: S3-compatible storage with paste/drop support
4. **Publishing Workflow**: Draft, schedule, and publish states
5. **Post Linking**: Multi-select shipped posts to link in changelog entries
6. **Public View**: Dedicated `/changelog` portal page for users

## Why This Approach

We chose **Approach A: Extend Existing Patterns** over alternatives:

- **vs Full-Page Editor**: Dialog-based creation is consistent with post creation UX. Admins already know this pattern. Lower implementation risk.
- **vs Hybrid**: Added complexity of managing two view modes isn't justified for v1. Can always add "expand" later if needed.

Key principle: **Consistency over novelty**. The existing post creation flow works well - changelogs should feel like a natural extension, not a new paradigm to learn.

## Key Decisions

### 1. Schema Changes

- **Add `contentJson`** field to `changelog_entries` for Tiptap JSON (like posts have)
- **Add junction table** `changelog_entry_posts` for many-to-many post linking
- Keep existing `publishedAt` for draft/schedule/publish logic

### 2. Rich Text Editor Enhancement

- **Shared `RichTextEditor`** gets new capabilities (benefits posts, comments too)
- **New extensions**: Image (with paste/upload), Heading (H1-H3), CodeBlock
- **Config prop** to enable/disable features per-use (e.g., comments might skip images)

### 3. Image Handling

- **S3-compatible storage** (works with S3, R2, Backblaze B2)
- **Server function** for signed upload URLs
- **Paste/drop support** in editor - auto-uploads and inserts
- **Environment config**: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (for non-AWS)

### 4. Admin UI Components

- `CreateChangelogDialog` - modal for creating/editing entries
- `ChangelogFormFields` - title, content editor, linked posts, publish controls
- `LinkedPostsSelector` - searchable multi-select for shipped posts
- `PublishControls` - draft/schedule/publish toggle with date picker
- Admin list view at `/admin/changelog`

### 5. Publishing States

- **Draft**: `publishedAt` is null
- **Scheduled**: `publishedAt` is future date
- **Published**: `publishedAt` is past/now
- Background job or check-on-request for scheduled → published transition

### 6. Public Changelog Page

- Route: `/changelog` in portal group
- List view with pagination
- Entry detail view showing linked posts with "shipped" badge
- RSS feed support (nice-to-have for v1)

## Open Questions

1. **Scheduling mechanism**: Should scheduled posts auto-publish via cron job, or check-on-request? (Cron is more accurate, check-on-request is simpler for self-hosted)

2. **Image size limits**: What's the max upload size? 5MB? 10MB? Should we resize/compress?

3. **Version labels**: Should changelogs have optional version numbers (v1.2.0) or just dates?

4. **Email notifications**: Notify subscribers when changelog is published? (Could defer to v2)

## Next Steps

→ `/workflows:plan` for implementation details covering:

- Database migrations
- S3 upload infrastructure
- Tiptap editor enhancements
- Admin UI components
- Public changelog page
- Testing strategy
