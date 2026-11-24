import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrashIcon, XCircleIcon } from '@heroicons/react/24/solid'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { settingsQueries } from '@/lib/client/queries/settings'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import {
  useUpdateHelpCenterSeo,
  useCreateHelpCenterRedirectRule,
  useDeleteHelpCenterRedirectRule,
  useEnableHelpCenterLocale,
  useDisableHelpCenterLocale,
  useUpdateHelpCenterLocaleChrome,
  useUpdateHelpCenterAutoTranslate,
} from '@/lib/client/mutations/settings'
import { Textarea } from '@/components/ui/textarea'
import { listArticlesFn } from '@/lib/server/functions/help-center'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/shared/i18n'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'
import { SectionDomainSettingsCard } from '@/components/admin/settings/section-domain-card'

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  ru: 'Русский',
  'pt-br': 'Português (Brasil)',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  nl: 'Nederlands',
  pl: 'Polski',
  th: 'ภาษาไทย',
  uk: 'Українська',
}

const MAX_PROTECTED_TERMS = 100
const MAX_TERM_LENGTH = 100

export function parseProtectedTerms(text: string): string[] {
  return text
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
}

/** The reason the terms cannot be saved, or null when they can. */
export function protectedTermsError(terms: string[]): string | null {
  if (terms.length > MAX_PROTECTED_TERMS) return `Use at most ${MAX_PROTECTED_TERMS} terms.`
  if (terms.some((t) => t.length > MAX_TERM_LENGTH)) {
    return `Each term can be up to ${MAX_TERM_LENGTH} characters.`
  }
  return null
}

interface LocaleChromeValues {
  homepageTitle: string
  homepageDescription: string
  searchPlaceholder: string
}

/** The reason the texts cannot be saved, or null when they can. */
export function localeChromeError(values: LocaleChromeValues): string | null {
  if (!values.homepageTitle.trim()) return 'Add a homepage title.'
  if (values.homepageTitle.length > 200) return 'The homepage title can be up to 200 characters.'
  if (values.homepageDescription.length > 500) {
    return 'The homepage description can be up to 500 characters.'
  }
  if (values.searchPlaceholder.length > 200) {
    return 'The search placeholder can be up to 200 characters.'
  }
  return null
}

interface DomainsLanguagesTabProps {
  config: HelpCenterConfig
}

export function DomainsLanguagesTab({ config }: DomainsLanguagesTabProps) {
  return (
    <div className="space-y-6">
      <SectionDomainSettingsCard section="help" />
      <RedirectRulesCard />
      <IndexingCard indexable={config.seo.indexable} />
      <LocalesCard locales={config.locales} />
      <AutoTranslateCard autoTranslate={config.autoTranslate} />
    </div>
  )
}

// ============================================================================
// Redirect rules
// ============================================================================

function RedirectRulesCard() {
  const rulesQuery = useQuery(settingsQueries.helpCenterRedirectRules())
  const deleteRule = useDeleteHelpCenterRedirectRule()
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null)

  return (
    <SettingsCard
      title="Redirect rules"
      description="Redirect an old /hc path to a published article or category."
    >
      <div className="space-y-3">
        {rulesQuery.isLoading ? (
          <div className="flex justify-center py-2">
            <InlineSpinner visible />
          </div>
        ) : rulesQuery.data && rulesQuery.data.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {rulesQuery.data.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <code className="text-xs font-medium">{rule.path}</code>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    &rarr; {rule.targetType}{' '}
                    {rule.targetLabel ? `"${rule.targetLabel}"` : '(unpublished)'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete redirect rule"
                  disabled={deleteRule.isPending}
                  onClick={() => setDeletingRuleId(rule.id)}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">No redirect rules yet.</p>
        )}
        <CreateRedirectRuleForm />
      </div>
      <ConfirmDialog
        open={deletingRuleId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingRuleId(null)
        }}
        variant="destructive"
        title="Delete redirect rule?"
        description="Visitors to the old path will get a not found page instead of being redirected."
        confirmLabel="Delete redirect rule"
        onConfirm={() => {
          if (deletingRuleId) deleteRule.mutate(deletingRuleId)
        }}
      />
    </SettingsCard>
  )
}

function CreateRedirectRuleForm() {
  const [path, setPath] = useState('')
  const [targetType, setTargetType] = useState<'article' | 'category'>('article')
  const [targetId, setTargetId] = useState('')
  const createRule = useCreateHelpCenterRedirectRule()

  const categoriesQuery = useQuery({
    ...helpCenterQueries.categories(),
    enabled: targetType === 'category',
  })
  const articlesQuery = useQuery({
    queryKey: ['help-center', 'redirect-target-articles'],
    queryFn: () => listArticlesFn({ data: { status: 'published', limit: 100 } }),
    enabled: targetType === 'article',
  })

  const options =
    targetType === 'article'
      ? (articlesQuery.data?.items ?? []).map((a) => ({ id: a.id, label: a.title }))
      : (categoriesQuery.data ?? [])
          .filter((c) => c.isPublic)
          .map((c) => ({ id: c.id, label: c.name }))

  const canSubmit = path.trim().startsWith('/') && !!targetId

  function handleSubmit() {
    createRule.mutate(
      { path: path.trim(), targetType, targetId },
      {
        onSuccess: () => {
          setPath('')
          setTargetId('')
        },
      }
    )
  }

  return (
    <div className="space-y-2 border-t border-border/50 pt-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/old-slug"
          aria-label="Redirect path"
        />
        <Select
          value={targetType}
          onValueChange={(v) => {
            setTargetType(v as 'article' | 'category')
            setTargetId('')
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="article">Article</SelectItem>
            <SelectItem value="category">Category</SelectItem>
          </SelectContent>
        </Select>
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger>
            <SelectValue placeholder={`Choose ${targetType}…`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={!canSubmit || createRule.isPending}
          onClick={handleSubmit}
        >
          <InlineSpinner visible={createRule.isPending} />
          Add rule
        </Button>
      </div>
      {createRule.isError && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <XCircleIcon className="h-3.5 w-3.5" />
          {createRule.error instanceof Error ? createRule.error.message : 'Could not create rule'}
        </p>
      )}
    </div>
  )
}

// ============================================================================
// Indexing
// ============================================================================

function IndexingCard({ indexable }: { indexable: boolean }) {
  const updateSeo = useUpdateHelpCenterSeo()
  const [checked, setChecked] = useState(indexable)

  function handleChange(next: boolean) {
    setChecked(next)
    updateSeo.mutate({ indexable: next }, { onError: () => setChecked(!next) })
  }

  return (
    <SettingsCard title="Indexing" description="Control whether search engines can crawl /hc.">
      <SettingRows>
        <SettingRow
          label="Allow search engines to index the help center"
          htmlFor="hc-indexable"
          description="Off adds a noindex tag to every /hc page and removes it from the sitemap and robots.txt"
          control={<Switch id="hc-indexable" checked={checked} onCheckedChange={handleChange} />}
        />
      </SettingRows>
    </SettingsCard>
  )
}

// ============================================================================
// Locales
// ============================================================================

function LocalesCard({ locales }: { locales: HelpCenterConfig['locales'] }) {
  const enableLocale = useEnableHelpCenterLocale()
  const disableLocale = useDisableHelpCenterLocale()
  const candidates = SUPPORTED_LOCALES.filter(
    (l) => l !== locales.default && !locales.additional.includes(l)
  )
  const [pendingLocale, setPendingLocale] = useState<SupportedLocale | ''>('')

  return (
    <SettingsCard
      title="Languages"
      description="Add a locale to translate articles and categories into it."
    >
      <div className="space-y-4">
        <ul className="divide-y divide-border/50">
          <li className="flex items-center justify-between py-3">
            <span className="text-sm font-medium">
              {LOCALE_LABELS[locales.default] ?? locales.default}
            </span>
            <span className="text-[13px] text-muted-foreground">Default</span>
          </li>
          {locales.additional.map((locale) => (
            <LocaleRow
              key={locale}
              locale={locale}
              chrome={locales.chrome[locale]}
              onDisable={() => disableLocale.mutate(locale as SupportedLocale)}
              disabling={disableLocale.isPending}
            />
          ))}
        </ul>

        {candidates.length > 0 && (
          <div className="flex items-center gap-2">
            <Select
              value={pendingLocale}
              onValueChange={(v) => setPendingLocale(v as SupportedLocale)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Add a language…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LOCALE_LABELS[l] ?? l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!pendingLocale || enableLocale.isPending}
              onClick={() => {
                if (!pendingLocale) return
                enableLocale.mutate(
                  {
                    locale: pendingLocale,
                    chrome: {
                      homepageTitle: 'How can we help?',
                      homepageDescription: '',
                      searchPlaceholder: '',
                    },
                  },
                  { onSuccess: () => setPendingLocale('') }
                )
              }}
            >
              <InlineSpinner visible={enableLocale.isPending} />
              Add
            </Button>
          </div>
        )}
        {enableLocale.isError && (
          <p className="text-xs text-destructive">
            {enableLocale.error instanceof Error
              ? enableLocale.error.message
              : 'Could not enable that locale'}
          </p>
        )}
      </div>
    </SettingsCard>
  )
}

function LocaleRow({
  locale,
  chrome,
  onDisable,
  disabling,
}: {
  locale: string
  chrome: HelpCenterConfig['locales']['chrome'][string] | undefined
  onDisable: () => void
  disabling: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [homepageTitle, setHomepageTitle] = useState(chrome?.homepageTitle ?? '')
  const [homepageDescription, setHomepageDescription] = useState(chrome?.homepageDescription ?? '')
  const [searchPlaceholder, setSearchPlaceholder] = useState(chrome?.searchPlaceholder ?? '')
  const updateChrome = useUpdateHelpCenterLocaleChrome()
  const [invalid, setInvalid] = useState<string | null>(null)

  function save() {
    const next = { homepageTitle, homepageDescription, searchPlaceholder }
    const saved = {
      homepageTitle: chrome?.homepageTitle ?? '',
      homepageDescription: chrome?.homepageDescription ?? '',
      searchPlaceholder: chrome?.searchPlaceholder ?? '',
    }
    if (
      next.homepageTitle === saved.homepageTitle &&
      next.homepageDescription === saved.homepageDescription &&
      next.searchPlaceholder === saved.searchPlaceholder
    ) {
      setInvalid(null)
      return
    }
    const error = localeChromeError(next)
    setInvalid(error)
    if (error) return
    updateChrome.mutate({ locale: locale as SupportedLocale, chrome: next })
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{LOCALE_LABELS[locale] ?? locale}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Close' : 'Edit texts'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${LOCALE_LABELS[locale] ?? locale}`}
            disabled={disabling}
            onClick={onDisable}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <Input
            value={homepageTitle}
            onChange={(e) => setHomepageTitle(e.target.value)}
            onBlur={save}
            placeholder="Homepage title"
            aria-label="Homepage title"
          />
          <Input
            value={homepageDescription}
            onChange={(e) => setHomepageDescription(e.target.value)}
            onBlur={save}
            placeholder="Homepage description"
            aria-label="Homepage description"
          />
          <Input
            value={searchPlaceholder}
            onChange={(e) => setSearchPlaceholder(e.target.value)}
            onBlur={save}
            placeholder="Search placeholder"
            aria-label="Search placeholder"
          />
          {invalid && (
            <p role="alert" className="text-xs text-destructive">
              {invalid}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

// ============================================================================
// Auto-translate (domains/languages §H3)
// ============================================================================

function AutoTranslateCard({
  autoTranslate,
}: {
  autoTranslate: HelpCenterConfig['autoTranslate']
}) {
  const updateAutoTranslate = useUpdateHelpCenterAutoTranslate()
  const [enabled, setEnabled] = useState(autoTranslate.enabled)
  const [protectedTermsText, setProtectedTermsText] = useState(
    autoTranslate.protectedTerms.join('\n')
  )
  const [termsError, setTermsError] = useState<string | null>(null)

  function handleToggle(next: boolean) {
    setEnabled(next)
    updateAutoTranslate.mutate({ enabled: next }, { onError: () => setEnabled(!next) })
  }

  function handleSaveTerms() {
    const terms = parseProtectedTerms(protectedTermsText)
    if (terms.join('\n') === autoTranslate.protectedTerms.join('\n')) {
      setTermsError(null)
      return
    }
    const error = protectedTermsError(terms)
    setTermsError(error)
    if (error) return
    updateAutoTranslate.mutate({ protectedTerms: terms })
  }

  return (
    <SettingsCard
      title="Auto-translate"
      description="Queue an AI translation draft for each enabled language when you publish an article."
    >
      <div className="space-y-4">
        <SettingRows>
          <SettingRow
            label="Auto-translate on publish"
            htmlFor="hc-auto-translate"
            description="Writes a draft translation per enabled language, never auto-published"
            control={
              <Switch id="hc-auto-translate" checked={enabled} onCheckedChange={handleToggle} />
            }
          />
        </SettingRows>

        <div className="space-y-1.5">
          <Label htmlFor="hc-protected-terms">Protected terms</Label>
          <p className="text-xs text-muted-foreground">
            One per line. Never translated (product name, technical terms).
          </p>
          <Textarea
            id="hc-protected-terms"
            value={protectedTermsText}
            onChange={(e) => {
              setProtectedTermsText(e.target.value)
              setTermsError(null)
            }}
            onBlur={handleSaveTerms}
            rows={4}
            placeholder="Quackback&#10;API&#10;webhook"
            aria-invalid={termsError ? true : undefined}
          />
          {termsError && (
            <p role="alert" className="text-xs text-destructive">
              {termsError}
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}
