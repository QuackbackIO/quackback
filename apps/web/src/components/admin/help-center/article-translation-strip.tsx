import type { SupportedLocale } from '@/lib/shared/i18n'
import {
  discardArticleTranslationUpdateFn,
  markArticleTranslationCurrentFn,
  publishArticleTranslationUpdateFn,
} from '@/lib/server/functions/help-center-article-languages'
import { checkProblemText } from './article-language-bar'
import type { ArticleLanguageEntry } from './article-languages'
import type { LanguageActions } from './article-language-actions'

/**
 * The note above a saved translation: a failed or waiting AI update, a
 * translation behind its article, or an AI draft to check.
 */
export function TranslationStrip({
  articleId,
  locale,
  own,
  entry,
  aiAvailable,
  actions,
  dirty,
  saveEdits,
  onShowChanges,
}: {
  articleId: string
  locale: SupportedLocale
  own: string
  entry: ArticleLanguageEntry
  aiAvailable: boolean
  actions: LanguageActions
  /** The form has edits that are not saved yet. */
  dirty: boolean
  /** Save the edits on screen; false when they do not pass the form's checks. */
  saveEdits: () => Promise<boolean>
  onShowChanges: () => void
}) {
  const pending = entry.pendingUpdate
  const failedUpdate = pending?.check && !pending.check.ok ? pending.check : null
  const failedDraft = !pending && entry.draftCheck && !entry.draftCheck.ok ? entry.draftCheck : null
  const busy = !!actions.busy

  const showChanges = <StripButton onClick={() => onShowChanges()}>Show changes</StripButton>
  const updateWithAi = aiAvailable ? (
    <StripButton disabled={busy} onClick={actions.askAi}>
      Update with AI
    </StripButton>
  ) : null
  const discard = (
    <StripButton
      disabled={busy}
      onClick={() =>
        actions.run(
          'discard',
          () => discardArticleTranslationUpdateFn({ data: { articleId, locale } }),
          'Could not discard the update'
        )
      }
    >
      Discard
    </StripButton>
  )
  // Saves the edits on screen first; the server also drops a waiting update.
  const markCurrent = (
    <StripButton
      disabled={busy}
      onClick={() =>
        actions.run(
          'mark-current',
          async () => {
            if (!(await saveEdits())) return
            await markArticleTranslationCurrentFn({ data: { articleId, locale } })
          },
          'Could not mark the translation as up to date'
        )
      }
    >
      Mark as up to date
    </StripButton>
  )

  if (pending && failedUpdate) {
    return (
      <Strip
        tone="warning"
        text={`The AI update needs a person: ${failedUpdate.problems.map(checkProblemText).join('; ')}.`}
      >
        {showChanges}
        {updateWithAi}
        {entry.needsUpdate ? markCurrent : null}
        {discard}
      </Strip>
    )
  }
  if (pending) {
    return (
      <Strip
        tone={pending.current ? 'info' : 'warning'}
        text={
          pending.current
            ? 'An AI update is ready. Readers see the current text until you publish it.'
            : `An AI update is ready, but the ${own} article changed again after it was made.`
        }
      >
        {showChanges}
        {pending.current ? null : updateWithAi}
        {/* Publishing the update replaces the text, edits on screen included. */}
        <StripButton
          disabled={busy || dirty}
          title={dirty ? 'Save your changes first' : undefined}
          onClick={() =>
            actions.run(
              'publish-update',
              () => publishArticleTranslationUpdateFn({ data: { articleId, locale } }),
              'Could not publish the update'
            )
          }
        >
          Publish update
        </StripButton>
        {discard}
      </Strip>
    )
  }
  if (entry.needsUpdate) {
    return (
      <Strip tone="warning" text={`The ${own} article changed after this translation was made.`}>
        {showChanges}
        {updateWithAi}
        {markCurrent}
      </Strip>
    )
  }
  if (failedDraft) {
    return (
      <Strip
        tone="warning"
        text={`Check this AI draft: ${failedDraft.problems.map(checkProblemText).join('; ')}.`}
      />
    )
  }
  return null
}

function Strip({
  tone,
  text,
  children,
}: {
  tone: 'warning' | 'info'
  text: string
  children?: React.ReactNode
}) {
  return (
    <div className="px-4 pt-4 sm:px-6">
      <div
        role="status"
        className={
          tone === 'warning'
            ? 'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground'
            : 'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground'
        }
      >
        <span className="min-w-0 flex-1">{text}</span>
        {children ? <span className="flex flex-wrap gap-3">{children}</span> : null}
      </div>
    </div>
  )
}

function StripButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="font-medium underline-offset-2 hover:underline disabled:opacity-60"
    >
      {children}
    </button>
  )
}
