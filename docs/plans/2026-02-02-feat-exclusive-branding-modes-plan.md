---
title: 'feat: Mutually Exclusive Simple vs Advanced Branding Modes'
type: feat
date: 2026-02-02
deepened: 2026-02-02
---

# Mutually Exclusive Simple vs Advanced Branding Modes

## Enhancement Summary

**Deepened on:** 2026-02-02
**Research agents used:** kieran-typescript-reviewer, code-simplicity-reviewer, architecture-strategist, julik-frontend-races-reviewer, pattern-recognition-specialist, performance-oracle, best-practices-researcher, framework-docs-researcher, Context7

### Key Improvements from Research

1. **Simplified preview approach** - Show placeholder in Advanced mode instead of complex CSS injection
2. **Type-safe discriminated unions** - Use const assertions for runtime values + types
3. **Race condition fixes** - Timer cleanup on unmount, double-click save guards
4. **Performance optimizations** - Debounce CSS textarea, add size limit (50KB)
5. **UX patterns** - Segmented control (not tabs), confirmation on mode switch

### New Considerations Discovered

- Timer cleanup needed for existing debounce patterns in branding page
- `Promise.all` should use `Promise.allSettled` for granular error reporting
- Font loading causes FOUT - consider `document.fonts.load()` tracking
- Object URL memory leak in logo uploader needs cleanup

---

## Overview

Currently, the branding system applies both generated theme CSS (from color pickers) AND custom CSS together, causing specificity conflicts. Users who paste themes from tweakcn.com find their CSS overridden by the generated theme CSS because `html:root` has higher specificity than `:root`.

This change makes the two approaches **mutually exclusive**: either use Simple mode (color pickers generate CSS) OR Advanced mode (raw CSS only). Both settings are preserved, but only the active mode's CSS is applied to the portal.

## Problem Statement

1. **CSS Specificity Conflict**: Generated theme CSS uses `html:root` and `html.dark` selectors. Pasted themes from tweakcn use `:root` and `.dark`. The generated CSS always wins due to higher specificity.

2. **Confusing Mental Model**: Users expect either "pick colors" OR "paste CSS", not a combination that requires understanding CSS cascade rules.

3. **Debugging Difficulty**: When both are applied, users can't easily tell which styles are coming from where.

## Proposed Solution

Add a `brandingMode: 'simple' | 'advanced'` field to the branding config. The portal loader checks this mode and applies only the appropriate CSS:

- **Simple mode**: Generate and apply theme CSS from `brandingConfig`, ignore `customCss`
- **Advanced mode**: Apply `customCss` only, don't generate theme CSS from `brandingConfig`

Both values remain in the database so users can switch modes without losing their work.

## Technical Approach

### Data Model

Store `brandingMode` inside the existing `brandingConfig` JSON field (same pattern as `themeMode`):

```typescript
// settings.types.ts

// Use const assertion for runtime values + type (recommended pattern)
export const BRANDING_MODES = ['simple', 'advanced'] as const
export type BrandingMode = (typeof BRANDING_MODES)[number]

// Type guard for runtime validation
export function isBrandingMode(value: unknown): value is BrandingMode {
  return typeof value === 'string' && BRANDING_MODES.includes(value as BrandingMode)
}

export interface BrandingConfig {
  brandingMode?: BrandingMode // NEW - defaults to 'simple'
  preset?: string
  themeMode?: ThemeMode
  light?: ThemeColors
  dark?: ThemeColors
}
```

**No database migration needed** - `brandingConfig` is already a JSON text field.

### Research Insights: Type Safety

**Best Practices:**

- Use const assertion to get both runtime array AND type from single source
- Handle defaults in Zod schema, not with `??` throughout codebase
- Add type guard for runtime validation when parsing JSON

**Implementation Details:**

```typescript
// branding.schema.ts - handle defaults at schema level
import { z } from 'zod'
import { BRANDING_MODES } from './settings.types'

export const brandingConfigSchema = z.object({
  brandingMode: z.enum(BRANDING_MODES).default('simple'),
  preset: z.string().optional(),
  themeMode: themeModeSchema.optional(),
  light: themeColorsSchema.optional(),
  dark: themeColorsSchema.optional(),
})
```

### Portal CSS Application

Update `_portal.tsx` loader to conditionally apply CSS:

```typescript
// _portal.tsx loader
const brandingMode = brandingConfig.brandingMode ?? 'simple'

// Only one or the other, never both
const themeStyles = brandingMode === 'simple' ? generateThemeCSS(brandingConfig) : ''
const customCssToApply = brandingMode === 'advanced' ? customCss : ''

// Font loading only in simple mode (advanced mode handles its own fonts)
const googleFontsUrl = brandingMode === 'simple' ? getGoogleFontsUrl(brandingConfig) : null
```

### Research Insights: Architecture Decision

**Why check mode in `_portal.tsx` (not in generator):**

- Single responsibility: Portal loader decides WHAT to render
- CSS generator stays pure: Given config, produce CSS
- Easier to test each piece in isolation
- More explicit control flow

**Alternative considered (rejected):**

```typescript
// DON'T DO THIS - violates single responsibility
export function generateThemeCSS(config: ThemeConfig): string {
  if (!config || config.brandingMode === 'advanced') return ''
  // ...
}
```

**Performance consideration:** Add `preconnect` hints for Google Fonts:

```typescript
<>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
  {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
</>
```

### Admin UI Changes

Use a **segmented control** (not tabs) for mode switching. Segmented controls filter/change presentation within the same view, while tabs navigate between unrelated content sections.

```
┌─────────────────────────────────────────────────────┐
│  Branding Settings                                  │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐                 │
│  │   Simple     │ │   Advanced   │  ← Segmented    │
│  │   (active)   │ │              │    control      │
│  └──────────────┘ └──────────────┘                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Simple mode content OR Advanced mode content]     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Simple Mode Tab:**

- Logo uploader
- Workspace display name
- Theme mode dropdown (light/dark/user)
- Preset selector
- 5 color pickers (primary, secondary, accent, background, foreground)
- Font selector
- Border radius slider

**Advanced Mode Tab:**

- Instructions banner with link to tweakcn.com
- Theme mode dropdown (light/dark/user) - shared setting
- Full-height CSS textarea
- Placeholder text in preview: "Preview not available for custom CSS. Save and view your portal."

### Research Insights: UI Patterns

**Segmented Control Accessibility:**

```jsx
// Correct ARIA pattern - NOT radiogroup or tablist
<SegmentedControl.Root defaultValue="simple" aria-label="Theme mode">
  <SegmentedControl.Item value="simple">Simple</SegmentedControl.Item>
  <SegmentedControl.Item value="advanced">Advanced</SegmentedControl.Item>
</SegmentedControl.Root>
```

**Keyboard Navigation:**
| Key | Action |
|-----|--------|
| Tab | Move focus into/out of control |
| Arrow keys | Move between options |
| Spacebar | Select focused option |

**Mode Switch Confirmation (when switching TO Simple from Advanced with CSS):**

```
Title: Switch to Simple Mode?

Body: Your custom CSS will no longer be applied.
Your portal will use auto-generated styles from color pickers.
(Your CSS is saved and will still be here if you switch back.)

[Cancel]  [Switch to Simple]
```

### State Management

Update `use-branding-state.ts`:

```typescript
export interface BrandingState {
  // NEW
  brandingMode: BrandingMode
  setBrandingMode: (mode: BrandingMode) => void

  // Existing fields preserved...
  themeMode: ThemeMode
  primaryColor: string
  // ...etc
  customCss: string
}
```

**Key behavior**: When switching modes, all state is preserved in memory. Both `brandingConfig` and `customCss` are always saved to the database - the mode just determines which one the portal applies.

### Research Insights: Race Conditions to Fix

**Issue 1: Timer cleanup on unmount**
The existing workspace name debounce timer can fire after unmount:

```typescript
// Add cleanup effect
useEffect(() => {
  return () => {
    if (nameTimeoutRef.current) clearTimeout(nameTimeoutRef.current)
  }
}, [])
```

**Issue 2: Double-click save protection**

```typescript
const isSavingRef = useRef(false)

const saveTheme = useCallback(async () => {
  if (isSavingRef.current) return
  isSavingRef.current = true
  setIsSaving(true)
  try {
    // ...save logic
  } finally {
    isSavingRef.current = false
    setIsSaving(false)
  }
}, [...])
```

**Issue 3: Use Promise.allSettled for granular errors**

```typescript
const results = await Promise.allSettled([
  updateThemeFn({ data: { brandingConfig: ... } }),
  updateCustomCssFn({ data: { customCss } }),
])

const failures = results.filter(r => r.status === 'rejected')
if (failures.length > 0) {
  // Report which save failed
}
```

**Issue 4: Debounce CSS textarea for preview**

```typescript
const [customCss, setCustomCssImmediate] = useState(initialCustomCss)
const [debouncedCss, setDebouncedCss] = useState(initialCustomCss)

useEffect(() => {
  const timer = setTimeout(() => setDebouncedCss(customCss), 300)
  return () => clearTimeout(timer)
}, [customCss])

// Use debouncedCss for preview, customCss for textarea value
```

### Preview Component

**Simplified approach** (recommended by simplicity reviewer):

Instead of complex CSS injection for Advanced mode preview, show a placeholder message:

```typescript
interface ThemePreviewProps {
  brandingMode: BrandingMode
  // For simple mode only
  effectiveLight: ThemeVariables
  effectiveDark: ThemeVariables
  // Shared
  themeMode: ThemeMode
  previewMode: 'light' | 'dark'
}

// In component
{brandingMode === 'advanced' ? (
  <div className="flex items-center justify-center h-full text-muted-foreground">
    <p>Preview not available for custom CSS.</p>
    <p>Save and view your portal to see changes.</p>
  </div>
) : (
  <ThemePreviewContent ... />
)}
```

**Why this is better:**

- Avoids complex CSS scoping issues (customCss targets `:root`, not preview div)
- Reduces component complexity by ~30 lines
- Clear user expectation - they know to check the portal

### Research Insights: Performance

**Add CSS size limit:**

```typescript
// In server/functions/settings.ts
const MAX_CUSTOM_CSS_SIZE = 50 * 1024 // 50KB limit

export const updateCustomCssFn = createServerFn({ method: 'POST' })
  .validator(z.object({
    customCss: z.string().max(MAX_CUSTOM_CSS_SIZE, 'Custom CSS exceeds 50KB limit')
  }))
  .handler(...)
```

**Font loading optimization:**
Consider tracking font load state to avoid FOUT:

```typescript
const [fontLoaded, setFontLoaded] = useState(false)

useEffect(() => {
  if (!fontFamily) return
  setFontLoaded(false)
  document.fonts.load(`16px ${fontFamily}`).then(() => setFontLoaded(true))
}, [fontFamily])
```

## Acceptance Criteria

### Core Functionality

- [x] Add `brandingMode` field to `BrandingConfig` type in `settings.types.ts`
- [x] Add `BRANDING_MODES` const array for runtime validation
- [x] Portal applies ONLY simple mode CSS when `brandingMode === 'simple'`
- [x] Portal applies ONLY custom CSS when `brandingMode === 'advanced'`
- [x] `themeMode` (light/dark/user) works correctly in both branding modes
- [x] Theme toggle visibility respects `themeMode` in both branding modes

### Admin UI

- [x] Segmented control at top of branding page to switch modes
- [x] Simple mode shows: presets, 5 color pickers, font, radius
- [x] Advanced mode shows: instructions, CSS editor
- [x] Theme mode dropdown visible in BOTH modes (shared setting)
- [x] Preview shows placeholder in Advanced mode
- [x] Switching modes preserves all settings (no data loss)

### Backwards Compatibility

- [x] Existing users without `brandingMode` default to `'simple'`
- [x] Existing `customCss` is preserved but not applied until user switches to Advanced
- [x] No database migration required

### Edge Cases

- [x] Invalid CSS in Advanced mode: browser ignores (no crash)
- [x] CSS size limit (50KB) enforced on save
- [x] Mode switching with unsaved changes preserves in-memory state

### Code Quality (from race condition review)

- [x] Timer cleanup on component unmount
- [ ] Double-click save protection with ref guard
- [ ] Use `Promise.allSettled` for parallel saves
- [ ] Debounce CSS textarea updates for preview

## Files to Modify

| File                                                                    | Changes                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/web/src/lib/server/domains/settings/settings.types.ts`            | Add `BrandingMode` type, `BRANDING_MODES` const, type guard |
| `apps/web/src/routes/_portal.tsx`                                       | Conditional CSS application based on mode, preconnect hints |
| `apps/web/src/routes/admin/settings.branding.tsx`                       | Add segmented control, restructure layout                   |
| `apps/web/src/components/admin/settings/branding/use-branding-state.ts` | Add `brandingMode` state, fix race conditions               |
| `apps/web/src/components/admin/settings/branding/theme-preview.tsx`     | Add placeholder for Advanced mode                           |
| `apps/web/src/lib/server/functions/settings.ts`                         | Add 50KB size limit validation                              |

## UX Considerations

### Mode Switching Flow

1. User clicks different mode in segmented control
2. Content area updates immediately (no save required)
3. Previous mode's settings preserved in state
4. If switching TO Simple with existing CSS, show confirmation
5. Save button persists current mode + all settings
6. Portal reflects active mode after save

### Instructions Banner (Advanced Mode)

```
Create your theme at tweakcn.com, then paste the CSS below.
Your CSS should include :root { } and .dark { } blocks.
```

## Migration Path

**For existing users:**

1. `brandingMode` will be `undefined` (defaults to `'simple'`)
2. Their `brandingConfig` colors continue to work
3. Any existing `customCss` is preserved but not applied
4. If they want to use their `customCss`, they switch to Advanced mode

**No breaking changes** - existing portals render identically.

## Out of Scope

- CSS validation/linting (browser handles gracefully)
- "Export Simple as CSS" feature (future enhancement)
- Per-board theming overrides
- Live CSS syntax highlighting in editor
- Advanced mode preview with CSS injection (too complex for value)

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-02-flexible-branding-brainstorm.md`
- Current implementation: `apps/web/src/routes/admin/settings.branding.tsx`
- Theme generator: `apps/web/src/lib/shared/theme/generator.ts`
- Portal layout: `apps/web/src/routes/_portal.tsx`
- State hook: `apps/web/src/components/admin/settings/branding/use-branding-state.ts`

### External

- [tweakcn.com](https://tweakcn.com) - External theme builder for shadcn/ui
- [Primer Segmented Control](https://primer.style/design/components/segmented-control/) - Design system reference
- [TanStack Start Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions) - Zod validation patterns
- [Nielsen Norman Group - Modes](https://www.nngroup.com/articles/modes/) - UX best practices for mode switching
