import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import {
  getCategoryTranslationStatusesFn,
  listCategoryTranslationsFn,
  upsertCategoryTranslationFn,
  deleteCategoryTranslationFn,
} from '@/lib/server/functions/help-center-translations'
import { cn } from '@/lib/shared/utils'
import type { KbCategoryId } from '@quackback/ids'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { LanguageDot, languageName } from './article-language-bar'

/**
 * The collection's name and description in each other language of the help
 * center, one language at a time from a language bar. A collection has no
 * publish state per language: a name in a language is its version there.
 */
export function CategoryTranslationsSection({ categoryId }: { categoryId: KbCategoryId }) {
  const [locale, setLocale] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [translated, setTranslated] = useState(false)

  const statusesQuery = useQuery({
    queryKey: ['help-center', 'category-translation-statuses', categoryId],
    queryFn: () => getCategoryTranslationStatusesFn({ data: { categoryId } }),
  })
  // The help center's languages, less the one the collection's own name is in.
  const statuses = statusesQuery.data ?? []

  useEffect(() => {
    if (!locale && statuses.length > 0) setLocale(statuses[0].locale)
  }, [locale, statuses])

  useEffect(() => {
    if (!locale) return
    let cancelled = false
    async function load() {
      const translations = await listCategoryTranslationsFn({ data: { categoryId } })
      if (cancelled) return
      const existing = translations.find((t) => t.locale === locale)
      setName(existing?.name ?? '')
      setDescription(existing?.description ?? '')
      setTranslated(!!existing?.name?.trim())
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [categoryId, locale])

  if (statuses.length === 0) return null

  async function handleSave() {
    if (!locale) return
    setSaving(true)
    try {
      await upsertCategoryTranslationFn({
        data: {
          categoryId,
          locale: locale as SupportedLocale,
          name,
          description: description || undefined,
        },
      })
      setTranslated(!!name.trim())
      void statusesQuery.refetch()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!locale) return
    setSaving(true)
    try {
      await deleteCategoryTranslationFn({ data: { categoryId, locale: locale as SupportedLocale } })
      setName('')
      setDescription('')
      setTranslated(false)
      void statusesQuery.refetch()
    } finally {
      setSaving(false)
    }
  }

  const current = locale ? languageName(locale) : ''
  return (
    <div className="space-y-2 rounded-lg border border-border/50 p-3">
      <Label>Other languages</Label>
      <div role="tablist" aria-label="Collection languages" className="flex flex-wrap gap-1">
        {statuses.map((s) => (
          <button
            key={s.locale}
            type="button"
            role="tab"
            aria-selected={locale === s.locale}
            onClick={() => setLocale(s.locale)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm',
              locale === s.locale
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60'
            )}
          >
            {languageName(s.locale)}
            <LanguageDot state={s.status === 'translated' ? 'published' : 'missing'} />
          </button>
        ))}
      </div>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Name in ${current}`}
        aria-label={`Name in ${current}`}
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={`Description in ${current} (optional)`}
        aria-label={`Description in ${current}`}
      />
      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving || !translated}
          onClick={handleDelete}
        >
          Clear
        </Button>
        <Button type="button" size="sm" disabled={saving || !name.trim()} onClick={handleSave}>
          <InlineSpinner visible={saving} />
          Save {current} name
        </Button>
      </div>
    </div>
  )
}
