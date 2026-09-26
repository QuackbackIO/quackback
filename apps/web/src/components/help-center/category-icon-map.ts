/**
 * Every icon the category icon picker offers, keyed by the name a category
 * stores. It is the whole 20px solid set, so only the picker loads it eagerly;
 * rendering a category goes through CategoryIcon (category-icon.tsx), which
 * loads this module only for an icon outside its common set.
 */
import type { ComponentType, SVGProps } from 'react'
import * as solidIcons from '@heroicons/react/20/solid'

export type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>

// Any name that can be stored on a category must resolve here. Only the icon
// components count, by the same test as the server's CATEGORY_ICON_NAMES.
export const ICON_MAP: Record<string, HeroIcon> = Object.fromEntries(
  Object.entries(solidIcons).filter(([name]) => /^[A-Z][A-Za-z0-9]*Icon$/.test(name))
)

export const ALL_ICON_KEYS = Object.keys(ICON_MAP)
