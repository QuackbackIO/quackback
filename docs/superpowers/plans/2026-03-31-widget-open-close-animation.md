# Widget Open/Close Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the widget panel bloom from the trigger button on open and collapse back into it on close, with a spin-swap icon transition.

**Architecture:** All changes are confined to `sdk-template.ts` — a single TypeScript file that generates a vanilla JS IIFE as a string. The SDK has no test harness; verification is done via `bun run typecheck` + `bun run dev` + manual browser testing. Three logical units: (1) panel animation styles, (2) icon DOM structure, (3) icon toggle logic in show/hide.

**Tech Stack:** Vanilla JS string template (TypeScript), CSS transforms, `cubic-bezier` easing

---

### Task 1: Update panel open/close animation

Change the desktop panel from a barely-perceptible `scale(0.95→1)` to a full `scale(0→1)` bloom from the button corner, with asymmetric spring/ease-in timing applied dynamically on show/hide.

**Files:**

- Modify: `apps/web/src/lib/shared/widget/sdk-template.ts`

- [ ] **Step 1: Change initial panel scale and remove static transition**

In `createPanel()`, find the desktop `panel = createElement("div", {...})` block (around line 208). Change two things:

```ts
// Before:
        transform: "scale(0.95)",
        transformOrigin: placement === "left" ? "bottom left" : "bottom right",
        transition: "opacity 200ms ease-out, transform 200ms ease-out",
// After:
        transform: "scale(0)",
        transformOrigin: placement === "left" ? "bottom left" : "bottom right",
```

Remove the `transition` line entirely — transitions will be applied dynamically in `showPanel`/`hidePanel`.

- [ ] **Step 2: Apply spring easing in showPanel**

In `showPanel()`, find the desktop branch (the `else` block after `if (isMobile)`):

```ts
// Before:
    } else {
      panel.style.display = "block";
      // Force reflow
      void panel.offsetHeight;
      panel.style.opacity = "1";
      panel.style.transform = "scale(1)";
    }

// After:
    } else {
      panel.style.display = "block";
      // Force reflow so the browser commits opacity:0 / scale(0) before we transition
      void panel.offsetHeight;
      panel.style.transition = "opacity 280ms cubic-bezier(0.34,1.56,0.64,1), transform 280ms cubic-bezier(0.34,1.56,0.64,1)";
      panel.style.opacity = "1";
      panel.style.transform = "scale(1)";
    }
```

- [ ] **Step 3: Apply ease-in and collapse to scale(0) in hidePanel**

In `hidePanel()`, find the desktop branch:

```ts
// Before:
    } else {
      panel.style.opacity = "0";
      panel.style.transform = "scale(0.95)";
      setTimeout(function() { if (!isOpen && panel) panel.style.display = "none"; }, 200);
    }

// After:
    } else {
      panel.style.transition = "opacity 200ms cubic-bezier(0.4,0,1,1), transform 200ms cubic-bezier(0.4,0,1,1)";
      panel.style.opacity = "0";
      panel.style.transform = "scale(0)";
      setTimeout(function() { if (!isOpen && panel) panel.style.display = "none"; }, 200);
    }
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Verify manually**

Run `bun run dev`, open the widget in a browser. Click the trigger — the panel should bloom from the button corner with a slight spring overshoot. Click again — it should snap shut toward the button corner. The mobile slide-up is unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/shared/widget/sdk-template.ts
git commit -m "feat(widget): bloom panel from button corner with spring easing"
```

---

### Task 2: Replace single icon with stacked spin-swap icons

The trigger currently swaps its entire `innerHTML` to toggle icons. Replace this with two absolutely-stacked icon spans that can be individually transitioned.

**Files:**

- Modify: `apps/web/src/lib/shared/widget/sdk-template.ts`

- [ ] **Step 1: Add iconChat and iconClose state variables**

Find the state variable block (around line 44):

```ts
// Before:
var listeners = {}
var pendingOpen = null

// After:
var iconChat = null
var iconClose = null
var listeners = {}
var pendingOpen = null
```

- [ ] **Step 2: Replace innerHTML icon with stacked icon wrapper in createTrigger**

Find this line in `createTrigger()`:

```ts
// Chat bubbles icon (Heroicons solid)
trigger.innerHTML = CHAT_ICON
```

Replace it with:

```ts
// Stacked icons — both rendered, toggled via opacity + rotation
var iconWrapper = createElement('div', {
  position: 'relative',
  width: '28px',
  height: '28px',
  flexShrink: '0',
})

var iconTransition =
  'opacity 220ms cubic-bezier(0.34,1.56,0.64,1), transform 220ms cubic-bezier(0.34,1.56,0.64,1)'

iconChat = createElement('span', {
  position: 'absolute',
  top: '0',
  left: '0',
  display: 'flex',
  opacity: '1',
  transform: 'rotate(0deg)',
  transition: iconTransition,
})
iconChat.innerHTML = CHAT_ICON

iconClose = createElement('span', {
  position: 'absolute',
  top: '0',
  left: '0',
  display: 'flex',
  opacity: '0',
  transform: 'rotate(-90deg)',
  transition: iconTransition,
})
iconClose.innerHTML = CLOSE_ICON

iconWrapper.appendChild(iconChat)
iconWrapper.appendChild(iconClose)
trigger.appendChild(iconWrapper)
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Verify manually**

Run `bun run dev`. The trigger button should look identical to before (chat icon visible, close icon invisible). No visual change yet — icon toggle is wired in the next task.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/shared/widget/sdk-template.ts
git commit -m "feat(widget): stack chat/close icons for animated spin-swap"
```

---

### Task 3: Wire icon spin-swap into showPanel / hidePanel

Replace the `innerHTML` assignments in `showPanel` and `hidePanel` with style updates on the two icon spans.

**Files:**

- Modify: `apps/web/src/lib/shared/widget/sdk-template.ts`

- [ ] **Step 1: Update showPanel icon toggle**

In `showPanel()`, find the desktop icon swap:

```ts
      } else {
        trigger.setAttribute("aria-label", "Close feedback widget");
        trigger.innerHTML = CLOSE_ICON;
      }
```

Replace with:

```ts
      } else {
        trigger.setAttribute("aria-label", "Close feedback widget");
        if (iconChat && iconClose) {
          iconChat.style.opacity = "0";
          iconChat.style.transform = "rotate(90deg)";
          iconClose.style.opacity = "1";
          iconClose.style.transform = "rotate(0deg)";
        }
      }
```

- [ ] **Step 2: Update hidePanel icon toggle**

In `hidePanel()`, find the desktop icon swap:

```ts
if (!isMobile) {
  trigger.setAttribute('aria-label', 'Open feedback widget')
  trigger.innerHTML = CHAT_ICON
}
```

Replace with:

```ts
if (!isMobile) {
  trigger.setAttribute('aria-label', 'Open feedback widget')
  if (iconChat && iconClose) {
    iconChat.style.opacity = '1'
    iconChat.style.transform = 'rotate(0deg)'
    iconClose.style.opacity = '0'
    iconClose.style.transform = 'rotate(-90deg)'
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Verify manually**

Run `bun run dev`. Click the trigger:

- Panel blooms from button corner with spring overshoot
- Chat icon spins away (rotates to 90°, fades out) as close icon spins in (from -90° to 0°, fades in)
- Click again: panel snaps closed, close icon spins away as chat icon spins back in

- [ ] **Step 5: Run lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/shared/widget/sdk-template.ts
git commit -m "feat(widget): animate icon spin-swap on open/close"
```
