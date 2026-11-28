/**
 * Server functions for the workspace's languages: the main language the team
 * writes in, and what language visitors see.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'

export const updateLanguageSettingsSchema = z
  .object({
    mainLanguage: z.enum(SUPPORTED_LOCALES).optional(),
    visitorLanguage: z.enum(['own', 'main']).optional(),
  })
  .refine((v) => v.mainLanguage !== undefined || v.visitorLanguage !== undefined, {
    message: 'Nothing to change',
  })

export const getLanguageSettingsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  const { getLanguageConfig } = await import('@/lib/server/domains/settings/settings.service')
  return getLanguageConfig('fresh')
})

export const updateLanguageSettingsFn = createServerFn({ method: 'POST' })
  .validator(updateLanguageSettingsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { updateLanguageConfig } = await import('@/lib/server/domains/settings/settings.service')
    return updateLanguageConfig(data)
  })

/**
 * What changing the main language to `mainLanguage` would do to the help
 * center, for the confirmation before the change.
 */
export const previewMainLanguageChangeFn = createServerFn({ method: 'GET' })
  .validator(z.object({ mainLanguage: z.enum(SUPPORTED_LOCALES) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const [{ getLanguageConfig, getHelpCenterConfig }, { previewHelpCenterMainLanguage }, { db }] =
      await Promise.all([
        import('@/lib/server/domains/settings/settings.service'),
        import('@/lib/server/domains/help-center/help-center-main-language.service'),
        import('@/lib/server/db'),
      ])
    const [{ mainLanguage: from }, { locales }] = await Promise.all([
      getLanguageConfig('fresh'),
      getHelpCenterConfig('fresh'),
    ])
    return previewHelpCenterMainLanguage(db, {
      from,
      to: data.mainLanguage,
      toIsExtraLanguage: locales.additional.includes(data.mainLanguage),
    })
  })
