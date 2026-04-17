# Heroicons Category Picker

**Date:** 2026-04-17

## Summary

Replace the emoji picker for help-center category icons with a Heroicons solid icon picker. The `icon` text column stores a Heroicons export key string instead of an emoji character.

## Storage

No schema change. The existing `icon text` column now stores a Heroicons export name, e.g. `"FolderIcon"`. Default value changes from `'📁'` to `"FolderIcon"`. No backwards compatibility handling — existing emoji rows render as the default icon.

## Picker UI (`category-form-dialog.tsx`)

Remove `CATEGORY_EMOJIS`, `DEFAULT_EMOJI`, and `emojiOpen` state. Replace with:

- **State**: `icon: string` defaulting to `"FolderIcon"`, `iconPickerOpen: boolean`
- **Trigger button**: renders selected icon as a 20px `@heroicons/react/20/solid` component
- **Popover content**:
  - Search `<Input>` at top, controlled, filters icons by readable label (strip `"Icon"` suffix, convert PascalCase to lowercase words, e.g. `"AcademicCapIcon"` → `"academic cap"`)
  - Scrollable grid (8 columns, max height ~300px) of all solid icons matching the search
  - Selected icon highlighted with `bg-primary/15` ring
  - Click selects icon and closes popover

## Shared `<CategoryIcon>` component

New file: `apps/web/src/components/help-center/category-icon.tsx`

```tsx
// Resolves a stored icon key to the matching @heroicons/react/20/solid component.
// Falls back to FolderIcon for null or unrecognised values.
```

Props: `icon: string | null`, `className?: string`

Implementation:

- `import * as SolidIcons from '@heroicons/react/20/solid'`
- `const Icon = (icon && SolidIcons[icon as keyof typeof SolidIcons]) || SolidIcons.FolderIcon`
- Renders `<Icon className={className} />`

## Render sites updated

All 8 sites replace inline emoji rendering with `<CategoryIcon>`:

| File                                                            | Change                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `components/help-center/help-center-category-grid.tsx`          | Replace `{cat.icon ?? '📁'}` with `<CategoryIcon icon={cat.icon} className="w-5 h-5 text-primary" />` |
| `components/admin/help-center/help-center-category-tree.tsx`    | Replace `{category.icon \|\| '📁'}`                                                                   |
| `components/admin/help-center/help-center-finder.tsx`           | Replace two `cat.icon` usages                                                                         |
| `components/admin/help-center/help-center-metadata-sidebar.tsx` | Replace `{cat.icon && <span>{cat.icon}</span>}`                                                       |
| `components/admin/help-center/help-center-article-editor.tsx`   | Replace two `currentCategory?.icon` / `cat.icon` usages                                               |
| `components/widget/widget-help.tsx`                             | Replace `{cat.icon && <div className="text-lg mb-1">{cat.icon}</div>}`                                |
| `routes/_portal/hc/categories/$categorySlug/index.tsx`          | Replace two emoji usages (category + subcategories)                                                   |
| `category-form-dialog.tsx` (parent select)                      | Replace `{cat.icon ?? '📁'}` in `<SelectItem>`                                                        |

The picker trigger button in `category-form-dialog.tsx` renders the icon directly (no `<CategoryIcon>` needed there).

## Icon name utilities

A small helper converts export key to search label:

```ts
// "AcademicCapIcon" → "academic cap"
function iconLabel(key: string): string {
  return key
    .replace(/Icon$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
}
```

Used both to populate picker labels and to filter on search input.

## Testing

No new tests required — existing `help-center-service.test.ts` tests use string values for `icon` and are unaffected by this change (column type unchanged). The `<CategoryIcon>` component has no logic worth unit testing beyond what TypeScript covers.
