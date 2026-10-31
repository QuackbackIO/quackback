import { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { DesignTiles } from './design-tiles'
import { LanguagePicker } from './language-picker'
import { PageTitlesDrawing } from './drawings'

type Update = (change: (draft: PortalDesign) => void) => void
type TitledPage = (typeof DESIGN_OPTIONS.titledPage)[number]

const PAGE_NAMES: Record<TitledPage, string> = {
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help Center',
  support: 'Support',
}

/**
 * The other pages' titles: on the band or plain, and each page's own words.
 * A page left unworded keeps its usual title.
 */
export function PageTitlesSection({
  design,
  update,
  gates,
}: {
  design: PortalDesign
  update: Update
  gates: PortalPageGates
}) {
  const pages = DESIGN_OPTIONS.titledPage.filter((page) => gates[page])
  const [page, setPage] = useState<TitledPage | undefined>(pages[0])
  const [locale, setLocale] = useState<SupportedLocale>('en')
  if (!page || !pages.includes(page)) return null
  const headline = design.pages.titles?.[page]
  return (
    <section id="design-section-titles" className="scroll-mt-4 space-y-3">
      <DesignTiles
        name="design-page-titles"
        label="Page titles"
        value={design.layout.pageTitles ?? 'plain'}
        columns={2}
        onChange={(place) => update((draft) => void (draft.layout.pageTitles = place))}
        options={DESIGN_OPTIONS.pageTitles.map((place) => ({
          value: place,
          label: place === 'band' ? 'On the band' : 'Plain',
          drawing: <PageTitlesDrawing place={place} />,
        }))}
      />
      {design.layout.pageTitles === 'band' && design.layout.band === 'none' && (
        <p className="text-xs text-muted-foreground">Titles go on the band once it has a style.</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Select value={page} onValueChange={(next) => setPage(next as TitledPage)}>
          <SelectTrigger className="w-40" aria-label="Page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pages.map((option) => (
              <SelectItem key={option} value={option}>
                {PAGE_NAMES[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LanguagePicker value={locale} onChange={setLocale} label="Title language" />
      </div>
      {(['title', 'subtitle'] as const).map((field) => (
        <div key={field} className="space-y-1.5">
          <label htmlFor={`design-page-${field}`} className="text-[13px] font-medium">
            {field === 'title' ? 'Title' : 'Subtitle'}
          </label>
          <Input
            id={`design-page-${field}`}
            value={headline?.[field][locale] ?? ''}
            maxLength={280}
            placeholder="Its usual words"
            onChange={(event) =>
              update((draft) => {
                const titles = (draft.pages.titles ??= {})
                const words = titles[page] ?? { title: {}, subtitle: {} }
                const text = event.target.value
                if (text) words[field][locale] = text
                else delete words[field][locale]
                if (Object.keys(words.title).length + Object.keys(words.subtitle).length) {
                  titles[page] = words
                } else delete titles[page]
                if (!Object.keys(titles).length) delete draft.pages.titles
              })
            }
          />
        </div>
      ))}
    </section>
  )
}
