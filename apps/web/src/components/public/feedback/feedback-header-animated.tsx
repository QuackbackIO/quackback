import type { BoardId } from '@quackback/ids'
import { Suspense, useState, useCallback, useEffect, useRef, type RefObject } from 'react'
import { createValueStore, useStoreValue, type ValueStore } from '@/lib/client/value-store'
import { useIntl, FormattedMessage } from 'react-intl'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { PencilIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  LazyRichTextEditor,
  RichTextEditorPlaceholder,
  preloadRichTextEditor,
} from '@/components/ui/lazy-rich-text-editor'
import { usePortalMediaUpload } from '@/lib/client/hooks/use-image-upload'
import { useCreatePublicPost } from '@/lib/client/mutations/portal-posts'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { useSimilarPosts } from '@/lib/client/hooks/use-similar-posts'
import { useEnsureAnonSession } from '@/lib/client/hooks/use-ensure-anon-session'
import { SimilarPostsCard } from '@/components/public/similar-posts-card'
import { BoardCustomFields } from '@/components/public/feedback/board-custom-fields'
import { PostingToBoard } from '@/components/public/feedback/posting-to-board'
import { validatePostCustomFieldValues } from '@/lib/shared/post-custom-fields'
import type { BoardSettings } from '@/lib/shared/db-types'
import { signOut } from '@/lib/client/auth-client'
import { removeViewerScopedPortalQueries } from '@/lib/client/queries/portal'
import { resolveSubmitState } from '@/components/public/feedback/submit-permission'
import { PUBLIC_FEEDBACK_EDITOR_FEATURES } from '@/components/public/feedback/feedback-editor-features'
import type { EditorDocument } from '@/components/ui/rich-text-editor'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'

interface BoardOption {
  id: string
  name: string
  slug: string
  settings?: BoardSettings
}

export interface FeedbackHeaderProps {
  workspaceName: string
  boards: BoardOption[]
  defaultBoardId?: string
  user?: { name: string | null; email: string } | null
  /**
   * Per-board submit/vote capability for the current viewer, keyed by board id
   * (server-computed; composes the board's access.submit tier with the
   * workspace anonymous switch). The submit CTA follows the selected board's
   * `canSubmit` instead of the workspace-wide flag.
   */
  boardPermissions?: Record<string, { canSubmit: boolean; canVote: boolean }>
  onPostCreated?: (postId: string, boardSlug: string) => void
  /**
   * When true, posts go to this page's board and the form does not offer a
   * board switcher.
   */
  boardLocked?: boolean
}

export function FeedbackHeaderAnimated({
  boards,
  defaultBoardId,
  user,
  boardPermissions,
  onPostCreated,
  boardLocked = false,
}: FeedbackHeaderProps) {
  const intl = useIntl()
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useSessionContext()
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const { openAuthPopover } = useAuthPopover()

  const createPost = useCreatePublicPost()
  const ensureAnonSession = useEnsureAnonSession()
  const richMediaEnabled = true

  // Identified users post as themselves; anonymous posting is handled separately.
  const isAnonymousSession = session?.user?.principalType === 'anonymous'
  const effectiveUser =
    session?.user && !isAnonymousSession
      ? { name: session.user.name, email: session.user.email }
      : user
  const { upload: uploadMedia } = usePortalMediaUpload()
  const uploadMediaWithSession = useCallback(
    async (file: File) => {
      if (!(await ensureAnonSession())) throw new Error('Could not create upload session')
      return uploadMedia(file)
    },
    [ensureAnonSession, uploadMedia]
  )

  // Listen for auth success to refetch session (no page reload)
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate()
    },
    enabled: expanded,
  })

  // Board selection - only default if on a specific board page
  const [selectedBoardId, setSelectedBoardId] = useState(defaultBoardId || '')

  // Sync selectedBoardId when defaultBoardId prop changes
  useEffect(() => {
    if (defaultBoardId) {
      setSelectedBoardId(defaultBoardId)
    }
  }, [defaultBoardId])

  // Submit CTA follows the SELECTED board's server-computed capability (which
  // composes its access.submit tier with the workspace anonymous switch for
  // this viewer) — not the workspace-wide flag, which would advertise submit
  // on a board whose tier requires sign-in (Codex #191).
  const boardCanSubmit = boardPermissions?.[selectedBoardId]?.canSubmit ?? false
  const { canSubmit, canPostAnonymously, noAccess } = resolveSubmitState(boardCanSubmit, session)
  const canUploadMedia = richMediaEnabled && (!!session?.user || canPostAnonymously)

  const [title] = useState(createTitleStore)
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({})
  const titleInputRef = useRef<HTMLInputElement>(null)

  // The selected board's declared intake fields; answers validate against
  // these client-side (same rules the server enforces on write).
  const selectedBoard = boards.find((b) => b.id === selectedBoardId)
  const boardCustomFields = selectedBoard?.settings?.customFields ?? []

  // Focus title input when form expands
  useEffect(() => {
    if (expanded && titleInputRef.current) {
      requestAnimationFrame(() => {
        titleInputRef.current?.focus()
      })
    }
  }, [expanded])

  // The details as written. Typing keeps them here rather than in state, so a
  // keystroke never re-renders the header around the editor; the post reads
  // them (serialized once) when it is submitted. Only the open composer's
  // editor writes them: a closing one is still on screen while it animates
  // out, and the next one opens empty.
  const detailsRef = useRef<EditorDocument | null>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const handleContentChange = useCallback((document: EditorDocument) => {
    if (expandedRef.current) detailsRef.current = document
  }, [])

  async function handleSubmit() {
    setError('')
    const typedTitle = title.get()

    if (!selectedBoardId) {
      setError(
        intl.formatMessage({
          id: 'portal.feedback.header.errorSelectBoard',
          defaultMessage: 'Please select a board',
        })
      )
      return
    }

    if (!typedTitle.trim()) {
      setError(
        intl.formatMessage({
          id: 'portal.feedback.header.errorAddTitle',
          defaultMessage: 'Please add a title',
        })
      )
      return
    }

    if (!canSubmit) {
      setError(
        noAccess
          ? intl.formatMessage({
              id: 'portal.feedback.header.errorNoAccess',
              defaultMessage: "You don't have access to post on this board",
            })
          : intl.formatMessage({
              id: 'portal.feedback.header.errorSignIn',
              defaultMessage: 'Please sign in to submit feedback',
            })
      )
      return
    }

    if (boardCustomFields.length > 0) {
      const parsed = validatePostCustomFieldValues(boardCustomFields, customFieldValues)
      if (!parsed.ok) {
        setError(parsed.errors[0].message)
        return
      }
    }

    try {
      if (!effectiveUser && canPostAnonymously) {
        const ok = await ensureAnonSession()
        if (!ok) {
          setError(
            intl.formatMessage({
              id: 'portal.feedback.header.errorSession',
              defaultMessage: 'Failed to create session',
            })
          )
          return
        }
      }

      const details = detailsRef.current
      const result = await createPost.mutateAsync({
        boardId: selectedBoardId as BoardId,
        title: typedTitle.trim(),
        content: details?.markdown() ?? '',
        contentJson: details?.json() ?? null,
        ...(boardCustomFields.length > 0 ? { customFields: customFieldValues } : {}),
      })

      resetForm()
      setExpanded(false)
      onPostCreated?.(result.id, result.board.slug)

      toast.success(
        intl.formatMessage({
          id: 'portal.feedback.header.toastSubmitted',
          defaultMessage: 'Feedback submitted',
        }),
        {
          action: {
            label: intl.formatMessage({
              id: 'portal.feedback.header.toastView',
              defaultMessage: 'View',
            }),
            onClick: () => router.navigate({ to: `/b/${result.board.slug}/posts/${result.id}` }),
          },
        }
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'portal.feedback.header.errorSubmit',
              defaultMessage: 'Failed to submit feedback',
            })
      )
    }
  }

  function resetForm() {
    setSelectedBoardId(defaultBoardId || '')
    title.set('')
    detailsRef.current = null
    setCustomFieldValues({})
    setError('')
  }

  function handleCancel() {
    resetForm()
    setExpanded(false)
  }

  const handleKeyDown = useKeyboardSubmit(handleSubmit, handleCancel)

  return (
    <motion.div
      className="bg-card border border-border rounded-lg mb-5 shadow-sm overflow-hidden"
      initial={false}
      animate={{
        boxShadow: expanded
          ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
          : '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      }}
      transition={{ duration: 0.2 }}
      onKeyDown={handleKeyDown}
      // The editor renders once the header expands; hovering warms its chunk.
      onPointerEnter={preloadRichTextEditor}
    >
      {/* Destination board, above title when expanded */}
      <AnimatePresence>
        {expanded && boards.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <PostingToBoard
              boards={boards}
              selectedBoardId={selectedBoardId}
              locked={boardLocked}
              onSelect={(id) => {
                setSelectedBoardId(id)
                // Answers are per-board: switching boards drops the previous
                // board's field values rather than smuggling them across.
                setCustomFieldValues({})
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Icon + Title Row - Always visible */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Icon - fades out when expanded */}
        <AnimatePresence>
          {!expanded && (
            <motion.div
              initial={false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, width: 0, marginRight: -12 }}
              transition={{ duration: 0.2 }}
              className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"
            >
              <PencilIcon className="w-4 h-4 text-primary" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Title input - always visible, grows when expanded */}
        <TitleInput
          title={title}
          inputRef={titleInputRef}
          expanded={expanded}
          onExpand={() => setExpanded(true)}
        />
      </div>

      {/* Expandable content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {/* Error message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 sm:px-5"
                >
                  <div className="[border-radius:calc(var(--radius)*0.8)] bg-destructive/10 px-3 py-2 text-sm text-destructive mb-2">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Rich text editor */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.15 }}
              className="px-4 sm:px-5 pb-4"
            >
              <Suspense fallback={<RichTextEditorPlaceholder minHeight="150px" />}>
                <LazyRichTextEditor
                  value=""
                  onDocumentChange={handleContentChange}
                  placeholder={intl.formatMessage({
                    id: 'portal.feedback.header.detailsPlaceholder',
                    defaultMessage: 'Add more details... Type / for commands',
                  })}
                  minHeight="150px"
                  borderless
                  toolbarPosition="bottom"
                  features={{
                    ...PUBLIC_FEEDBACK_EDITOR_FEATURES,
                    images: canUploadMedia,
                    videos: canUploadMedia,
                  }}
                  onImageUpload={canUploadMedia ? uploadMediaWithSession : undefined}
                  onVideoUpload={canUploadMedia ? uploadMediaWithSession : undefined}
                />
              </Suspense>
            </motion.div>

            {/* Board-configured custom intake fields */}
            {boardCustomFields.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: 0.15 }}
                className="px-4 sm:px-5 pb-4"
              >
                <BoardCustomFields
                  fields={boardCustomFields}
                  values={customFieldValues}
                  onChange={(key, value) =>
                    setCustomFieldValues((prev) => ({ ...prev, [key]: value }))
                  }
                />
              </motion.div>
            )}

            {/* Similar posts card - shown above footer as pre-submit prompt */}
            <SimilarPostsPrompt title={title} enabled={expanded} />

            {/* Footer with auth and actions */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.2 }}
              className="flex items-center justify-between px-4 sm:px-5 py-3 border-t bg-muted/30"
            >
              {noAccess ? (
                <p className="text-xs text-muted-foreground">
                  <FormattedMessage
                    id="portal.feedback.header.noAccess"
                    defaultMessage="You don't have access to post on this board"
                  />
                </p>
              ) : effectiveUser ? (
                <p className="text-xs text-muted-foreground">
                  <FormattedMessage
                    id="portal.feedback.header.postingAs"
                    defaultMessage="Posting as"
                  />{' '}
                  <span className="font-medium text-foreground">
                    {effectiveUser.name || effectiveUser.email}
                  </span>
                  {' ('}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={async () => {
                      await signOut()
                      removeViewerScopedPortalQueries(queryClient)
                      router.invalidate()
                    }}
                  >
                    <FormattedMessage
                      id="portal.feedback.header.signOut"
                      defaultMessage="sign out"
                    />
                  </button>
                  {')'}
                </p>
              ) : canPostAnonymously ? (
                <p className="text-xs text-muted-foreground">
                  <FormattedMessage
                    id="portal.feedback.header.postingAnonymously"
                    defaultMessage="Posting anonymously"
                  />
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthPopover({ mode: 'login' })}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  <FormattedMessage
                    id="portal.feedback.header.signInToPost"
                    defaultMessage="Sign in to post"
                  />
                </button>
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={createPost.isPending}
                >
                  <FormattedMessage id="portal.feedback.header.cancel" defaultMessage="Cancel" />
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={createPost.isPending || !canSubmit}
                  title={
                    !canSubmit
                      ? noAccess
                        ? intl.formatMessage({
                            id: 'portal.feedback.header.submitTooltipNoAccess',
                            defaultMessage: "You don't have access to post on this board",
                          })
                        : intl.formatMessage({
                            id: 'portal.feedback.header.submitTooltipSignIn',
                            defaultMessage: 'Please sign in to submit feedback',
                          })
                      : undefined
                  }
                  className="portal-submit-button bg-[var(--portal-button-background)] text-[var(--portal-button-foreground)] hover:bg-[var(--portal-button-background)]/90"
                >
                  {createPost.isPending ? (
                    <FormattedMessage
                      id="portal.feedback.header.submitting"
                      defaultMessage="Submitting..."
                    />
                  ) : (
                    <FormattedMessage id="portal.feedback.header.submit" defaultMessage="Submit" />
                  )}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * The title as typed, held outside React state: the field and the similar-posts
 * search read it as it changes, and the composer reads it when it acts on
 * it, so a keystroke renders the field and the search, not the composer.
 */
type TitleStore = ValueStore<string>

const createTitleStore = (): TitleStore => createValueStore('')

function TitleInput({
  title,
  inputRef,
  expanded,
  onExpand,
}: {
  title: TitleStore
  inputRef: RefObject<HTMLInputElement | null>
  expanded: boolean
  onExpand: () => void
}) {
  const intl = useIntl()
  const value = useStoreValue(title)
  return (
    <motion.input
      ref={inputRef}
      type="text"
      placeholder={intl.formatMessage({
        id: 'portal.feedback.header.titlePlaceholder',
        defaultMessage: "What's your idea?",
      })}
      value={value}
      aria-label={intl.formatMessage({
        id: 'portal.feedback.header.titleLabel',
        defaultMessage: 'Feedback title',
      })}
      onChange={(e) => {
        title.set(e.target.value)
        if (!expanded) onExpand()
      }}
      onFocus={() => !expanded && onExpand()}
      className="flex-1 bg-transparent border-0 outline-none text-foreground font-semibold placeholder:text-muted-foreground/60 placeholder:font-normal caret-primary focus-visible:ring-2 focus-visible:ring-ring/50"
      initial={false}
      animate={{
        fontSize: expanded ? '1.25rem' : '1rem',
        lineHeight: expanded ? '1.75rem' : '1.5rem',
      }}
      transition={{ duration: 0.2 }}
    />
  )
}

/**
 * Posts like the one being written (duplicate detection), searched across all
 * boards as the title is typed.
 */
function SimilarPostsPrompt({ title, enabled }: { title: TitleStore; enabled: boolean }) {
  const value = useStoreValue(title)
  const { posts } = useSimilarPosts({ title: value, enabled })
  return <SimilarPostsCard posts={posts} show={value.length >= 5} className="px-4 sm:px-5 pb-3" />
}
