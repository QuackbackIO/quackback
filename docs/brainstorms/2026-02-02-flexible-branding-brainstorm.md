# Flexible Branding & Styling System

**Date:** 2026-02-02
**Status:** Ready for planning

## What We're Building

A two-tier branding system that serves both non-technical admins and power users:

1. **Simple Mode (Quick Setup tab):** Preset themes + 5 key color pickers (primary, secondary, accent, background, foreground) with smart auto-derivation of remaining variables

2. **Advanced Mode (Custom CSS tab):** Raw CSS editor for pasting full theme CSS from external builders like tweakcn.com, plus direct CSS customization

3. **Theme Mode Control:** Admin can force light-only, dark-only, or allow user toggling

## Why This Approach

- **Two-Tab UI** cleanly separates simple vs advanced without cluttering either experience
- **External theme builders** (tweakcn.com) already solve the hard UX problem of theme creation - no need to rebuild
- **CSS paste import** is the simplest integration path and matches how designers actually work
- **Instance-wide scope** keeps the system simple - no per-board complexity
- **Brand-focused color set** (5 colors) covers the visual identity without overwhelming users

## Key Decisions

| Decision           | Choice                                                    | Rationale                                                                 |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| UI structure       | Two-tab layout                                            | Clean separation, familiar pattern                                        |
| Simple mode colors | Primary, Secondary, Accent, Background, Foreground        | Covers brand identity essentials                                          |
| Advanced mode      | Raw CSS editor                                            | Power users prefer direct control, `customCss` field already exists in DB |
| Theme creation     | External tools (tweakcn.com)                              | Better UX than building our own, already supports shadcn format           |
| Import format      | CSS variables (paste)                                     | Matches tweakcn.com output, most flexible                                 |
| Theme scope        | Instance-wide only                                        | Simpler implementation, covers 95% of use cases                           |
| Dark/light modes   | Admin controls: light-only, dark-only, or user-toggleable | Maximum flexibility for brand consistency                                 |

## Feature Summary

### Tab 1: Quick Setup (Enhanced Current UI)

- **Preset selector** with visual preview cards (14 existing presets)
- **5 key color pickers:**
  - Primary (brand color)
  - Secondary
  - Accent
  - Background
  - Foreground
- **Font selector** (existing)
- **Corner roundness slider** (existing)
- **Theme mode dropdown:** Light only / Dark only / User choice
- Auto-derives remaining ~45 CSS variables from the 5 key colors

### Tab 2: Custom CSS

- **Instructions section** with link to tweakcn.com
- **CSS textarea** for pasting `:root { }` and `.dark { }` blocks
- **Parser** extracts CSS variables and validates format
- **Live preview** shows changes before saving
- **Export button** to copy current theme as CSS

### Database Changes

- Add `themeMode` field to settings: `'light' | 'dark' | 'user'` (default: `'user'`)
- Existing `customCss` field already supports raw CSS storage
- Existing `brandingConfig` JSON stores the simple mode values

## Open Questions

1. **Validation:** How strict should CSS parsing be? Accept any valid CSS or only known variables?
2. **Conflict resolution:** If user sets colors in both Simple mode AND pastes Custom CSS, which wins?
3. **Preview safety:** Should Custom CSS preview be sandboxed to prevent breaking the settings page?

## Out of Scope (Future)

- Per-board theme overrides
- Theme marketplace / sharing
- Built-in visual theme builder
- CSS-in-JS or component-level theming

## Next Steps

Run `/workflows:plan` to create implementation plan covering:

- Database schema update for `themeMode`
- Tab UI component structure
- CSS parser implementation
- Theme mode enforcement in portal layout
- Migration of existing branding settings
