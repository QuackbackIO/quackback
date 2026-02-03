# Unified Theme Preview for Simple & Advanced Modes

**Date:** 2026-02-02
**Status:** Ready for planning

## What We're Building

A unified theme preview system that works identically for both Simple mode (color pickers) and Advanced mode (custom CSS). The preview should feel like the real portal, not a simplified mockup.

### Current State

- **Simple mode**: Shows a styled mockup with fake components, CSS variables applied inline
- **Advanced mode**: Shows "Preview not available" placeholder
- **Problems identified**:
  - Visual differences between preview and actual portal
  - Missing UI components (mockup is too simplified)
  - Not interactive (no hover states, no dark mode toggle)
  - CSS applies differently than on real portal

### Target State

A preview that:

1. Uses **actual UI components** from the codebase (Button, Card, Input, etc.)
2. Shows **live custom CSS preview** in advanced mode
3. Applies CSS **the same way** the portal does (style tag injection)
4. Shows **more UI elements** (modals, forms, dropdowns, states)
5. Uses **Shadow DOM isolation** so custom CSS can't break admin UI

## Why This Approach

**Why improve the mockup vs iframe?**

- Simpler architecture - no cross-frame communication needed
- Faster - no extra page load in iframe
- Better UX - seamlessly integrated into settings page
- Easier to maintain - single codebase, not two rendering contexts

**Why Shadow DOM for CSS isolation?**

- Custom CSS from tweakcn targets `:root` and `.dark` selectors
- Without isolation, this would affect the admin dashboard
- Shadow DOM creates a clean boundary - CSS inside can't leak out
- React supports Shadow DOM via `createRoot` on shadow host

**Why use actual components?**

- Ensures pixel-perfect match with real portal
- Automatically picks up component updates
- Reduces maintenance - one source of truth
- Enables interactive states (hover, focus, disabled)

## Key Decisions

| Decision             | Choice                   | Rationale                              |
| -------------------- | ------------------------ | -------------------------------------- |
| Preview architecture | Enhanced mockup          | Simpler than iframe, better integrated |
| CSS isolation        | Shadow DOM               | Bulletproof isolation for custom CSS   |
| Component strategy   | Use real UI components   | Pixel-perfect match, less maintenance  |
| CSS application      | Style tag injection      | Matches portal behavior exactly        |
| Mode handling        | Unified preview for both | Same component, different CSS source   |

## Technical Approach

### Shadow DOM Container

```tsx
function PreviewContainer({ children, themeStyles, customCss }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null)

  useEffect(() => {
    if (containerRef.current && !shadowRoot) {
      const shadow = containerRef.current.attachShadow({ mode: 'open' })
      setShadowRoot(shadow)
    }
  }, [])

  // Render into shadow DOM
  useEffect(() => {
    if (shadowRoot) {
      // Inject styles
      const styleEl = document.createElement('style')
      styleEl.textContent = themeStyles + (customCss || '')
      shadowRoot.appendChild(styleEl)
    }
  }, [shadowRoot, themeStyles, customCss])

  return <div ref={containerRef} />
}
```

### CSS Generation

- **Simple mode**: Generate CSS from `brandingConfig` via `generateThemeCSS()`
- **Advanced mode**: Use raw `customCss` string directly
- **Both modes**: Inject via `<style>` tag inside Shadow DOM

### Preview Content

Use actual components from the codebase:

- `PortalHeader` (or simplified version)
- `Button`, `Card`, `Input`, `Badge` from `@/components/ui`
- `PostCard` component (or representative version)

Show multiple states:

- Default, hover, active states
- Light and dark mode toggle
- Empty states, loading states
- Modal/dialog preview

## Open Questions

1. **Component imports**: Can we import portal components without side effects? May need lightweight versions.

2. **Font loading**: How do we load Google Fonts inside Shadow DOM? May need `@import` in style tag.

3. **Dark mode toggle**: Should preview have its own toggle, or sync with the preview mode buttons?

4. **Performance**: Shadow DOM re-renders - need to debounce CSS changes?

5. **Tailwind in Shadow DOM**: Do we need to include Tailwind base styles inside shadow root?

## Scope

### In Scope

- Shadow DOM preview container
- Live CSS preview for both modes
- Real UI components in preview
- Light/dark mode preview toggle
- Basic portal elements (header, cards, buttons)

### Out of Scope (future)

- Full page preview (scrolling, multiple sections)
- Interactive form submissions
- Responsive breakpoint preview
- Animation previews
- Export preview as image

## Success Criteria

- [ ] Preview looks identical to actual portal with same theme
- [ ] Custom CSS in advanced mode applies correctly to preview
- [ ] Custom CSS cannot affect admin dashboard styling
- [ ] Both light and dark mode previews work
- [ ] Hover/focus states work on interactive elements
- [ ] Preview updates in real-time as user edits (debounced)

## Next Steps

1. Run `/workflows:plan` to create implementation plan
2. Prototype Shadow DOM container with style injection
3. Test Tailwind/component rendering in Shadow DOM
4. Implement unified preview component
5. Update branding settings page to use new preview
