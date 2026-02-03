---
title: 'feat: Unified Theme Preview for Simple & Advanced Modes'
type: feat
date: 2026-02-02
---

# Unified Theme Preview for Simple & Advanced Modes

## Overview

Create a unified theme preview system that works identically for both Simple mode (color pickers) and Advanced mode (custom CSS). The preview should feel like the real portal with actual UI components, live CSS preview, and proper CSS isolation.

**Brainstorm:** `docs/brainstorms/2026-02-02-unified-theme-preview-brainstorm.md`

## Problem Statement

Current state:

- **Simple mode**: Shows a styled mockup with fake components, CSS variables applied inline
- **Advanced mode**: Shows "Preview not available" placeholder - users can't preview until they save

Problems identified through research:

1. Visual differences between preview and actual portal
2. Missing UI components (mockup is too simplified)
3. Not interactive (no hover states, no dark mode toggle)
4. CSS applies differently than on real portal
5. No preview at all for custom CSS in advanced mode

## Proposed Solution

A **phased approach** that progressively enhances preview capabilities:

1. **Phase 1**: Live custom CSS preview using enhanced inline styles (low risk, immediate value)
2. **Phase 2**: Shadow DOM isolation for bulletproof CSS scoping (higher complexity, better isolation)
3. **Phase 3**: Real UI components inside preview (highest fidelity)

This plan focuses on **Phase 1** - getting live custom CSS preview working quickly with minimal risk.

## Technical Approach

### Why NOT Shadow DOM First?

SpecFlow analysis identified critical technical risks with Shadow DOM:

| Risk                     | Severity    | Issue                                                      |
| ------------------------ | ----------- | ---------------------------------------------------------- |
| Tailwind v4 + Shadow DOM | HIGH        | Utility classes don't work without injecting compiled CSS  |
| Radix UI portals         | MEDIUM-HIGH | Dialogs, selects, tooltips escape Shadow DOM               |
| :root scope              | MEDIUM      | Custom CSS targets :root which doesn't apply in Shadow DOM |

**Recommendation**: Start with inline styles approach (Phase 1), spike Shadow DOM separately.

### Phase 1: Live Custom CSS Preview (This Plan)

**Goal**: Make custom CSS preview work immediately without Shadow DOM complexity.

**Approach**:

1. Parse custom CSS to extract CSS variable definitions
2. Apply extracted variables as inline styles to preview wrapper
3. Keep existing mockup but make it respond to custom CSS variables
4. Add debounced updates for performance

```tsx
// Pseudocode for CSS variable extraction
function extractCssVariables(css: string): Record<string, string> {
  const variables: Record<string, string> = {}

  // Extract from :root { --name: value; }
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/g)
  // Extract from .dark { --name: value; }
  const darkMatch = css.match(/\.dark\s*\{([^}]+)\}/g)

  // Parse and return { '--primary': 'oklch(...)', ... }
  return variables
}
```

**Benefits**:

- Works immediately with existing preview component
- No Shadow DOM complexity
- Custom CSS variables apply correctly
- Hover states work (already in mockup)
- Can be implemented in 1-2 days

**Limitations**:

- Complex CSS selectors beyond variables won't preview
- Users wanting full CSS control need to save and check portal
- Not pixel-perfect with portal

### Architecture Decision

**Why parse CSS variables instead of injecting full CSS?**

1. **Safety**: No risk of custom CSS breaking admin UI
2. **Simplicity**: CSS variable extraction is straightforward
3. **Compatibility**: Works with existing inline styles approach
4. **Performance**: Only ~50 variables to process, not entire stylesheet

## Acceptance Criteria

### Core Functionality

- [x] Custom CSS textarea shows live preview (debounced 300ms)
- [x] Extract and apply CSS variables from `:root { }` blocks
- [x] Extract and apply CSS variables from `.dark { }` blocks
- [x] Preview mode toggle applies correct variable set (light/dark)
- [x] Simple mode continues to work as before

### Edge Cases

- [x] Empty CSS: Preview shows default theme
- [x] Invalid CSS: Gracefully ignored (browser behavior)
- [x] Missing :root block: No crash, use defaults
- [x] CSS without variables: Preview unchanged
- [x] Very large CSS (50KB): Still responsive (debounce handles)

### UX Requirements

- [x] No flash/flicker when switching modes
- [x] Preview updates smoothly while typing
- [x] Light/dark toggle works in both modes
- [x] Clear indication that advanced mode has live preview now

## Implementation Plan

### File Changes

| File                                                                    | Changes                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/web/src/lib/shared/theme/css-parser.ts`                           | **NEW** - CSS variable extraction utilities                  |
| `apps/web/src/components/admin/settings/branding/use-branding-state.ts` | Add debounced CSS parsing, expose extracted variables        |
| `apps/web/src/components/admin/settings/branding/theme-preview.tsx`     | Accept customCssVariables prop, merge with theme variables   |
| `apps/web/src/routes/admin/settings.branding.tsx`                       | Remove "preview not available" placeholder for advanced mode |

### New File: css-parser.ts

```typescript
// apps/web/src/lib/shared/theme/css-parser.ts

/**
 * Extract CSS custom property declarations from CSS text
 * Handles :root { } and .dark { } blocks
 */
export function extractCssVariables(css: string): {
  light: Record<string, string>
  dark: Record<string, string>
} {
  const light: Record<string, string> = {}
  const dark: Record<string, string> = {}

  // Match :root { ... } blocks
  const rootMatches = css.matchAll(/:root\s*\{([^}]+)\}/g)
  for (const match of rootMatches) {
    parseVariables(match[1], light)
  }

  // Match .dark { ... } blocks
  const darkMatches = css.matchAll(/\.dark\s*\{([^}]+)\}/g)
  for (const match of darkMatches) {
    parseVariables(match[1], dark)
  }

  return { light, dark }
}

function parseVariables(block: string, target: Record<string, string>) {
  // Match --variable-name: value;
  const varMatches = block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)
  for (const match of varMatches) {
    const name = `--${match[1].trim()}`
    const value = match[2].trim()
    target[name] = value
  }
}
```

### State Hook Changes

```typescript
// In use-branding-state.ts

// Add debounced CSS parsing
const [parsedCssVariables, setParsedCssVariables] = useState<{
  light: Record<string, string>
  dark: Record<string, string>
}>({ light: {}, dark: {} })

useEffect(() => {
  const timer = setTimeout(() => {
    if (customCss) {
      setParsedCssVariables(extractCssVariables(customCss))
    } else {
      setParsedCssVariables({ light: {}, dark: {} })
    }
  }, 300)
  return () => clearTimeout(timer)
}, [customCss])

// Expose in return
return {
  // ... existing
  parsedCssVariables, // NEW
}
```

### Preview Component Changes

```typescript
// In theme-preview.tsx

interface ThemePreviewProps {
  // ... existing props
  customCssVariables?: {
    light: Record<string, string>
    dark: Record<string, string>
  }
}

// In component: merge custom variables with theme variables
const effectiveVariables = useMemo(() => {
  const base = previewMode === 'light' ? lightVars : darkVars
  const custom = customCssVariables?.[previewMode] ?? {}

  // Custom CSS variables override theme variables
  return { ...convertToStyle(base), ...custom }
}, [lightVars, darkVars, customCssVariables, previewMode])
```

### Branding Page Changes

```typescript
// In settings.branding.tsx

// Replace placeholder with actual preview
{state.brandingMode === 'advanced' ? (
  <ThemePreview
    lightVars={state.effectiveLight}
    darkVars={state.effectiveDark}
    previewMode={state.previewMode}
    radius={`${state.radius}rem`}
    fontFamily={state.font}
    logoUrl={state.logoUrl}
    workspaceName={workspaceName || 'My Workspace'}
    customCssVariables={state.parsedCssVariables} // NEW
  />
) : (
  // ... existing simple mode preview
)}
```

## Testing Strategy

### Unit Tests

- [ ] `extractCssVariables` parses valid CSS correctly
- [ ] `extractCssVariables` handles edge cases (empty, invalid, no vars)
- [ ] `extractCssVariables` separates light/dark variables correctly

### Integration Tests

- [ ] Typing in CSS textarea updates preview after debounce
- [ ] Switching preview mode shows correct variable set
- [ ] Simple mode preview unchanged
- [ ] Mode switching preserves preview state

### Manual Testing

- [ ] Paste real tweakcn CSS, verify preview matches
- [ ] Test with edge case CSS (comments, nested rules, @media)
- [ ] Verify performance with large CSS files

## Future Phases (Out of Scope)

### Phase 2: Shadow DOM Isolation

- Create Shadow DOM container component
- Investigate `adoptedStyleSheets` for Tailwind
- Handle Radix portal components
- Full CSS injection (not just variables)

### Phase 3: Real UI Components

- Import actual Button, Card, Input from @/components/ui
- Add more UI element coverage (forms, modals, alerts)
- Interactive states throughout

## Open Questions Resolved

| Question                             | Decision                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| How to handle CSS without variables? | Preview uses theme defaults, user can add variables            |
| What about complex CSS selectors?    | Not supported in Phase 1, noted as limitation                  |
| Debounce timing?                     | 300ms (standard UX pattern)                                    |
| Should we validate CSS?              | No, browser ignores invalid CSS gracefully                     |
| What about fonts in custom CSS?      | Extracted but may not preview (Google Fonts loaded separately) |

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-02-unified-theme-preview-brainstorm.md`
- Current preview: `apps/web/src/components/admin/settings/branding/theme-preview.tsx`
- State hook: `apps/web/src/components/admin/settings/branding/use-branding-state.ts`
- Branding page: `apps/web/src/routes/admin/settings.branding.tsx`

### External

- [tweakcn.com](https://tweakcn.com) - External theme builder (target CSS format)
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*) - MDN reference
