import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrashIcon, XCircleIcon } from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
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
  useUpdateHelpCenterDomain,
  useVerifyHelpCenterDomain,
  useCreateHelpCenterRedirectRule,
  useDeleteHelpCenterRedirectRule,
  useEnableHelpCenterLocale,
  useDisableHelpCenterLocale,
  useUpdateHelpCenterLocaleChrome,
} from '@/lib/client/mutations/settings'
import { listArticlesFn } from '@/lib/server/functions/help-center'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/shared/i18n'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

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
}

interface DomainsLanguagesTabProps {
  config: HelpCenterConfig
}

export function DomainsLanguagesTab({ config }: DomainsLanguagesTabProps) {
  return (
    <div className="space-y-6">
      <DomainCard domain={config.domain} />
      <RedirectRulesCard />
      <IndexingCard indexable={config.seo.indexable} />
      <LocalesCard locales={config.locales} />
    </div>
  )
}

// ============================================================================
// Domain
// ============================================================================

function DomainCard({ domain }: { domain: HelpCenterConfig['domain'] }) {
  const [value, setValue] = useState(domain.domain ?? '')
  const updateDomain = useUpdateHelpCenterDomain()
  const verifyDomain = useVerifyHelpCenterDomain()
  const statusQuery = useQuery({
    ...settingsQueries.helpCenterDomainStatus(),
    enabled: !!domain.domain,
  })

  const dirty = value.trim() !== (domain.domain ?? '')
  const busy = updateDomain.isPending || verifyDomain.isPending

  return (
    <SettingsCard
      title="Custom domain"
      description="Serve the help center on your own subdomain instead of the default host"
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="hc-domain" className="text-sm font-medium">
            Domain
          </Label>
          <div className="flex gap-2">
            <Input
              id="hc-domain"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="help.acme.com"
              disabled={busy}
            />
            <Button
              variant="outline"
              disabled={!dirty || busy}
              onClick={() => updateDomain.mutate(value.trim() || null)}
            >
              Save
            </Button>
          </div>
          {updateDomain.isError && (
            <p className="text-xs text-destructive">
              {updateDomain.error instanceof Error
                ? updateDomain.error.message
                : 'Could not save the domain'}
            </p>
          )}
        </div>

        {domain.domain && (
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
            <div className="flex items-center gap-2">
              <VerifiedChip verifiedAt={domain.verifiedAt} />
              {statusQuery.data && !statusQuery.data.verified && (
                <span className="text-xs text-muted-foreground">
                  {!statusQuery.data.dnsResolved
                    ? 'DNS has not propagated yet'
                    : "the domain doesn't reach this instance yet"}
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => verifyDomain.mutate()}>
              <InlineSpinner visible={verifyDomain.isPending} />
              Verify
            </Button>
          </div>
        )}

        <div className="space-y-1.5 rounded-lg bg-muted/30 p-4 text-xs text-muted-foreground">
          <p>
            Point a CNAME for your domain at this instance. TLS terminates at your own reverse
            proxy (Caddy, nginx, Traefik) -- Quackback does not issue certificates.
          </p>
          <p>
            Article content stores absolute image URLs. Changing the domain does not rewrite
            existing article images, so keep the old host reachable or re-upload affected images.
          </p>
          <p>
            If you self-host branding fonts, keep doing so on the new domain too -- never link a
            Google Fonts stylesheet from the help center.
          </p>
          <p>
            Once verified, /hc pages on the default host redirect to this domain automatically.
          </p>
        </div>
      </div>
    </SettingsCard>
  )
}

function VerifiedChip({ verifiedAt }: { verifiedAt: string | null }) {
  if (verifiedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400">
        Verified
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      Not verified
    </span>
  )
}

// ============================================================================
// Redirect rules
// ============================================================================

function RedirectRulesCard() {
  const rulesQuery = useQuery(settingsQueries.helpCenterRedirectRules())
  const deleteRule = useDeleteHelpCenterRedirectRule()

  return (
    <SettingsCard
      title="Redirect rules"
      description="301 an old /hc path to a published article or category"
    >
      <div className="space-y-4">
        <CreateRedirectRuleForm />

        {rulesQuery.isLoading ? (
          <div className="flex justify-center py-2">
            <InlineSpinner visible />
          </div>
        ) : rulesQuery.data && rulesQuery.data.length > 0 ? (
          <ul className="space-y-2">
            {rulesQuery.data.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3"
              >
                <div className="min-w-0">
                  <code className="text-xs font-medium">{rule.path}</code>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    &rarr; {rule.targetType} {rule.targetLabel ? `"${rule.targetLabel}"` : '(unpublished)'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete redirect rule"
                  disabled={deleteRule.isPending}
                  onClick={() => deleteRule.mutate(rule.id)}
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No redirect rules yet.</p>
        )}
      </div>
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
    <div className="space-y-2 rounded-lg border border-border/50 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
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
            <SelectValue placeholder={`Choose ${targetType}...`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {createRule.isError && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <XCircleIcon className="h-3.5 w-3.5" />
          {createRule.error instanceof Error ? createRule.error.message : 'Could not create rule'}
        </p>
      )}
      <Button size="sm" disabled={!canSubmit || createRule.isPending} onClick={handleSubmit}>
        <InlineSpinner visible={createRule.isPending} />
        Add rule
      </Button>
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
    updateSeo.mutate({ indexable: next })
  }

  return (
    <SettingsCard title="Indexing" description="Control whether search engines can crawl /hc">
      <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
        <div>
          <Label htmlFor="hc-indexable" className="text-sm font-medium cursor-pointer">
            Allow search engines to index the help center
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Off adds a noindex tag to every /hc page and removes it from the sitemap and
            robots.txt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InlineSpinner visible={updateSeo.isPending} />
          <Switch
            id="hc-indexable"
            checked={checked}
            onCheckedChange={handleChange}
            disabled={updateSeo.isPending}
            aria-label="Allow search engines to index the help center"
          />
        </div>
      </div>
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
      description="Add a locale to translate articles and categories into it"
    >
      <div className="space-y-4">
        <ul className="space-y-2">
          <li className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <span className="text-sm font-medium">
              {LOCALE_LABELS[locales.default] ?? locales.default}
            </span>
            <span className="text-xs text-muted-foreground">Default</span>
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
                <SelectValue placeholder="Add a language..." />
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

  return (
    <li className="rounded-lg border border-border/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{LOCALE_LABELS[locale] ?? locale}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Close' : 'Edit chrome'}
          </Button>
          <Button variant="ghost" size="sm" disabled={disabling} onClick={onDisable}>
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <Input
            value={homepageTitle}
            onChange={(e) => setHomepageTitle(e.target.value)}
            placeholder="Homepage title"
          />
          <Input
            value={homepageDescription}
            onChange={(e) => setHomepageDescription(e.target.value)}
            placeholder="Homepage description"
          />
          <Input
            value={searchPlaceholder}
            onChange={(e) => setSearchPlaceholder(e.target.value)}
            placeholder="Search placeholder"
          />
          <Button
            size="sm"
            disabled={updateChrome.isPending || !homepageTitle.trim()}
            onClick={() =>
              updateChrome.mutate({
                locale: locale as SupportedLocale,
                chrome: { homepageTitle, homepageDescription, searchPlaceholder },
              })
            }
          >
            <InlineSpinner visible={updateChrome.isPending} />
            Save
          </Button>
        </div>
      )}
    </li>
  )
}
