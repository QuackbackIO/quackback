import type { ComponentType } from 'react'
import { buildSettingsModuleRows, type SettingsModuleRowPage } from './settings-nav-sections'
import { SETTINGS_PAGE_ICONS } from './settings-page-icons'
import type { PermissionKey } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types'

export interface SettingsModulePage {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  /** The permission the page's route checks; the nav and module landing offer it only to holders. */
  permission: PermissionKey
}

export interface SettingsModule {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  pages: SettingsModulePage[]
}

/** A module page with its icon added. */
function withIcon(page: SettingsModuleRowPage): SettingsModulePage {
  return { ...page, icon: SETTINGS_PAGE_ICONS[page.to] }
}

/** Product modules shown under Settings, Modules. A module with several pages shows them as tabs. */
export function buildSettingsModules(flags?: Partial<FeatureFlags>): SettingsModule[] {
  return buildSettingsModuleRows(flags).map(({ id, label, to, pages }) => ({
    id,
    label,
    icon: SETTINGS_PAGE_ICONS[to],
    pages: pages.map(withIcon),
  }))
}

/**
 * The modules as a viewer with these permissions sees them: a page whose route
 * would answer Access denied is left out, and a module left with no pages goes
 * with it.
 */
export function settingsModulesFor(
  modules: SettingsModule[],
  permissions: ReadonlySet<PermissionKey>
): SettingsModule[] {
  return modules
    .map((module) => ({
      ...module,
      pages: module.pages.filter((page) => permissions.has(page.permission)),
    }))
    .filter((module) => module.pages.length > 0)
}

/** The page a module opens on: its first, or undefined when it has none. */
export function settingsModuleLandingPath(module: SettingsModule): string | undefined {
  return module.pages[0]?.to
}

/**
 * Where a module's hub URL goes: the first page of the module the viewer can
 * open, or the settings root when the module is off or has none for them.
 */
export function settingsModuleRedirectPath(
  id: string,
  flags: Partial<FeatureFlags> | undefined,
  permissions: ReadonlySet<PermissionKey>
): string {
  if (!isProductEnabled(flags, id as Parameters<typeof isProductEnabled>[1])) {
    return '/admin/settings'
  }
  const module = settingsModulesFor(buildSettingsModules(flags), permissions).find(
    (item) => item.id === id
  )
  return (module && settingsModuleLandingPath(module)) ?? '/admin/settings'
}
