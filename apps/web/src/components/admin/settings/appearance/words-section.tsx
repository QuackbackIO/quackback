import { useState } from 'react'
import { Input } from '@/components/ui/input'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { LanguagePicker, languageName } from './language-picker'

type Update = (change: (draft: PortalDesign) => void) => void

/**
 * Brand › Words: the composer's prompt, its button and the empty feed's title
 * in the workspace's own words, per language.
 */
export function WordsSection({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <section id="design-section-words" className="scroll-mt-4 space-y-4">
      <h3 className="text-sm font-semibold">Words</h3>
      <OwnWording design={design} update={update} />
    </section>
  )
}

type CopyField = 'prompt' | 'submit' | 'emptyTitle'

const COPY_FIELDS: Array<{ field: CopyField; label: string; max: number }> = [
  { field: 'prompt', label: 'Composer prompt', max: 60 },
  { field: 'submit', label: 'Submit button', max: 24 },
  { field: 'emptyTitle', label: 'Empty feed title', max: 60 },
]

/** What the portal says in English, shown where no wording of its own is set. */
const ENGLISH_COPY: Record<CopyField, string> = {
  prompt: "What's on your mind?",
  submit: 'Submit',
  emptyTitle: 'Got something to say? Be the first to post',
}

/** The own wording, per language; a language left blank says the portal's translation. */
function OwnWording({ design, update }: { design: PortalDesign; update: Update }) {
  const [locale, setLocale] = useState<SupportedLocale>('en')
  const copy = design.pages.feedback.copy
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-medium">Own wording</p>
        <div className="ms-auto">
          <LanguagePicker value={locale} onChange={setLocale} label="Own wording language" />
        </div>
      </div>
      {COPY_FIELDS.map(({ field, label, max }) => (
        <div key={field} className="space-y-1.5">
          <label htmlFor={`design-copy-${field}`} className="text-[13px]">
            {label}
          </label>
          <Input
            id={`design-copy-${field}`}
            value={copy[field]?.[locale] ?? ''}
            maxLength={max}
            placeholder={
              locale === 'en' ? ENGLISH_COPY[field] : `The ${languageName(locale)} translation`
            }
            onChange={(event) =>
              update((draft) => {
                const byLocale = { ...draft.pages.feedback.copy[field] }
                if (event.target.value.trim()) byLocale[locale] = event.target.value
                else delete byLocale[locale]
                if (Object.keys(byLocale).length > 0) draft.pages.feedback.copy[field] = byLocale
                else delete draft.pages.feedback.copy[field]
              })
            }
          />
        </div>
      ))}
    </div>
  )
}
