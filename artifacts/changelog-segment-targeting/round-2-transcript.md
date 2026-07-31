# changelog-segment-targeting — round 2 transcript

Round-1 hole named by the critic: targeting was only reachable through the
validated server-function input — the admin composer had no segment picker.

## What changed (UI only; server plumbing from round 1 unchanged)

- `changelog-metadata-sidebar-content.tsx`: new "Notify segments" section
  reusing `SegmentMultiSelect` (the batch-6 article-audience control),
  fetching segments via `listSegmentsFn` (queryKey `['admin','segments']`,
  same as the help-center category form). Shown only when the save will
  publish or schedule (`willSendEmail`) and the workspace has segments.
  Default = everyone (empty), with helper copy "Leave empty to notify every
  subscriber." Hardcoded English, matching the admin-surface convention.
- `changelog-metadata-sidebar.tsx`: pass-through props
  (`segmentIds`, `onSegmentIdsChange`).
- `create-changelog-dialog.tsx`: `segmentIds` state (default `[]`, reset on
  close), always sent in the create payload.
- `changelog-modal.tsx` (edit): pre-fills from `entry.segmentIds`, uses a
  touched-gate identical to `featuredImageUrl` — an untouched list isn't
  round-tripped; an edited one (including cleared to `[]`) replaces the
  stored list wholesale.

## Test

`apps/web/src/components/admin/changelog/__tests__/changelog-segment-picker.test.tsx`
(happy-dom, QueryClientProvider; `listSegmentsFn` / settings / categories /
image-upload mocked).

### Input → output

- Two segments returned, published state, empty selection → "Notify segments"
  section renders, both segment names listed, zero checkboxes checked,
  "everyone" helper copy present.
- Clicking the "Enterprise" checkbox → `onSegmentIdsChange(['segment_enterprise'])`.
- Pre-filled `segmentIds={['segment_beta']}` (edit modal case) → the Beta
  testers checkbox renders checked.
- Edge: draft publish state → section hidden (a draft never notifies).
- Edge: workspace with no segments → section hidden.

### Verification

- New component test: 5/5 pass.
- `bunx vitest run src/components/admin/changelog src/components/admin/segments`:
  5 files, 66 tests, all pass.
- `bun run typecheck`: clean. `bunx eslint src/components/admin/changelog/`:
  clean.

## Deviation from the round-1 hole

None — the picker is in both the create dialog and the edit modal (desktop
sidebar and mobile settings sheet, since both render the same sidebar
content component), writing through the round-1 `segmentIds` plumbing.
