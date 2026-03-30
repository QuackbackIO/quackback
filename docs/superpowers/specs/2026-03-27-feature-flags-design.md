# Feature Flags Design

Simple feature flag system using the existing settings table. Allows development features to be merged but hidden until ready for rollout.

## Data Layer

Add a `featureFlags` JSONB column to the `settings` table (no new tables).

```ts
export interface FeatureFlags {
  analytics: boolean
  helpCenter: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  analytics: false,
  helpCenter: false,
}
```

The settings service provides:

- `getFeatureFlags()` -- reads from cached settings, merges with defaults so new flags auto-appear as `false`
- `isFeatureEnabled(flag: keyof FeatureFlags)` -- one-liner check
- `updateFeatureFlags(flags: Partial<FeatureFlags>)` -- update + cache invalidation

## Gating Pattern

**Server-side**: Check the flag before returning data or in route guards. Throw/redirect when disabled.

**Client-side**: Read from bootstrap settings data (already in `getTenantSettings()`). Hide nav items and components when flag is off. The admin sidebar conditionally renders flagged nav items.

## Admin UI

New route: `/admin/settings/experimental`

A simple page with a card per feature flag -- name, description, and a toggle switch. Each flag has metadata (label + description) defined in a registry constant, not in the DB.

```
+----------------------------------------------------------+
| Settings > Experimental                                   |
+----------------------------------------------------------+
|                                                          |
|  Experimental Features                                   |
|  These features are in development and may change.       |
|                                                          |
|  +----------------------------------------------------+ |
|  | Analytics Dashboard                          [OFF]  | |
|  | View feedback trends, top posts, and engagement     | |
|  | metrics from the admin panel.                       | |
|  +----------------------------------------------------+ |
|  |                                                      | |
|  | Help Center                                  [OFF]  | |
|  | Create and manage a knowledge base with categories   | |
|  | and articles for your users.                        | |
|  +----------------------------------------------------+ |
|                                                          |
+----------------------------------------------------------+
```

## Settings Sidebar Entry

Add "Experimental" to the settings sub-navigation with a `FlaskConical` (lucide) icon.

## Flag Lifecycle

1. Add flag to `FeatureFlags` interface (defaults off)
2. Gate code behind the flag at render/route time
3. When ready: DB migration sets the flag to `true`
4. Eventually: remove flag and checks -- feature is permanent

## Initial Flags

| Flag         | Description                        | Default |
| ------------ | ---------------------------------- | ------- |
| `analytics`  | Analytics dashboard in admin panel | `false` |
| `helpCenter` | Help center knowledge base         | `false` |

## Files Changed

| Action | File                                                                                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Modify | `packages/db/src/schema/auth.ts` -- add `featureFlags` JSONB column to settings                                             |
| Modify | `apps/web/src/lib/server/domains/settings/settings.types.ts` -- add FeatureFlags interface + defaults                       |
| Modify | `apps/web/src/lib/server/domains/settings/settings.service.ts` -- add getFeatureFlags, isFeatureEnabled, updateFeatureFlags |
| Create | `apps/web/src/lib/server/functions/feature-flags.ts` -- server functions for reading/updating flags                         |
| Create | `apps/web/src/routes/admin/settings.experimental.tsx` -- admin settings route                                               |
| Create | `apps/web/src/components/admin/settings/experimental-settings.tsx` -- toggle UI                                             |
| Modify | `apps/web/src/components/admin/admin-sidebar.tsx` -- gate analytics/helpCenter behind flags                                 |
| Modify | `apps/web/src/routes/admin/settings.tsx` -- add Experimental to settings sub-nav                                            |
