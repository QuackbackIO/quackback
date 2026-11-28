import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { ModalFooter } from '@/components/shared/modal-footer'
import {
  SidebarContainer,
  SidebarDivider,
  SidebarRow,
} from '@/components/shared/sidebar-primitives'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import {
  upsertArticleTranslationFn,
  setArticleTranslationStatusFn,
  deleteArticleTranslationFn,
} from '@/lib/server/functions/help-center-translations'
import { getArticleTranslationFn } from '@/lib/server/functions/help-center-article-languages'
import type { SupportedLocale } from '@/lib/shared/i18n'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import type { JSONContent } from '@tiptap/react'
import type { EditorDocument } from '@/components/ui/rich-text-editor'
import { HelpCenterFormFields } from './help-center-form-fields'
import { ArticleTranslationChangesDialog } from './article-translation-changes-dialog'
import { LanguageDot, languageName } from './article-language-bar'
import { translationKey, useLanguageActions } from './article-language-actions'
import { MissingLanguage, PausedNote, SharedRows } from './article-missing-language'
import { TranslationStrip } from './article-translation-strip'
import type { ArticleLanguageEntry } from './article-languages'

/** The main-language text a translation can start from. */
export interface ArticleSourceText {
  title: string
  description: string | null
  content: string
  contentJson: JSONContent | null
}

export interface ArticleTranslationPaneProps {
  articleId: string
  ownLocale: string
  entry: ArticleLanguageEntry
  aiAvailable: boolean
  source: ArticleSourceText
  shared: { categoryName?: string; authorName?: string | null; audience: string }
  header: React.ReactNode
  onClose: () => void
  /** Told whether this language has edits that are not saved yet. */
  onDirtyChange?: (dirty: boolean) => void
}

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
  // Starting from the main text lasts until the translation is saved; once it
  // exists (and after it is deleted) the missing-language screen applies again.
  if (row && startFrom) setStartFrom(false)
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
      // A new form only when the saved text changes, so a status change or a
      // refetch keeps what the person is typing.
      key={row ? savedTextKey(row) : 'new'}
      {...props}
      status={row?.status ?? null}
      updatedAt={row?.updatedAt ?? null}
      initial={initial}
      startedFromSource={!row}
    />
  )
}

/** A short fingerprint of a translation's saved text. */
function savedTextKey(row: {
  title: string
  description: string | null
  content: string
  contentJson: unknown
}): string {
  const text = [row.title, row.description ?? '', row.content, JSON.stringify(row.contentJson)]
  let hash = 0x811c9dc5
  for (const char of text.join('\u0000')) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function TranslationForm({
  articleId,
  ownLocale,
  entry,
  aiAvailable,
  shared,
  header,
  onClose,
  onDirtyChange,
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
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  const handleContentChange = useCallback(
    (document: EditorDocument) => {
      setContentJson(document.json())
      form.setValue('content', document.markdown(), { shouldDirty: true })
    },
    [form]
  )

  const saveText = useCallback(
    async (data: { title: string; description: string; content: string }) => {
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
    [articleId, locale, contentJson, form]
  )
  // An action on the saved translation (publish, mark as up to date) saves
  // the edits on screen first, so it acts on the text the person sees.
  const saveEdits = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    if (!(await form.trigger())) return false
    await saveText(form.getValues())
    return true
  }, [dirty, form, saveText])

  const handleSubmit = form.handleSubmit((data) =>
    actions.run('save', () => saveText(data), 'Could not save the translation')
  )
  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  const togglePublish = () =>
    actions.run(
      'status',
      async () => {
        if (!(await saveEdits())) return
        await setArticleTranslationStatusFn({
          data: { articleId, locale, status: status === 'published' ? 'draft' : 'published' },
        })
      },
      'Could not update the translation status'
    )

  const busy = !!actions.busy

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
            {status ? (
              <TranslationStrip
                articleId={articleId}
                locale={locale}
                own={own}
                entry={entry}
                aiAvailable={aiAvailable}
                actions={actions}
                dirty={dirty}
                saveEdits={saveEdits}
                onShowChanges={() => setChangesOpen(true)}
              />
            ) : null}
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
                  <span className="text-sm">{own}</span>
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
