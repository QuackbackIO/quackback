import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { Loader2 } from 'lucide-react'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { ModalFooter } from '@/components/shared/modal-footer'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  SidebarContainer,
  SidebarDivider,
  SidebarRow,
} from '@/components/shared/sidebar-primitives'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { errorText } from '@/lib/client/error-text'
import {
  upsertArticleTranslationFn,
  setArticleTranslationStatusFn,
  deleteArticleTranslationFn,
} from '@/lib/server/functions/help-center-translations'
import {
  getArticleTranslationFn,
  markArticleTranslationCurrentFn,
  publishArticleTranslationUpdateFn,
  discardArticleTranslationUpdateFn,
  requestArticleAiTranslationFn,
} from '@/lib/server/functions/help-center-article-languages'
import { helpCenterKeys } from '@/lib/client/queries/help-center'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import type { JSONContent } from '@tiptap/react'
import type { EditorDocument } from '@/components/ui/rich-text-editor'
import { HelpCenterFormFields } from './help-center-form-fields'
import { ArticleTranslationChangesDialog } from './article-translation-changes-dialog'
import { LanguageDot, checkProblemText, languageName } from './article-language-bar'
import type { ArticleLanguageEntry } from './article-languages'

/** The main-language text a translation can start from. */
export interface ArticleSourceText {
  title: string
  description: string | null
  content: string
  contentJson: JSONContent | null
}

interface ArticleTranslationPaneProps {
  articleId: string
  ownLocale: string
  entry: ArticleLanguageEntry
  aiAvailable: boolean
  source: ArticleSourceText
  shared: { categoryName?: string; authorName?: string | null; audience: string }
  header: React.ReactNode
  onClose: () => void
}

export const articleLanguagesKey = (articleId: string) =>
  ['help-center', 'article-languages', articleId] as const
const translationKey = (articleId: string, locale: string) =>
  ['help-center', 'article-translation', articleId, locale] as const

/**
 * One extra language of an article in the editor: its own title,
 * description, body and publish state, with the update actions. A language
 * with no version yet offers AI or the main-language text to start from.
 */
export function ArticleTranslationPane(props: ArticleTranslationPaneProps) {
  const { articleId, entry } = props
  const locale = entry.locale as SupportedLocale
  const translation = useQuery({
    queryKey: translationKey(articleId, locale),
    queryFn: () => getArticleTranslationFn({ data: { articleId, locale } }),
  })
  const [startFrom, setStartFrom] = useState(false)

  if (translation.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  const row = translation.data ?? null
  if (!row && !startFrom) {
    return <MissingLanguage {...props} onStart={() => setStartFrom(true)} />
  }
  const initial = row
    ? {
        title: row.title,
        description: row.description ?? '',
        content: row.content,
        contentJson: (row.contentJson as JSONContent | null) ?? null,
      }
    : {
        title: props.source.title,
        description: props.source.description ?? '',
        content: props.source.content,
        contentJson: props.source.contentJson,
      }
  return (
    <TranslationForm
      key={row?.updatedAt ?? 'new'}
      {...props}
      status={row?.status ?? null}
      updatedAt={row?.updatedAt ?? null}
      initial={initial}
      startedFromSource={!row}
    />
  )
}

function useLanguageActions(articleId: string, locale: SupportedLocale) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: articleLanguagesKey(articleId) }),
      queryClient.invalidateQueries({ queryKey: translationKey(articleId, locale) }),
      queryClient.invalidateQueries({ queryKey: helpCenterKeys.articleLists() }),
      queryClient.invalidateQueries({
        queryKey: ['help-center', 'article-translation-changes', articleId, locale],
      }),
    ])
  }, [queryClient, articleId, locale])
  const run = useCallback(
    async (name: string, action: () => Promise<unknown>, failure: string) => {
      setBusy(name)
      setError(null)
      setNotice(null)
      try {
        await action()
        await refresh()
      } catch (err) {
        setError(errorText(err, failure))
      } finally {
        setBusy(null)
      }
    },
    [refresh]
  )
  const askAi = useCallback(
    () =>
      run(
        'ai',
        async () => {
          const outcome = await requestArticleAiTranslationFn({ data: { articleId, locale } })
          if (outcome.kind === 'paused') {
            setNotice('AI usage for this period is used up. Try again when it renews.')
          } else if (outcome.kind === 'skipped' && outcome.reason === 'unavailable') {
            setNotice('AI translation is not available on this workspace.')
          } else if (outcome.kind === 'skipped' && outcome.reason === 'failed') {
            setNotice('AI could not translate this article. Try again later.')
          }
        },
        'Could not translate with AI'
      ),
    [run, articleId, locale]
  )
  return { busy, error, notice, run, askAi, refresh }
}

function MissingLanguage({
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

function PausedNote() {
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      <FormattedMessage
        id="admin.helpCenter.autoTranslatePaused"
        defaultMessage="Paused: AI usage for this period is used up. Upgrade your plan for more."
      />
    </p>
  )
}

function SharedRows({ shared }: { shared: ArticleTranslationPaneProps['shared'] }) {
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

function TranslationForm({
  articleId,
  ownLocale,
  entry,
  aiAvailable,
  shared,
  header,
  onClose,
  status,
  updatedAt,
  initial,
  startedFromSource,
}: ArticleTranslationPaneProps & {
  status: 'draft' | 'published' | null
  updatedAt: string | null
  initial: { title: string; description: string; content: string; contentJson: JSONContent | null }
  startedFromSource: boolean
}) {
  const locale = entry.locale as SupportedLocale
  const own = languageName(ownLocale)
  const actions = useLanguageActions(articleId, locale)
  const [contentJson, setContentJson] = useState<JSONContent | null>(initial.contentJson)
  const [changesOpen, setChangesOpen] = useState(false)
  const form = useForm({
    defaultValues: {
      title: initial.title,
      description: initial.description,
      content: initial.content,
    },
  })
  // Text copied from the main language is a change until it is saved.
  const dirty = form.formState.isDirty || startedFromSource

  const handleContentChange = useCallback(
    (document: EditorDocument) => {
      setContentJson(document.json())
      form.setValue('content', document.markdown(), { shouldDirty: true })
    },
    [form]
  )

  const handleSubmit = form.handleSubmit((data) =>
    actions.run(
      'save',
      async () => {
        await upsertArticleTranslationFn({
          data: {
            articleId,
            locale,
            title: data.title,
            description: data.description.trim(),
            content: data.content,
            contentJson: contentJson as TiptapContent | null,
          },
        })
        form.reset(data)
      },
      'Could not save the translation'
    )
  )
  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  const togglePublish = () =>
    actions.run(
      'status',
      () =>
        setArticleTranslationStatusFn({
          data: { articleId, locale, status: status === 'published' ? 'draft' : 'published' },
        }),
      'Could not update the translation status'
    )

  const pending = entry.pendingUpdate
  const failedUpdate = pending?.check && !pending.check.ok ? pending.check : null
  const failedDraft = !pending && entry.draftCheck && !entry.draftCheck.ok ? entry.draftCheck : null
  const busy = !!actions.busy

  const strip = (() => {
    if (!status) return null
    if (pending && failedUpdate) {
      return (
        <Strip
          tone="warning"
          text={`The AI update needs a person: ${failedUpdate.problems.map(checkProblemText).join('; ')}.`}
        >
          <StripButton onClick={() => setChangesOpen(true)}>Show changes</StripButton>
          {aiAvailable ? (
            <StripButton disabled={busy} onClick={actions.askAi}>
              Update with AI
            </StripButton>
          ) : null}
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
        </Strip>
      )
    }
    if (pending) {
      return (
        <Strip
          tone="info"
          text="An AI update is ready. Readers see the current text until you publish it."
        >
          <StripButton onClick={() => setChangesOpen(true)}>Show changes</StripButton>
          <StripButton
            disabled={busy}
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
        </Strip>
      )
    }
    if (entry.needsUpdate) {
      return (
        <Strip tone="warning" text={`The ${own} article changed after this translation was made.`}>
          <StripButton onClick={() => setChangesOpen(true)}>Show changes</StripButton>
          {aiAvailable ? (
            <StripButton disabled={busy} onClick={actions.askAi}>
              Update with AI
            </StripButton>
          ) : null}
          <StripButton
            disabled={busy}
            onClick={() =>
              actions.run(
                'mark-current',
                () => markArticleTranslationCurrentFn({ data: { articleId, locale } }),
                'Could not mark the translation as up to date'
              )
            }
          >
            Mark as up to date
          </StripButton>
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
  })()

  return (
    <Form {...form}>
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if (e.currentTarget.contains(e.target as Node)) handleKeyDown(e)
        }}
        className="flex h-full min-h-0 flex-1 flex-col"
      >
        {header}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {strip ? <div className="px-4 pt-4 sm:px-6">{strip}</div> : null}
            {entry.autoTranslatePaused ? (
              <div className="px-4 sm:px-6">
                <PausedNote />
              </div>
            ) : null}
            {actions.notice ? (
              <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-6">{actions.notice}</p>
            ) : null}
            <HelpCenterFormFields
              form={form}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              showDescription
              error={actions.error ?? undefined}
            />
          </div>
          <SidebarContainer className="overflow-y-auto">
            <SidebarRow label="Status">
              {status ? (
                <button
                  type="button"
                  onClick={togglePublish}
                  disabled={busy}
                  className="flex items-center gap-2 text-sm disabled:opacity-60"
                >
                  <LanguageDot state={status === 'published' ? 'published' : 'draft'} />
                  {status === 'published' ? 'Published' : 'Draft'}
                </button>
              ) : (
                <span className="flex items-center gap-2 text-sm">
                  <LanguageDot state="missing" />
                  Not saved yet
                </span>
              )}
            </SidebarRow>
            <SharedRows shared={shared} />
            {updatedAt ? (
              <>
                <SidebarDivider />
                <SidebarRow label="Translated from">
                  <span className="text-sm">
                    {own}, <TimeAgo date={updatedAt} locale="en" />
                  </span>
                </SidebarRow>
                <SidebarDivider />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      actions.run(
                        'delete',
                        () => deleteArticleTranslationFn({ data: { articleId, locale } }),
                        'Could not delete the translation'
                      )
                    }
                  >
                    Delete translation
                  </Button>
                </div>
              </>
            ) : null}
          </SidebarContainer>
        </div>
        <ModalFooter
          onCancel={onClose}
          submitLabel={actions.busy === 'save' ? 'Saving…' : 'Save changes'}
          isPending={actions.busy === 'save'}
          submitDisabled={!dirty}
        >
          {status ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              disabled={busy}
              onClick={togglePublish}
            >
              {status === 'published' ? 'Unpublish' : 'Publish'}
            </Button>
          ) : null}
        </ModalFooter>
      </form>
      <ArticleTranslationChangesDialog
        articleId={articleId}
        locale={locale}
        ownLocale={ownLocale}
        open={changesOpen}
        onOpenChange={setChangesOpen}
      />
    </Form>
  )
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
  )
}

function StripButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-medium underline-offset-2 hover:underline disabled:opacity-60"
    >
      {children}
    </button>
  )
}
