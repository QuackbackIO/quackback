import { useCallback, useRef, useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import { useWidgetAuth } from './widget-auth-provider'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { COMMENT_EDITOR_FEATURES } from '@/components/public/comment-editor-features'
import type { TiptapContent } from '@/lib/shared/db-types'

interface WidgetUser {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

interface WidgetCommentFormProps {
  isIdentified: boolean
  user: WidgetUser | null
  onSubmit: (content: string, contentJson: TiptapContent | null) => Promise<void>
  identifyWithEmail: (email: string, name?: string) => Promise<boolean>
}

export function WidgetCommentForm({
  isIdentified,
  user,
  onSubmit,
  identifyWithEmail,
}: WidgetCommentFormProps) {
  const intl = useIntl()
  const { ensureSessionThen } = useWidgetAuth()
  const [commentText, setCommentText] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorJsonRef = useRef<TiptapContent | null>(null)
  const [editorResetKey, setEditorResetKey] = useState(0)

  const canSubmit = isIdentified
    ? commentText.trim().length > 0
    : commentText.trim().length > 0 && email.trim().length > 0

  const handleSubmit = useCallback(async () => {
    const content = commentText.trim()
    if (!content || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    try {
      if (!isIdentified) {
        const trimmedEmail = email.trim()
        if (!trimmedEmail) return
        const success = await identifyWithEmail(trimmedEmail, name.trim() || undefined)
        if (!success) {
          setError(
            intl.formatMessage({
              id: 'widget.commentForm.errorEmail',
              defaultMessage: 'Could not verify email. Please try again.',
            })
          )
          return
        }
      }

      await ensureSessionThen(async () => {
        await onSubmit(content, editorJsonRef.current)
        setCommentText('')
        editorJsonRef.current = null
        setEditorResetKey((k) => k + 1)
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'widget.commentForm.errorPost',
              defaultMessage: 'Could not post comment. Please try again.',
            })
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [
    commentText,
    isSubmitting,
    isIdentified,
    email,
    name,
    identifyWithEmail,
    ensureSessionThen,
    onSubmit,
    intl,
  ])

  return (
    <div className="mb-3">
      <div
        data-testid="widget-comment-form-editor"
        className="rounded-md border border-border/50 bg-muted/20"
        onKeyDownCapture={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void handleSubmit()
          }
        }}
      >
        <RichTextEditor
          key={editorResetKey}
          value={commentText}
          borderless
          minHeight="52px"
          features={COMMENT_EDITOR_FEATURES}
          disabled={isSubmitting}
          placeholder={intl.formatMessage({
            id: 'widget.commentForm.placeholder',
            defaultMessage: 'Write a comment...',
          })}
          onChange={(json, _html, markdown) => {
            editorJsonRef.current = json as TiptapContent
            setCommentText(markdown ?? '')
          }}
        />
      </div>

      {!isIdentified ? (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            type="email"
            required
            placeholder={intl.formatMessage({
              id: 'widget.commentForm.emailPlaceholder',
              defaultMessage: 'Email',
            })}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 min-w-0 bg-background rounded-md border border-border/50 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors"
          />
          <input
            type="text"
            placeholder={intl.formatMessage({
              id: 'widget.commentForm.namePlaceholder',
              defaultMessage: 'Name (optional)',
            })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-28 bg-background rounded-md border border-border/50 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isSubmitting ? (
              '...'
            ) : (
              <FormattedMessage id="widget.commentForm.post" defaultMessage="Post" />
            )}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1.5">
          <p className="text-[10px] text-muted-foreground/50 flex-1">
            <FormattedMessage
              id="widget.commentForm.postingAs"
              defaultMessage="Posting as {name}"
              values={{ name: user?.name || user?.email }}
            />
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isSubmitting ? (
              '...'
            ) : (
              <FormattedMessage id="widget.commentForm.post" defaultMessage="Post" />
            )}
          </button>
        </div>
      )}

      {error && <p className="text-[10px] text-destructive mt-1">{error}</p>}
    </div>
  )
}
