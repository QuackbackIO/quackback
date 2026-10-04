import {
  AREAS,
  requireAreaPermission,
  areaValues,
  assertWorkspaceNameWritable,
} from './settings-proposals.areas'
export { getSettingsForActor } from './settings-proposals.areas'
import {
  JSON_COLUMNS,
  SCALAR_COLUMNS,
  equal,
  at,
  put,
  leaves,
  columnValue,
  settingsStorageEffects,
  type SettingsApplyReceipt,
  type SettingsStorageColumn,
} from './settings-proposals.storage'
export type { SettingsApplyReceipt } from './settings-proposals.storage'
import type { BrandingConfig } from '@/lib/server/domains/settings/settings.types'
import { assertNotManaged } from '@/lib/server/config-file/managed-guard'
import { officeHoursScheduleSchema } from '@/lib/shared/office-hours'
import { db, eq, settings, type Database, type Transaction } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  settingsChangeInputSchema,
  settingsPatchSchemas,
  settingsProposalSchema,
  selectSettingsChanges,
  type MessengerEffect,
  type SettingsArea,
  type SettingsChange,
  type SettingsChangeInput,
  type SettingsProposal,
} from '@/lib/shared/assistant/settings-proposals'
import {
  saveLogoKey,
  updateBrandingConfig,
  updateWorkspaceName,
} from '@/lib/server/domains/settings/settings.media'
import { updateFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import { updateWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import { updateOfficeHoursSchedule } from '@/lib/server/domains/settings/settings.office-hours'
import { updateChangelogSettings } from '@/lib/server/domains/settings/settings.changelog'
import {
  deepMerge,
  parseJsonOrNull,
  parseWidgetConfig,
  requireSettings,
  type SettingsRecord,
} from '@/lib/server/domains/settings/settings.helpers'
import { resolveFeatureFlags } from '@/lib/server/domains/settings/settings.types'
import { getS3Object, getPublicUrlOrNull } from '@/lib/server/storage/s3'

export type { SettingsChangeInput, SettingsProposal }
export async function prepareSettingsChanges(
  actor: Actor,
  inputs: SettingsChangeInput[],
  executor: Database | Transaction = db
): Promise<SettingsProposal> {
  if (inputs.length === 0 || inputs.length > 20)
    throw new ValidationError('INVALID_SETTINGS_PROPOSAL', 'Choose at least one change.')
  const row = await requireSettings(executor)
  const changes = new Map<string, SettingsChange>()
  for (const input of inputs) {
    const { area, patch } = settingsChangeInputSchema.parse(input)
    await requireAreaPermission(actor, area, executor)
    if (area === 'portal') assertWorkspaceNameWritable(row)
    const before = areaValues(row, area)
    for (const entry of leaves(patch)) {
      const previous = at(before, entry.path) ?? null
      const id = `${area}.${entry.path.join('.')}`
      if (equal(previous, entry.value)) {
        changes.delete(id)
        continue
      }
      changes.set(id, {
        id,
        area,
        path: entry.path,
        before: previous,
        after: entry.value,
        settingsHref: AREAS[area].href,
        ...(id === MESSENGER_SWITCH
          ? { effects: messengerEffects(row, entry.value === true) }
          : {}),
      })
    }
  }
  if (changes.size === 0)
    throw new ValidationError('SETTINGS_ALREADY_MATCH', 'These settings already match.')
  return settingsProposalSchema.parse({
    kind: 'settings',
    version: 1,
    changes: [...changes.values()],
  })
}

const MESSENGER_SWITCH = 'messenger.enabled'

/**
 * Messenger is live when Support is on, the widget is on and its Messages tab
 * is shown. Turning it off flips only the Messages tab, as the Messenger
 * page's own switch does; turning it on also turns on what it needs.
 */
function messengerEffects(row: SettingsRecord, enabled: boolean): MessengerEffect[] {
  if (!enabled) return ['messengerTab']
  const effects: MessengerEffect[] = ['messengerTab']
  if (!parseWidgetConfig(row.widgetConfig).enabled) effects.push('widget')
  if (!resolveFeatureFlags(row.featureFlags).supportInbox) effects.push('supportInbox')
  return effects
}

async function writeArea(
  tx: Transaction,
  area: SettingsArea,
  patch: Record<string, unknown>,
  effects: ReadonlySet<MessengerEffect>
) {
  const options = { executor: tx }
  switch (area) {
    case 'branding': {
      const { logoKey, ...configPatch } = patch
      // Only the patch is validated: the stored config keeps whatever the
      // branding page saved, including values the model may not propose.
      if (Object.keys(configPatch).length > 0) {
        const row = await requireSettings(tx)
        await updateBrandingConfig(
          deepMerge(
            parseJsonOrNull<BrandingConfig>(row.brandingConfig) ?? {},
            settingsPatchSchemas.branding.parse(configPatch) as BrandingConfig
          ),
          options
        )
      }
      if (logoKey !== undefined) {
        await verifyRehostedLogoKey(logoKey)
        await saveLogoKey(logoKey as string, options)
      }
      break
    }
    case 'portal': {
      const data = settingsPatchSchemas.portal.parse(patch)
      if (data.displayName !== undefined) await updateWorkspaceName(data.displayName, options)
      break
    }
    case 'messenger': {
      const { enabled, welcomeMessage } = settingsPatchSchemas.messenger.parse(patch)
      if (enabled === true && effects.has('supportInbox'))
        await updateFeatureFlags({ supportInbox: true }, options)
      await updateWidgetConfig(
        {
          ...(enabled !== undefined ? { tabs: { messenger: enabled } } : {}),
          ...(enabled === true && effects.has('widget') ? { enabled: true } : {}),
          ...(welcomeMessage !== undefined ? { messenger: { welcomeMessage } } : {}),
        },
        options
      )
      break
    }
    case 'modules':
      await updateFeatureFlags(settingsPatchSchemas.modules.parse(patch), options)
      break
    case 'office_hours':
      await updateOfficeHoursSchedule(
        officeHoursScheduleSchema.parse({
          ...areaValues(await requireSettings(tx), area),
          ...settingsPatchSchemas.office_hours.parse(patch),
        }),
        options
      )
      break
    case 'changelog':
      await updateChangelogSettings(settingsPatchSchemas.changelog.parse(patch), options)
      break
  }
}
export async function applySettingsChangesInTransaction(
  tx: Transaction,
  actor: Actor,
  input: SettingsProposal,
  selectedChangeIds: string[]
): Promise<SettingsApplyReceipt> {
  const proposal = settingsProposalSchema.parse(input)
  const selected = selectSettingsChanges(proposal, selectedChangeIds)
  const [before] = await tx.select().from(settings).limit(1).for('update')
  if (!before) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  const patches = new Map<SettingsArea, Record<string, unknown>>()
  for (const change of selected) {
    await requireAreaPermission(
      actor,
      change.area,
      tx,
      change.area === 'branding' && change.path[0] === 'logoKey'
        ? PERMISSIONS.SETTINGS_MANAGE
        : AREAS[change.area].permission
    )
    if (change.area === 'portal') assertWorkspaceNameWritable(before)
    if (
      !equal(at(areaValues(before, change.area), change.path) ?? null, change.before) ||
      (change.id === MESSENGER_SWITCH &&
        !equal(messengerEffects(before, change.after === true), change.effects ?? null))
    )
      throw new ValidationError('SETTINGS_CHANGED', 'These settings changed. Ask Copilot again.')
    const patch = patches.get(change.area) ?? {}
    put(patch, change.path, change.after)
    patches.set(change.area, patch)
  }
  if (patches.get('modules')?.supportInbox === false && patches.get('messenger')?.enabled === true)
    throw new ValidationError(
      'INVALID_SETTINGS_PROPOSAL',
      'Choose matching Messenger and Support settings.'
    )
  const effects = new Set(selected.flatMap((change) => change.effects ?? []))
  // Validate every selected area before the first write.
  for (const [area, patch] of patches) {
    if (area === 'branding' && 'logoKey' in patch) {
      const { logoKey, ...configPatch } = patch
      await verifyRehostedLogoKey(logoKey)
      settingsPatchSchemas.branding.parse(configPatch)
    } else if (area === 'office_hours')
      officeHoursScheduleSchema.parse({
        ...areaValues(before, area),
        ...settingsPatchSchemas.office_hours.parse(patch),
      })
    else settingsPatchSchemas[area].parse(patch)
  }
  for (const [area, patch] of patches) await writeArea(tx, area, patch, effects)
  const after = await requireSettings(tx)
  return {
    kind: 'settings',
    version: 1,
    changes: selected,
    storageEffects: settingsStorageEffects(before, after),
    appliedAt: new Date().toISOString(),
  }
}
export async function undoSettingsChangesInTransaction(
  tx: Transaction,
  actor: Actor,
  receipt: SettingsApplyReceipt
): Promise<void> {
  if (receipt.kind !== 'settings' || receipt.version !== 1 || receipt.storageEffects.length === 0)
    throw new ValidationError('INVALID_SETTINGS_UNDO', 'This change cannot be undone.')
  for (const change of receipt.changes)
    await requireAreaPermission(
      actor,
      change.area,
      tx,
      change.area === 'branding' && change.path[0] === 'logoKey'
        ? PERMISSIONS.SETTINGS_MANAGE
        : AREAS[change.area].permission
    )
  const [row] = await tx.select().from(settings).limit(1).for('update')
  if (!row) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  if (receipt.storageEffects.some((effect) => effect.column === 'name'))
    assertWorkspaceNameWritable(row)
  const values = new Map<SettingsStorageColumn, unknown>()
  for (const effect of receipt.storageEffects) {
    if (![...JSON_COLUMNS, ...SCALAR_COLUMNS].includes(effect.column))
      throw new ValidationError('INVALID_SETTINGS_UNDO', 'This change cannot be undone.')
    const current = columnValue(row, effect.column)
    const value = effect.path.length === 0 ? current : at(current, effect.path)
    if (
      !equal(value ?? null, effect.after) ||
      (effect.path.length > 0 && (value !== undefined) !== effect.afterPresent)
    )
      throw new ValidationError(
        'SETTINGS_UNDO_CONFLICT',
        'These settings changed since Apply. Undo is unavailable.'
      )
    if (!values.has(effect.column)) values.set(effect.column, structuredClone(current))
  }
  for (const effect of receipt.storageEffects) {
    if (effect.path.length === 0) values.set(effect.column, effect.before)
    else
      put(
        values.get(effect.column) as Record<string, unknown>,
        effect.path,
        effect.before,
        effect.beforePresent
      )
  }
  if (values.has('name')) await assertNotManaged('workspace.name')
  if (values.has('brandingConfig')) {
    const restored = (values.get('brandingConfig') ?? {}) as BrandingConfig
    if (restored.light !== undefined || restored.dark !== undefined) {
      const { assertTierFeature } = await import('@/lib/server/domains/settings/tier-enforce')
      await assertTierFeature('customColors', 'Custom colours')
    }
  }
  const patch: Partial<typeof settings.$inferInsert> = {}
  for (const [column, value] of values)
    Object.assign(patch, {
      [column]: (JSON_COLUMNS as readonly string[]).includes(column)
        ? value === null
          ? null
          : JSON.stringify(value)
        : value,
    })
  await tx.update(settings).set(patch).where(eq(settings.id, row.id))
}

export { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'

async function verifyRehostedLogoKey(key: unknown): Promise<void> {
  if (
    typeof key !== 'string' ||
    !/^logos\/[a-zA-Z0-9_./-]+$/.test(key) ||
    key.includes('..') ||
    key.length > 512
  )
    throw new ValidationError('INVALID_BRANDING_LOGO', 'Choose a workspace logo in settings.')
  const stored = await getS3Object(key, 'bytes=0-0')
  await stored.body.cancel()
  if (!/^image\/(?:png|jpeg|webp|gif|avif|x-icon|svg\+xml)$/i.test(stored.contentType))
    throw new ValidationError('INVALID_BRANDING_LOGO', 'Choose an image for the workspace logo.')
}

/** Only the server website fetcher prepares rehosted logos; model patches omit keys. */
export async function prepareRehostedBrandingLogoChange(
  actor: Actor,
  key: string,
  executor: Database | Transaction = db
): Promise<SettingsProposal> {
  await requireAreaPermission(actor, 'branding', executor, PERMISSIONS.SETTINGS_MANAGE)
  await verifyRehostedLogoKey(key)
  const row = await requireSettings(executor)
  if (row.logoKey === key)
    throw new ValidationError('SETTINGS_ALREADY_MATCH', 'These settings already match.')
  return settingsProposalSchema.parse({
    kind: 'settings',
    version: 1,
    changes: [
      {
        id: 'branding.logoKey',
        area: 'branding',
        path: ['logoKey'],
        before: row.logoKey,
        after: key,
        beforePreview: getPublicUrlOrNull(row.logoKey),
        afterPreview: getPublicUrlOrNull(key),
        settingsHref: AREAS.branding.href,
      },
    ],
  })
}
