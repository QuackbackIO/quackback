import { Link } from '@tanstack/react-router'
import type { TranslationCheckProblem } from '@/lib/server/db'
import { cn } from '@/lib/shared/utils'

/**
 * Each product language named in itself. The same names as the shared names
 * table (a test keeps them equal), kept here so the help center editor does
 * not turn that table into a chunk of its own that the settings pages load.
 */
export const EDITOR_LANGUAGE_NAMES: Record<string, string> = {
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

/** A language's name in itself, or its code when the product does not name it. */
export function languageName(locale: string): string {
  return EDITOR_LANGUAGE_NAMES[locale] ?? locale
}

/** What the language bar shows for one language. */
export type LanguageDotState = 'published' | 'needs_update' | 'draft' | 'missing'

export interface LanguageBarEntry {
  locale: string
  state: LanguageDotState
}

const DOT_LABEL: Record<LanguageDotState, string> = {
  published: 'Published',
  needs_update: 'Needs update',
  draft: 'Draft',
  missing: 'Not translated',
}

/** The status dot: green published, amber needs update, grey draft, hollow missing. */
export function LanguageDot({ state, className }: { state: LanguageDotState; className?: string }) {
  return (
    <span
      data-state={state}
      aria-hidden="true"
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        state === 'published' && 'bg-success',
        state === 'needs_update' && 'bg-warning',
        state === 'draft' && 'bg-muted-foreground/60',
        state === 'missing' && 'border border-muted-foreground/60 bg-transparent',
        className
      )}
    />
  )
}

/** The plain-language reason a check failed. */
export function checkProblemText(problem: TranslationCheckProblem): string {
  switch (problem.code) {
    case 'empty':
      return 'the translation is empty'
    case 'code_block_changed':
      return `code changed: ${problem.detail ?? ''}`
    case 'link_missing':
      return `a link is missing: ${problem.detail ?? ''}`
    case 'image_missing':
      return 'an image is missing'
    case 'embed_missing':
      return 'an embed is missing'
    case 'headings_changed':
      return `the headings changed (${problem.detail ?? ''})`
    case 'term_changed':
      return `"${problem.detail ?? ''}" was translated`
  }
}

/**
 * The languages above the article title: the article's own language first,
 * then the help center's other languages with their status dots.
 */
export function ArticleLanguageBar({
  ownLocale,
  isMain,
  entries,
  active,
  onSelect,
}: {
  ownLocale: string
  isMain: boolean
  entries: LanguageBarEntry[]
  active: string
  onSelect: (locale: string) => void
}) {
  const tab = (locale: string, selected: boolean) =>
    cn(
      'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
      selected
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
    )
  return (
    <div
      role="tablist"
      aria-label="Article languages"
      className="flex items-center gap-1 overflow-x-auto border-b border-border/50 px-4 py-2 sm:px-6"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === ownLocale}
        onClick={() => onSelect(ownLocale)}
        className={tab(ownLocale, active === ownLocale)}
      >
        {languageName(ownLocale)}
        <span className="text-xs text-muted-foreground">{isMain ? 'Main' : 'Original'}</span>
      </button>
      {entries.map((entry) => (
        <button
          key={entry.locale}
          type="button"
          role="tab"
          aria-selected={active === entry.locale}
          onClick={() => onSelect(entry.locale)}
          className={tab(entry.locale, active === entry.locale)}
          title={DOT_LABEL[entry.state]}
        >
          {languageName(entry.locale)}
          <LanguageDot state={entry.state} />
          <span className="sr-only">{DOT_LABEL[entry.state]}</span>
        </button>
      ))}
      <Link
        to="/admin/settings/help-center"
        search={{ tab: 'domains-languages' }}
        className="ms-1 shrink-0 text-xs text-muted-foreground hover:text-foreground"
      >
        + Add language in Settings
      </Link>
    </div>
  )
}
