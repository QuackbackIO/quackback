import { useState } from 'react'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useUpdateHelpCenterAutoTranslate } from '@/lib/client/mutations/settings'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'
import { LOCALE_NATIVE_NAMES } from '@/lib/shared/locale-names'
import type { SupportedLocale } from '@/lib/shared/i18n'

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

export interface GlossaryEntry {
  term: string
  translation: string
}

/** "Board = Board" lines into glossary entries; a line without "=" is skipped. */
export function parseFixedTranslations(text: string): GlossaryEntry[] {
  return text
    .split('\n')
    .map((line) => {
      const at = line.indexOf('=')
      if (at < 0) return null
      const term = line.slice(0, at).trim()
      const translation = line.slice(at + 1).trim()
      return term && translation ? { term, translation } : null
    })
    .filter((e): e is GlossaryEntry => e !== null)
}

/** The reason the fixed translations cannot be saved, or null when they can. */
export function fixedTranslationsError(entries: GlossaryEntry[]): string | null {
  if (entries.length > MAX_PROTECTED_TERMS) return `Use at most ${MAX_PROTECTED_TERMS} words.`
  if (
    entries.some((e) => e.term.length > MAX_TERM_LENGTH || e.translation.length > MAX_TERM_LENGTH)
  ) {
    return `Each word can be up to ${MAX_TERM_LENGTH} characters.`
  }
  return null
}

const formatFixed = (entries: GlossaryEntry[] = []) =>
  entries.map((e) => `${e.term} = ${e.translation}`).join('\n')

/**
 * "Translate automatically" and the glossary: words never translated, and
 * words translated one fixed way in each extra language.
 */
export function AutoTranslateCard({
  autoTranslate,
  locales,
}: {
  autoTranslate: HelpCenterConfig['autoTranslate']
  locales: HelpCenterConfig['locales']
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
      title="Translate automatically"
      description="When an article changes, AI updates its other languages for you to review."
    >
      <div className="space-y-4">
        <SettingRows>
          <SettingRow
            label="Translate automatically"
            htmlFor="hc-auto-translate"
            description="AI makes drafts and updates. Nothing goes live until you publish it."
            control={
              <Switch id="hc-auto-translate" checked={enabled} onCheckedChange={handleToggle} />
            }
          />
        </SettingRows>

        <div className="space-y-1.5">
          <Label htmlFor="hc-protected-terms">Never translate</Label>
          <p className="text-xs text-muted-foreground">
            One per line: product names and code terms.
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

        {locales.additional.map((locale) => (
          <FixedTranslationsField
            key={locale}
            locale={locale}
            entries={autoTranslate.fixedTranslations?.[locale] ?? []}
            onSave={(entries) =>
              updateAutoTranslate.mutate({
                fixedTranslations: { [locale as SupportedLocale]: entries },
              })
            }
          />
        ))}
      </div>
    </SettingsCard>
  )
}

function FixedTranslationsField({
  locale,
  entries,
  onSave,
}: {
  locale: string
  entries: GlossaryEntry[]
  onSave: (entries: GlossaryEntry[]) => void
}) {
  const [text, setText] = useState(formatFixed(entries))
  const [error, setError] = useState<string | null>(null)
  const id = `hc-fixed-translations-${locale}`
  const name = LOCALE_NATIVE_NAMES[locale as SupportedLocale] ?? locale

  function handleBlur() {
    const next = parseFixedTranslations(text)
    if (formatFixed(next) === formatFixed(entries)) {
      setError(null)
      return
    }
    const problem = fixedTranslationsError(next)
    setError(problem)
    if (!problem) onSave(next)
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Fixed translations in {name}</Label>
      <p className="text-xs text-muted-foreground">
        One per line, the word, then = and its translation.
      </p>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onBlur={handleBlur}
        rows={3}
        placeholder="Board = Board"
        aria-invalid={error ? true : undefined}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
