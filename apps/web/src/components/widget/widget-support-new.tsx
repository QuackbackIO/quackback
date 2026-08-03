import { useCallback, useEffect, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { JSONContent } from '@tiptap/react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { useWidgetImageUpload } from '@/lib/client/hooks/use-image-upload'
import { TICKET_CREATE_EDITOR_FEATURES } from '@/components/tickets/ticket-create-editor-features'
import {
  createWidgetTicket,
  WidgetTicketError,
  type WidgetTicketCreateResponse,
  type WidgetSupportCategory,
  type WidgetSupportPriority,
} from '@/lib/client/widget/tickets-api'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetSupportNewProps {
  onCreated: (ticket: WidgetTicketCreateResponse) => void
  categories?: WidgetSupportCategory[]
  imageUploadsInWidget?: boolean
}

const inputCls =
  'w-full bg-background rounded-md border border-border/50 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors'

function plainTextFromJson(json: JSONContent | null): string {
  if (!json) return ''
  let out = ''
  const walk = (node: JSONContent) => {
    if (node.type === 'text' && typeof node.text === 'string') out += node.text
    if (node.content) node.content.forEach(walk)
    if (node.type === 'paragraph' || node.type === 'heading') out += '\n'
  }
  walk(json)
  return out.trim()
}

export function WidgetSupportNew({
  onCreated,
  categories = [],
  imageUploadsInWidget = true,
}: WidgetSupportNewProps) {
  const intl = useIntl()
  const { isIdentified, hmacRequired, identifyWithEmail, ensureSessionThen, emitEvent } =
    useWidgetAuth()

  const [subject, setSubject] = useState('')
  const [bodyJson, setBodyJson] = useState<JSONContent | null>(null)
  const [priority, setPriority] = useState<WidgetSupportPriority>('normal')
  const [categoryKey, setCategoryKey] = useState<string>(
    categories.length === 1 ? categories[0].categoryKey : ''
  )
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const { upload: uploadImage } = useWidgetImageUpload()

  const needsEmail = !isIdentified && !hmacRequired
  const cantIdentify = !isIdentified && hmacRequired
  const selectedCategory = categories.find((category) => category.categoryKey === categoryKey)
  const canUploadImages =
    imageUploadsInWidget && (selectedCategory?.display?.showAttachments ?? true)
  const priorityOptions: WidgetSupportPriority[] = selectedCategory?.allowedPriorities?.length
    ? selectedCategory.allowedPriorities
    : selectedCategory
      ? ['low', 'normal', 'high', 'urgent']
      : ['low', 'normal', 'high']
  const showPrioritySelector = selectedCategory?.display?.showPrioritySelector !== false
  const bodyText = plainTextFromJson(bodyJson)

  useEffect(() => {
    if (categories.length === 1 && categoryKey !== categories[0].categoryKey) {
      setCategoryKey(categories[0].categoryKey)
    }
    if (categories.length !== 1 && selectedCategory && !priorityOptions.includes(priority)) {
      setPriority(selectedCategory.defaultPriority ?? priorityOptions[0] ?? 'normal')
    }
    if (selectedCategory?.defaultPriority && priority === 'normal') {
      setPriority(selectedCategory.defaultPriority)
    }
  }, [categories, categoryKey, selectedCategory, priorityOptions, priority])

  const canSubmit =
    !cantIdentify &&
    subject.trim().length > 0 &&
    bodyText.length > 0 &&
    (categories.length <= 1 || categoryKey.length > 0) &&
    (!needsEmail || email.trim().length > 0)

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || [])
    setSelectedFiles((prev) => [...prev, ...files])
    e.currentTarget.value = ''
  }, [])

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit || submitting) return
      setSubmitting(true)
      setError(null)

      try {
        if (needsEmail) {
          const ok = await identifyWithEmail(email.trim(), name.trim() || undefined)
          if (!ok) {
            setError(
              intl.formatMessage({
                id: 'widget.support.composer.errorEmail',
                defaultMessage: 'Could not verify your email. Please try again.',
              })
            )
            return
          }
        }

        let created: WidgetTicketCreateResponse | null = null
        await ensureSessionThen(async () => {
          created = await createWidgetTicket({
            subject: subject.trim(),
            bodyJson: bodyJson as { type: 'doc'; content?: unknown[] } | null,
            bodyText,
            priority: showPrioritySelector ? priority : undefined,
            categoryKey: selectedCategory?.categoryKey,
          })
        })
        const finalCreated = created as WidgetTicketCreateResponse | null
        if (!finalCreated) {
          setError(
            intl.formatMessage({
              id: 'widget.support.composer.errorCreate',
              defaultMessage: 'Could not create the ticket. Please try again.',
            })
          )
          return
        }

        // Upload files if selected
        if (canUploadImages && selectedFiles.length > 0 && finalCreated.initialThreadId) {
          try {
            for (let i = 0; i < selectedFiles.length; i++) {
              const file = selectedFiles[i]
              try {
                const formData = new FormData()
                formData.append('file', file)

                await fetch(
                  `/api/widget/tickets/${finalCreated.id}/threads/${finalCreated.initialThreadId}/attachments`,
                  {
                    method: 'POST',
                    body: formData,
                  }
                )
              } catch (err) {
                console.error(`Error uploading ${file.name}:`, err)
              }
            }
          } catch (err) {
            console.error('Failed to upload files:', err)
          }
        }

        emitEvent('ticket:created', {
          id: finalCreated.id,
          subject: finalCreated.subject,
          statusId: finalCreated.statusId,
          statusCategory: finalCreated.statusCategory,
        })
        onCreated(finalCreated)
      } catch (err) {
        setError(
          err instanceof WidgetTicketError
            ? err.message
            : intl.formatMessage({
                id: 'widget.support.composer.errorCreate',
                defaultMessage: 'Could not create the ticket. Please try again.',
              })
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      canSubmit,
      submitting,
      needsEmail,
      identifyWithEmail,
      email,
      name,
      ensureSessionThen,
      subject,
      bodyJson,
      bodyText,
      priority,
      showPrioritySelector,
      selectedCategory?.categoryKey,
      emitEvent,
      onCreated,
      intl,
      canUploadImages,
      selectedFiles,
    ]
  )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 pt-2 pb-3 space-y-2">
          {categories.length > 1 && (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">
                <FormattedMessage
                  id="widget.support.composer.category.label"
                  defaultMessage="Category"
                />
              </label>
              <select
                value={categoryKey}
                onChange={(e) => setCategoryKey(e.target.value)}
                disabled={submitting}
                className={inputCls}
              >
                <option value="">
                  {intl.formatMessage({
                    id: 'widget.support.composer.category.placeholder',
                    defaultMessage: 'Select a category',
                  })}
                </option>
                {categories.map((category) => (
                  <option key={category.categoryKey} value={category.categoryKey}>
                    {category.label}
                  </option>
                ))}
              </select>
              {selectedCategory?.description && (
                <p className="text-[11px] text-muted-foreground/70">
                  {selectedCategory.description}
                </p>
              )}
            </div>
          )}

          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            disabled={submitting}
            placeholder={intl.formatMessage({
              id: 'widget.support.composer.subjectPlaceholder',
              defaultMessage: 'Subject',
            })}
            className={inputCls}
          />
          <RichTextEditor
            value={bodyJson ?? undefined}
            onChange={(json) => setBodyJson(json)}
            minHeight="120px"
            borderless
            disabled={submitting}
            features={{
              ...TICKET_CREATE_EDITOR_FEATURES,
              images: canUploadImages,
            }}
            onImageUpload={canUploadImages ? uploadImage : undefined}
            className="rounded-md border border-border/50 bg-background px-2.5 py-1.5"
            placeholder={intl.formatMessage({
              id: 'widget.support.composer.bodyPlaceholder',
              defaultMessage: 'Describe your issue...',
            })}
          />

          {canUploadImages && (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">
                <FormattedMessage
                  id="widget.support.composer.attachments"
                  defaultMessage="Attachments (optional)"
                />
              </label>
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                disabled={submitting}
                className={`${inputCls} file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-muted file:text-muted-foreground hover:file:bg-muted/80`}
              />
              {selectedFiles.length > 0 && (
                <div className="space-y-1 pt-1">
                  {selectedFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between rounded-md border border-border/30 bg-muted/30 px-2 py-1 text-[11px]"
                    >
                      <span className="truncate text-muted-foreground">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="ml-1 text-muted-foreground/60 hover:text-muted-foreground"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showPrioritySelector && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground shrink-0">
                <FormattedMessage
                  id="widget.support.composer.priority.label"
                  defaultMessage="Priority"
                />
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as WidgetSupportPriority)}
                disabled={submitting}
                className={inputCls}
              >
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {intl.formatMessage({
                      id: `widget.support.composer.priority.${option}`,
                      defaultMessage:
                        option === 'low'
                          ? 'Low'
                          : option === 'normal'
                            ? 'Normal'
                            : option === 'high'
                              ? 'High'
                              : 'Urgent',
                    })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {needsEmail && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder={intl.formatMessage({
                  id: 'widget.support.composer.emailPlaceholder',
                  defaultMessage: 'Your email',
                })}
                className={inputCls}
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                placeholder={intl.formatMessage({
                  id: 'widget.support.composer.namePlaceholder',
                  defaultMessage: 'Your name (optional)',
                })}
                className={inputCls}
              />
            </div>
          )}

          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      </ScrollArea>

      <div className="px-3 py-2 border-t border-border/40 shrink-0 flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <FormattedMessage id="widget.support.composer.submitting" defaultMessage="Sending..." />
          ) : (
            <FormattedMessage id="widget.support.composer.submit" defaultMessage="Send" />
          )}
        </button>
      </div>
    </form>
  )
}
