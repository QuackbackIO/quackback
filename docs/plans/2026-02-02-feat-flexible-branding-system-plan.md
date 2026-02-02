---
title: 'feat: Flexible Branding System'
type: feat
date: 2026-02-02
---

# feat: Flexible Branding System

## Overview

Enhance the branding settings page with 5 key color pickers, a collapsible Custom CSS section for power users, and theme mode control (force light/dark or allow user toggling). Uses a single-page layout with collapsible sections instead of tabs.

## Problem Statement / Motivation

Currently, the branding page only exposes a single "brand color" picker, font selector, and corner roundness slider. Users who want to customize beyond the primary color must either:

- Pick from 14 presets without further customization
- Manually edit the codebase

External theme builders like tweakcn.com generate full CSS variable sets compatible with shadcn/Tailwind, but users have no way to import this CSS into Quackback.

## Proposed Solution

### Architecture: Layered Theme Application

The system uses a **layered approach**:

1. **Base layer**: `brandingConfig` JSON provides the foundation (5 key colors + font + radius + themeMode)
2. **Override layer**: `customCss` raw CSS injects AFTER the base theme, allowing targeted overrides

Portal CSS injection order:

```
1. globals.css (framework defaults)
2. Generated CSS from brandingConfig (expandTheme + generateThemeCSS)
3. Raw customCss (user's custom overrides)
```

### UI Structure: Single Page with Collapsible Advanced Section

```
┌─────────────────────────────────────────────────────────────────┐
│  ☰ Settings > Branding                                          │
├──────────────────────────────┬──────────────────────────────────┤
│  [Controls Panel]            │  [Live Preview Panel]            │
│                              │                                  │
│  Logo uploader               │  ┌────────────────────────────┐  │
│  Workspace name              │  │  ☀️ Light │ 🌙 Dark         │  │
│                              │  ├────────────────────────────┤  │
│  ── Theme Mode ──            │  │                            │  │
│  [User choice ▾]             │  │   Preview Component        │  │
│                              │  │                            │  │
│  ── Colors ──                │  │                            │  │
│  Primary:     [■] #3b82f6    │  │                            │  │
│  Secondary:   [■] #6366f1    │  └────────────────────────────┘  │
│  Accent:      [■] #ec4899    │                                  │
│  Background:  [■] #ffffff    │                                  │
│  Foreground:  [■] #0f172a    │                                  │
│                              │                                  │
│  ── Typography ──            │                                  │
│  Font: [Inter ▾]             │                                  │
│  Corners: ───●─── 0.5rem     │                                  │
│                              │                                  │
│  ▶ Advanced: Custom CSS      │                                  │
│  ┌────────────────────────┐  │                                  │
│  │ (collapsed by default) │  │                                  │
│  │ Instructions + textarea│  │                                  │
│  └────────────────────────┘  │                                  │
│                              │                                  │
│  [Save Changes]              │                                  │
└──────────────────────────────┴──────────────────────────────────┘
```

**When Advanced section is expanded:**

```
│  ▼ Advanced: Custom CSS      │
│  ┌────────────────────────┐  │
│  │ Design your theme at   │  │
│  │ tweakcn.com then paste │  │
│  │ the CSS below.         │  │
│  │                        │  │
│  │ :root {                │  │
│  │   --primary: oklch(...)│  │
│  │ }                      │  │
│  │ .dark {                │  │
│  │   --primary: oklch(...)│  │
│  │ }                      │  │
│  └────────────────────────┘  │
```

## Technical Considerations

### Database: No Migration Needed

Store `themeMode` inside the existing `brandingConfig` JSON field (per Kieran's review - matches existing pattern):

```typescript
// apps/web/src/lib/server/domains/settings/settings.types.ts
export interface BrandingConfig {
  preset?: string
  themeMode?: 'light' | 'dark' | 'user' // NEW - stored in JSON, not separate column
  light?: ThemeColors
  dark?: ThemeColors
}
```

Existing fields:

- `brandingConfig` (JSON text) - stores themeMode, colors, font, radius
- `customCss` (text) - stores raw CSS overrides (already exists, currently unused)

### Type Updates

Update `MinimalThemeVariables` in `expand.ts` (single source of truth) to include explicit secondary/accent with backwards compatibility:

```typescript
// apps/web/src/lib/shared/theme/expand.ts
export interface MinimalThemeVariables {
  primary: string
  background: string
  foreground: string
  muted: string
  border: string
  // Add explicit optional fields
  secondary?: string  // Falls back to muted if not provided
  accent?: string     // Falls back to muted if not provided
  fontSans?: string
  radius?: string
}

// In expandTheme():
secondary: minimal.secondary ?? minimal.muted,  // Backwards compatible
accent: minimal.accent ?? minimal.muted,        // Backwards compatible
```

### Theme Mode Enforcement

Portal layout (`_portal.tsx`) changes:

```typescript
// When themeMode is 'light' or 'dark', force that mode
const themeMode = brandingConfig?.themeMode ?? 'user'
const forcedThemeClass = themeMode === 'user' ? undefined : themeMode

// In the HTML:
<html className={forcedThemeClass ?? ''}>
  {/* Remove theme toggle when mode is forced */}
  {themeMode === 'user' && <ThemeToggle />}
</html>
```

### CSS Handling: No Parsing

Per reviewer feedback, skip CSS validation entirely:

- Store raw CSS in `customCss` field
- Inject directly into portal `<style>` tag
- Browser handles invalid CSS gracefully (ignores it)
- Preview applies CSS directly to preview container

### State Management

Keep the existing `use-branding-state.ts` hook simple:

- Add state for 4 new colors (secondary, accent, background, foreground)
- Add `customCss` state
- Add `themeMode` state
- Single save button persists everything
- No complex tab-switching logic needed (single page)

## Acceptance Criteria

### Color Controls

- [x] 5 color pickers: Primary, Secondary, Accent, Background, Foreground
- [x] Live preview updates as colors change
- [x] Auto-derives remaining ~45 CSS variables from 5 key colors
- [x] Backwards compatible with existing themes (missing secondary/accent default to muted)

### Custom CSS Section

- [x] Collapsible section (collapsed by default)
- [x] Instructions with link to tweakcn.com
- [x] Monospace textarea for CSS input
- [x] Live preview updates on input (debounced)

### Theme Mode Control

- [x] Dropdown: Light only / Dark only / User choice
- [x] Portal enforces light mode when `themeMode = 'light'`
- [x] Portal enforces dark mode when `themeMode = 'dark'`
- [x] Portal shows theme toggle only when `themeMode = 'user'`

### Layered Application

- [x] brandingConfig CSS applies first
- [x] customCss applies second (can override)
- [x] Both coexist without conflict

## Success Metrics

- Admins can apply a theme from tweakcn.com in < 2 minutes
- Non-technical users can customize 5 colors without confusion
- No support tickets about "theme toggle doesn't work" (clear admin control)

## Implementation Phases

### Phase 1: Types & Theme Logic

1. Add `themeMode` to `BrandingConfig` type (stored in existing JSON field)
2. Add `secondary` and `accent` to `MinimalThemeVariables` with backwards-compatible defaults
3. Update `expandTheme()` to use explicit secondary/accent when provided
4. Update `generateThemeCSS()` to respect themeMode (omit `.dark` when light-only, etc.)

**Files:**

- `apps/web/src/lib/server/domains/settings/settings.types.ts`
- `apps/web/src/lib/shared/theme/expand.ts`
- `apps/web/src/lib/shared/theme/generator.ts`

### Phase 2: State & Server Functions

1. Update `use-branding-state.ts` to manage 5 colors + customCss + themeMode
2. Add server function for saving customCss (or update existing `updateThemeFn`)

**Files:**

- `apps/web/src/components/admin/settings/branding/use-branding-state.ts`
- `apps/web/src/lib/server/functions/settings.ts`

### Phase 3: UI Implementation

1. Add 4 new color pickers to branding page (Secondary, Accent, Background, Foreground)
2. Add theme mode dropdown
3. Add collapsible "Advanced: Custom CSS" section with textarea
4. Wire up preview to include customCss

**Files:**

- `apps/web/src/routes/admin/settings.branding.tsx`

### Phase 4: Portal Integration

1. Update portal loader to include customCss in response
2. Inject customCss after generated theme CSS
3. Enforce themeMode (force class on html element)
4. Conditionally show/hide theme toggle based on themeMode

**Files:**

- `apps/web/src/routes/_portal.tsx`
- `apps/web/src/components/public/theme-toggle.tsx` (if exists, or add toggle visibility logic)

### Phase 5: Testing

1. E2E tests for:
   - Customizing 5 colors and saving
   - Pasting custom CSS
   - Forcing light/dark mode on portal
   - Backwards compatibility (old themes without secondary/accent)

## Deferred (Future)

- CSS export button (copy current theme as CSS)
- CSS syntax validation/warnings
- Preset selector dropdown (presets still work via existing mechanism)

## References

### Internal References

- Current branding page: `apps/web/src/routes/admin/settings.branding.tsx`
- Theme expansion: `apps/web/src/lib/shared/theme/expand.ts:100-129`
- CSS generation: `apps/web/src/lib/shared/theme/generator.ts`
- Settings schema: `packages/db/src/schema/auth.ts:194-199`
- Portal layout: `apps/web/src/routes/_portal.tsx:25-31`
- Branding state hook: `apps/web/src/components/admin/settings/branding/use-branding-state.ts`

### External References

- tweakcn.com - External theme builder for shadcn
- OKLCH color space: https://oklch.com/

### Related Work

- Brainstorm: `docs/brainstorms/2026-02-02-flexible-branding-brainstorm.md`

---

## Review Feedback Addressed

| Feedback                                | Resolution                                                             |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Store themeMode in JSON, not new column | ✅ Using existing `brandingConfig` JSON                                |
| MinimalThemeVariables type conflict     | ✅ Single definition in `expand.ts` with backwards-compatible defaults |
| Skip CSS parsing/validation             | ✅ Removed - browser handles invalid CSS                               |
| No tabs, use collapsible section        | ✅ Single page with collapsible Advanced section                       |
| Defer export button                     | ✅ Moved to "Deferred" section                                         |
| Keep 5 color pickers                    | ✅ Retained per user preference                                        |
