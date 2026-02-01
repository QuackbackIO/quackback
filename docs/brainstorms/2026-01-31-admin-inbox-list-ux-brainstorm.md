---
title: 'Admin Inbox List UX Simplification'
date: 2026-01-31
status: draft
tags: [ux, admin, inbox, consistency]
---

# Admin Inbox List UX Simplification

## Context

During the post modal implementation, we noticed the admin inbox list (`FeedbackRow`) feels visually cluttered compared to the public portal's `PostCard` component. Since admins often switch between both views, consistency would improve the overall experience.

## Current State Analysis

### Portal PostCard (Clean)

- **Layout**: Vote button (left) → Content area (right)
- **Hierarchy**: Status badge → Title → Description → Tags → Meta footer
- **Meta footer**: Avatar + name · time · comment count · board badge
- **Features**: Density toggle (comfortable/compact), subtle hover states, rounded card container
- **Visual**: Clean separation, breathing room, minimal separators

### Admin FeedbackRow (Cluttered)

- **Layout**: Vote column (bordered) → Content area → Quick actions overlay
- **Hierarchy**: Title → Description preview → Dense meta row
- **Meta row**: Status dot + name · Board folder icon · Author · Time · Comments · Tags (all inline with many `·` separators)
- **Features**: Hover-triggered quick actions, focus state with left border
- **Visual**: Dense, many elements competing for attention, folder icon adds noise

## Problem Statement

1. **Visual noise**: Too many separators (`·`), icons (folder), and inline elements
2. **Inconsistent with portal**: Different layouts create cognitive load when switching contexts
3. **Status visibility**: Small dot in meta row vs prominent badge in portal
4. **Tags buried**: Inline with meta data instead of their own row
5. **No density control**: Admins can't choose between compact/comfortable views

## Design Principles

1. **Consistency over novelty**: Match portal patterns where sensible
2. **Progressive disclosure**: Essential info first, details on demand
3. **Admin efficiency**: Preserve quick actions and keyboard navigation
4. **Breathing room**: Reduce visual density without losing information

## Options Explored

### Option A: Full Portal Alignment

Adopt the portal's `PostCard` component for admin inbox.

**Pros:**

- Maximum consistency
- Already built and tested
- Density toggle included

**Cons:**

- May need admin-specific additions (quick actions, focus state)
- Some portal features (auth popover) not relevant
- Different click behavior (modal vs full page)

### Option B: Hybrid Approach

Restructure `FeedbackRow` to match portal visual hierarchy while keeping admin-specific features.

**Pros:**

- Keeps admin-specific quick actions intact
- Can iterate on existing component
- Easier to diff changes

**Cons:**

- Two similar components to maintain
- May diverge over time

### Option C: Shared Base Component

Extract a shared `PostListItem` base that both portal and admin extend.

**Pros:**

- DRY - single source of truth for layout/styling
- Variants handle context-specific needs
- Changes propagate to both

**Cons:**

- More abstraction complexity
- Props explosion for all variants
- May over-engineer simple UI

## Proposed Solution

**Option B (Hybrid)** with a path toward Option C if patterns stabilize.

### Changes to FeedbackRow

1. **Status badge above title** (like portal)
   - Replace inline status dot with `StatusBadge` component
   - Adds visual hierarchy

2. **Simplify meta row**
   - Remove folder icon, use text "in {board}" or badge
   - Reduce separators (single `·` between groups)
   - Move tags to own row above meta (like portal)

3. **Add density toggle**
   - Comfortable: Show description, tags, full meta
   - Compact: Title + inline status, minimal meta

4. **Preserve admin features**
   - Quick actions on hover (keep)
   - Focus state with left border (keep)
   - Keyboard navigation (keep)

### Visual Comparison

**Before (dense meta):**

```
[Vote] | Title
       | Preview text...
       | 🔵 Open · 📁 Feature Requests · John · 2h ago · 💬 3 · [Tag1] [Tag2]
```

**After (hierarchical):**

```
[Vote] | [Status Badge]
       | Title
       | Preview text...
       | [Tag1] [Tag2]
       | John · 2h ago · 3 comments · in Feature Requests
```

## Open Questions

1. Should we add the portal's vote button styling (filled when voted)?
2. Is board name essential in list view, or just in filters?
3. Should tags be clickable to filter in admin inbox?
4. How do quick actions interact with the new layout?

## Next Steps

1. Create a plan from this brainstorm
2. Implement density toggle first (quick win)
3. Restructure layout incrementally
4. A/B test with existing users if possible

## References

- Portal PostCard: `apps/web/src/components/public/post-card.tsx`
- Admin FeedbackRow: `apps/web/src/components/admin/feedback/table/feedback-row.tsx`
- FeedbackTableView: `apps/web/src/components/admin/feedback/table/feedback-table-view.tsx`
