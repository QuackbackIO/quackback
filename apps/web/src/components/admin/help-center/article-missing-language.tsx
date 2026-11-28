import { FormattedMessage } from 'react-intl'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModalFooter } from '@/components/shared/modal-footer'
import {
  SidebarContainer,
  SidebarDivider,
  SidebarRow,
} from '@/components/shared/sidebar-primitives'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { LanguageDot, languageName } from './article-language-bar'
import { useLanguageActions } from './article-language-actions'
import type { ArticleTranslationPaneProps } from './article-translation-pane'

/** A language with no version yet: AI or the main-language text to start from. */
export function MissingLanguage({
  articleId,
  ownLocale,
  entry,
  aiAvailable,
  shared,
  header,
  onClose,
  onStart,
}: ArticleTranslationPaneProps & { onStart: () => void }) {
  const locale = entry.locale as SupportedLocale
  const { busy, error, notice, askAi } = useLanguageActions(articleId, locale)
  const language = languageName(locale)
  const own = languageName(ownLocale)
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {header}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col items-center px-6 py-16 text-center">
          <h3 className="text-base font-semibold">This article is not in {language} yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Readers who use {language} see the {own} article.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {aiAvailable ? (
              <Button type="button" variant="outline" disabled={!!busy} onClick={askAi}>
                {busy === 'ai' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Translate with AI
              </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={!!busy} onClick={onStart}>
              Start from the {own} text
            </Button>
          </div>
          {aiAvailable ? (
            <p className="mt-3 text-xs text-muted-foreground">
              AI makes a draft. Nothing goes live until you publish it.
            </p>
          ) : null}
          {entry.autoTranslatePaused ? <PausedNote /> : null}
          {notice ? <p className="mt-3 text-xs text-muted-foreground">{notice}</p> : null}
          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </div>
        <SidebarContainer className="overflow-y-auto">
          <SidebarRow label="Status">
            <span className="flex items-center gap-2 text-sm">
              <LanguageDot state="missing" />
              Not translated
            </span>
          </SidebarRow>
          <SharedRows shared={shared} />
          <SidebarDivider />
          <SidebarRow label="Readers see">
            <span className="text-sm">The {own} article</span>
          </SidebarRow>
        </SidebarContainer>
      </div>
      <ModalFooter
        onCancel={onClose}
        submitLabel="Save changes"
        submitDisabled
        submitType="button"
      />
    </div>
  )
}

export function PausedNote() {
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      <FormattedMessage
        id="admin.helpCenter.autoTranslatePaused"
        defaultMessage="Paused: AI usage for this period is used up. Upgrade your plan for more."
      />
    </p>
  )
}

export function SharedRows({ shared }: { shared: ArticleTranslationPaneProps['shared'] }) {
  return (
    <>
      <SidebarDivider />
      <SidebarRow label="Category">
        <span className="ms-4 min-w-0 truncate text-sm">{shared.categoryName ?? 'General'}</span>
      </SidebarRow>
      {shared.authorName ? (
        <>
          <SidebarDivider />
          <SidebarRow label="Author">
            <span className="text-sm">{shared.authorName}</span>
          </SidebarRow>
        </>
      ) : null}
      <SidebarDivider />
      <SidebarRow label="Audience">
        <span className="text-sm">{shared.audience}</span>
      </SidebarRow>
    </>
  )
}
