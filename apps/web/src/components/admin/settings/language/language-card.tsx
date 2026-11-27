/**
 * The Language card on Settings > General: the language the team writes in,
 * and what visitors see. Changing the main language asks first, naming what
 * happens to the help center (articles relabelled, or swapped with their
 * versions in that language), with counts from the workspace.
 */
import { lazy, Suspense, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { VisibilityTiles } from '@/components/admin/settings/visibility-tiles'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AUTOSAVE } from '@/lib/client/autosave'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { updateLanguageSettingsFn } from '@/lib/server/functions/language-settings'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/shared/i18n'
import type { LanguageConfig, VisitorLanguage } from '@/lib/shared/types/settings'
import { useLanguageNames } from './use-language-name'

// The confirmation loads when a new main language is picked, not with the page.
const MainLanguageConfirm = lazy(() => import('./main-language-confirm'))

const DEFAULT_CONFIG: LanguageConfig = { mainLanguage: 'en', visitorLanguage: 'own' }

export function LanguageCard() {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { name, option } = useLanguageNames()
  const stored = useWorkspaceSettings()?.languageConfig ?? DEFAULT_CONFIG
  const [config, setConfig] = useState<LanguageConfig>(stored)
  const [pending, setPending] = useState<SupportedLocale | null>(null)

  const save = useMutation({
    meta: AUTOSAVE,
    mutationFn: (data: Partial<LanguageConfig>) =>
      updateLanguageSettingsFn({
        data: data as { mainLanguage?: SupportedLocale; visitorLanguage?: VisitorLanguage },
      }),
    onSuccess: (next) => {
      setConfig(next)
      // The root context carries the settings every page reads, and the help
      // center's settings follow the main language.
      void router.invalidate()
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  const main = config.mainLanguage
  const mainName = name(main)

  return (
    <SettingsCard
      title={intl.formatMessage({
        id: 'admin.settings.language.title',
        defaultMessage: 'Language',
      })}
    >
      <SettingRows>
        <SettingRow
          label={
            <FormattedMessage
              id="admin.settings.language.main.label"
              defaultMessage="Main language"
            />
          }
          description={
            <FormattedMessage
              id="admin.settings.language.main.description"
              defaultMessage="The language you write your articles, boards and messages in."
            />
          }
          htmlFor="main-language"
          control={
            <Select
              value={main}
              onValueChange={(next) => {
                if (next !== main) setPending(next as SupportedLocale)
              }}
              disabled={save.isPending}
            >
              <SelectTrigger id="main-language" className="w-56">
                <SelectValue>{option(main)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {option(locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingRows>

      <div className="space-y-3 border-t border-border/50 pt-3.5">
        <div>
          <p id="visitor-language" className="text-sm font-medium">
            <FormattedMessage
              id="admin.settings.language.visitors.label"
              defaultMessage="What visitors see"
            />
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <FormattedMessage
              id="admin.settings.language.visitors.description"
              defaultMessage="Menus, buttons and emails from Quackback."
            />
          </p>
        </div>
        <VisibilityTiles<VisitorLanguage>
          name="visitor-language"
          aria-labelledby="visitor-language"
          className="grid gap-2.5 sm:grid-cols-2"
          value={config.visitorLanguage}
          disabled={save.isPending}
          onChange={(visitorLanguage) => {
            const previous = config.visitorLanguage
            setConfig((c) => ({ ...c, visitorLanguage }))
            save.mutate(
              { visitorLanguage },
              { onError: () => setConfig((c) => ({ ...c, visitorLanguage: previous })) }
            )
          }}
          options={[
            {
              value: 'own',
              title: intl.formatMessage({
                id: 'admin.settings.language.visitors.own',
                defaultMessage: "Each visitor's own language",
              }),
              description: intl.formatMessage(
                {
                  id: 'admin.settings.language.visitors.ownDescription',
                  defaultMessage:
                    'Quackback follows their browser. Your articles and boards stay in {language} until you translate them.',
                },
                { language: mainName }
              ),
            },
            {
              value: 'main',
              title: intl.formatMessage(
                {
                  id: 'admin.settings.language.visitors.main',
                  defaultMessage: '{language} for everyone',
                },
                { language: mainName }
              ),
              description: intl.formatMessage(
                {
                  id: 'admin.settings.language.visitors.mainDescription',
                  defaultMessage:
                    'Every visitor sees {language}, whatever language their browser uses.',
                },
                { language: mainName }
              ),
            },
          ]}
        />
      </div>

      {pending && (
        <Suspense fallback={null}>
          <MainLanguageConfirm
            to={pending}
            onClose={() => setPending(null)}
            onConfirm={async (mainLanguage) => {
              await save.mutateAsync({ mainLanguage })
              setPending(null)
            }}
          />
        </Suspense>
      )}
    </SettingsCard>
  )
}
