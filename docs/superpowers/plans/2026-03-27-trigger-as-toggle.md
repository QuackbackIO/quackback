# Trigger-as-Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the widget trigger button visible when the panel is open, position the panel above the button, and let the trigger toggle the panel open/close — replacing the X close button in the widget header.

**Architecture:** Two files change. The SDK (`sdk-template.ts`) handles all positioning and icon-swap logic in JS string form. The widget shell (`widget-shell.tsx`) simply removes the X button and its import. Mobile keeps existing hide/show behavior since the full-screen panel covers the trigger area.

**Tech Stack:** Vanilla JS string template (SDK), React/TSX (widget shell), Vitest for tests.

**Worktree:** `/home/james/quackback/.worktrees/trigger-toggle` on branch `feat/trigger-as-toggle`

---

## Files

- Modify: `apps/web/src/lib/shared/widget/sdk-template.ts` — icon constants, panel offset, showPanel/hidePanel, click toggle
- Modify: `apps/web/src/components/widget/widget-shell.tsx` — remove X button + XMarkIcon import
- Modify: `apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts` — add tests for new behavior

---

### Task 1: Add failing tests for trigger-as-toggle SDK behavior

**Files:**

- Modify: `apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts`

- [ ] **Step 1: Add failing tests**

Append these tests to the `describe` block in `apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts`:

```ts
it('positions desktop panel above the trigger button (bottom: 80px)', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  // Panel must be offset above the trigger (24px margin + 48px trigger + 8px gap)
  expect(result).toContain('bottom: "80px"')
})

it('defines CHAT_ICON and CLOSE_ICON variables for icon swap', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  expect(result).toContain('var CHAT_ICON =')
  expect(result).toContain('var CLOSE_ICON =')
})

it('swaps trigger icon to CLOSE_ICON when panel opens on desktop', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  expect(result).toContain('trigger.innerHTML = CLOSE_ICON')
})

it('restores trigger icon to CHAT_ICON when panel closes on desktop', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  expect(result).toContain('trigger.innerHTML = CHAT_ICON')
})

it('hides trigger on mobile when panel opens', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  // Mobile still hides trigger since full-screen panel covers it
  expect(result).toContain('trigger.style.display = "none"')
})

it('trigger click dispatches close when panel is open', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  expect(result).toContain('if (isOpen) dispatch("close")')
})

it('updates aria-label when open and closed', () => {
  const result = buildWidgetSDK('https://feedback.acme.com')
  expect(result).toContain('Close feedback widget')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
bun run test apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts 2>&1 | tail -20
```

Expected: 7 new test failures, all existing tests still pass.

- [ ] **Step 3: Commit failing tests**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
git add apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts
git commit -m "test: add failing tests for trigger-as-toggle behavior"
```

---

### Task 2: Update SDK — icon constants, panel offset, toggle behavior

**Files:**

- Modify: `apps/web/src/lib/shared/widget/sdk-template.ts`

- [ ] **Step 1: Add CHAT_ICON and CLOSE_ICON constants**

In `sdk-template.ts`, find the `// State` comment block (around line 41) and add the icon constants immediately before it:

```ts
// Icon SVGs
var CHAT_ICON =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z"/></svg>'
var CLOSE_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 18L18 6M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
```

- [ ] **Step 2: Replace hardcoded chat SVG with CHAT_ICON constant in createTrigger()**

Find this line in `createTrigger()`:

```ts
trigger.innerHTML =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z"/><path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z"/></svg>'
```

Replace with:

```ts
trigger.innerHTML = CHAT_ICON
```

- [ ] **Step 3: Change trigger click handler to toggle**

Find:

```ts
trigger.addEventListener('click', function () {
  dispatch('open')
})
```

Replace with:

```ts
trigger.addEventListener('click', function () {
  if (isOpen) dispatch('close')
  else dispatch('open')
})
```

- [ ] **Step 4: Move desktop panel bottom offset from 24px to 80px**

In `createPanel()`, find the desktop panel creation (inside the `else` branch after `if (isMobile)`):

```ts
        bottom: "24px",
        [placement === "left" ? "left" : "right"]: "24px",
```

Replace with:

```ts
        bottom: "80px",
        [placement === "left" ? "left" : "right"]: "24px",
```

- [ ] **Step 5: Update showPanel() — keep trigger visible on desktop, swap icon**

Find the entire trigger block in `showPanel()`:

```ts
if (trigger) {
  trigger.style.display = 'none'
  trigger.setAttribute('aria-expanded', 'true')
}
```

Replace with:

```ts
if (trigger) {
  trigger.setAttribute('aria-expanded', 'true')
  if (isMobile) {
    trigger.style.display = 'none'
  } else {
    trigger.setAttribute('aria-label', 'Close feedback widget')
    trigger.innerHTML = CLOSE_ICON
  }
}
```

- [ ] **Step 6: Update hidePanel() — restore icon on desktop, restore display on mobile**

Find the entire trigger block in `hidePanel()`:

```ts
if (trigger && isIdentified && !(config && config.trigger === false)) {
  trigger.style.display = 'flex'
  trigger.setAttribute('aria-expanded', 'false')
}
```

Replace with:

```ts
if (trigger && isIdentified && !(config && config.trigger === false)) {
  trigger.setAttribute('aria-expanded', 'false')
  if (isMobile) {
    trigger.style.display = 'flex'
  } else {
    trigger.setAttribute('aria-label', 'Open feedback widget')
    trigger.innerHTML = CHAT_ICON
  }
}
```

- [ ] **Step 7: Run the tests**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
bun run test apps/web/src/lib/shared/widget/__tests__/sdk-template.test.ts 2>&1 | tail -15
```

Expected: All tests pass (existing 15 + new 7 = 22 passing).

- [ ] **Step 8: Commit**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
git add apps/web/src/lib/shared/widget/sdk-template.ts
git commit -m "feat: position panel above trigger, swap icon on open/close"
```

---

### Task 3: Remove X close button from widget shell

**Files:**

- Modify: `apps/web/src/components/widget/widget-shell.tsx`

- [ ] **Step 1: Remove XMarkIcon from the import line**

Find:

```ts
import {
  ArrowLeftIcon,
  XMarkIcon,
  LightBulbIcon,
  NewspaperIcon,
  BookOpenIcon,
} from '@heroicons/react/24/solid'
```

Replace with:

```ts
import {
  ArrowLeftIcon,
  LightBulbIcon,
  NewspaperIcon,
  BookOpenIcon,
} from '@heroicons/react/24/solid'
```

- [ ] **Step 2: Remove the close button JSX**

Find and delete this entire block from the render:

```tsx
<button
  type="button"
  onClick={closeWidget}
  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
  aria-label="Close feedback widget"
>
  <XMarkIcon className="w-4 h-4 text-muted-foreground" />
</button>
```

- [ ] **Step 3: Run full test suite to confirm nothing broke**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
bun run test 2>&1 | tail -8
```

Expected: 1141+ tests passing, 0 failures.

- [ ] **Step 4: Run typecheck**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
bun run typecheck 2>&1 | tail -10
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
git add apps/web/src/components/widget/widget-shell.tsx
git commit -m "feat: remove X close button from widget header (trigger now closes)"
```

---

### Task 4: Open PR

- [ ] **Step 1: Push branch**

```bash
cd /home/james/quackback/.worktrees/trigger-toggle
git push -u origin feat/trigger-as-toggle
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat: trigger button stays visible and toggles widget open/close" \
  --body "$(cat <<'EOF'
## Summary

- Widget panel now floats above the trigger button (80px from bottom vs previous 24px), keeping the trigger visible at all times on desktop
- Trigger button toggles the widget: chat icon when closed, X icon when open — no more separate close button
- Removed the X close button from the widget header
- Mobile behavior unchanged (panel still slides up full-screen, trigger hides behind it)

Closes #107

## Test plan

- [ ] Open widget on desktop — button stays visible below the panel
- [ ] Click trigger while open — widget closes
- [ ] Escape key still closes the widget
- [ ] Widget header no longer shows X button
- [ ] On mobile — panel covers full screen, trigger hides as before
- [ ] Left placement works correctly (panel and trigger both align left)
EOF
)"
```
