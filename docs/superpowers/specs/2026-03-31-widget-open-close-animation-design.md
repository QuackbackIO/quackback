# Widget Open/Close Animation Design

**Date:** 2026-03-31  
**Branch:** feat/trigger-as-toggle  
**Scope:** `apps/web/src/lib/shared/widget/sdk-template.ts`

## Goal

Make the widget feel physically connected to its trigger button: the panel expands out from the button on open and collapses back into it on close. The button icon rotates as the widget transitions to signal interactivity.

## Panel Animation

### Transform origin

Set `transform-origin` to the corner of the panel nearest the trigger button:

- Right-aligned placement → `bottom right`
- Left-aligned placement → `bottom left`

This makes the panel appear to bloom from the button's position.

### Scale

Change the initial scale from `0.95` (barely perceptible) to `0`. The full open-to-close range becomes `scale(0) → scale(1)`.

### Easing and timing

| Direction | Duration | Easing                                                        |
| --------- | -------- | ------------------------------------------------------------- |
| Open      | 280ms    | `cubic-bezier(0.34, 1.56, 0.64, 1)` (slight spring overshoot) |
| Close     | 200ms    | `cubic-bezier(0.4, 0, 1, 1)` (snappy ease-in)                 |

Asymmetric timing: open feels inviting, close feels crisp.

### Mobile

No change. The slide-up from bottom is already the correct behaviour for mobile.

## Icon / Button Animation

### Current behaviour

Icons are swapped by overwriting `innerHTML` — instant, no transition.

### New behaviour

Both icons (chat bubble + close X) are rendered simultaneously in the button, stacked absolutely inside a `position: relative` wrapper. Their visibility is controlled via opacity and rotation rather than DOM swaps.

**On open:**

- Chat icon: `opacity 1→0`, `rotate 0°→90°`
- Close icon: `opacity 0→1`, `rotate -90°→0°`

**On close:** reverse of the above.

This creates a "spin-swap" where the chat bubble rotates away as the X rotates in from the same direction. The button itself does not rotate — only the icon content moves.

### Icon timing

Duration: 220ms  
Easing: `cubic-bezier(0.34, 1.56, 0.64, 1)` (matches panel spring, feels cohesive)

## Implementation Scope

All changes are confined to `sdk-template.ts`:

1. **Icon HTML structure** — replace single-icon `innerHTML` with two stacked `<span>` elements, each containing one SVG, with absolute positioning and initial opacity/transform set inline.

2. **Panel styles** — update `transform-origin` (placement-aware), `transform` initial value (`scale(0)`), and split the `transition` string into open/close variants applied at show/hide time.

3. **`showPanel()`** — update icon toggle: set opacity and rotation on both icon spans rather than replacing `innerHTML`. Apply open transition timing to panel.

4. **`hidePanel()`** — same icon toggle in reverse. Apply close transition timing to panel before hiding.

## Out of Scope

- Mobile animation (unchanged)
- Backdrop animation (unchanged)
- Hover effects on the button (unchanged)
- Any React component changes
