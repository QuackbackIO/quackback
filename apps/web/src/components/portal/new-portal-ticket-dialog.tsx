/**
 * Portal "New Ticket" form (support platform §4.2, 7C): the requester's own
 * intake dialog. Subject + Details lead; when the workspace offers more than
 * one intake-visible customer type a type picker joins (convergence Phase 4)
 * and the chosen type's field set renders below, validated inline with the
 * same shared validator the server enforces. A single-type workspace behaves
 * exactly like the legacy fixed form. On success it navigates to the new
 * ticket's thread.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import type { JSONContent } from '@tiptap/react'
import type { TiptapContent } from '@/lib/shared/db-types'
import { createMyTicketFn, getMyTicketFormFn } from '@/lib/server/functions/tickets'
import { portalTicketKeys } from '@/lib/client/queries/portal-tickets'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { TicketFormFields } from '@/components/shared/ticket-form-fields'
import { useTicketIntakeForm } from '@/components/shared/use-ticket-intake-form'
import { VISITOR_CONVERSATION_FEATURES } from '@/components/conversation/conversation-editor-features'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Native `<textarea maxLength>` used to silently cap this field; a rich doc
// can't be truncated mid-node without corrupting it, so the cap is now
// enforced pre-submit with the same toast the dialog already uses for
// mutation errors.
const DESCRIPTION_MAX_LENGTH = 4000

export function NewPortalTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const intl = useIntl()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [descriptionJson, setDescriptionJson] = useState<JSONContent | undefined>(undefined)
  const [descriptionMarkdown, setDescriptionMarkdown] = useState('')

  // The intake types this portal offers (live, intake-visible customer types,
  // customer-visible fields only). Fetched lazily while the dialog is open.
  const { data: formData } = useQuery({
    queryKey: [...portalTicketKeys.all(), 'intake-form'],
    queryFn: () => getMyTicketFormFn(),
    enabled: open,
    staleTime: 60_000,
  })
  const types = useMemo(() => formData?.types ?? [], [formData])
  const {
    selectedType,
    fields,
    fieldValues,
    fieldErrors,
    setFieldValue,
    selectType,
    reset: resetIntake,
    validate,
  } = useTicketIntakeForm(types)

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescriptionJson(undefined)
      setDescriptionMarkdown('')
      resetIntake()
    }
  }, [open, resetIntake])

  const { upload: uploadImage } = usePortalImageUpload()

  const create = useMutation({
    mutationFn: (vars: {
      title: string
      description?: string
      descriptionJson?: TiptapContent | null
      ticketTypeId?: string
      fieldValues?: Record<string, unknown>
    }) => createMyTicketFn({ data: vars }),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: portalTicketKeys.list() })
      onOpenChange(false)
      void navigate({ to: '/support/ticket/$ticketId', params: { ticketId: ticket.id } })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed to create ticket'),
  })

  const canSubmit = title.trim().length > 0 && !create.isPending

  const submit = () => {
    if (!canSubmit) return
    const description = descriptionMarkdown.trim()
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      // Matches the plain-English toast.error below (mutation errors also
      // aren't localized in this dialog).
      toast.error(`Details are too long (max ${DESCRIPTION_MAX_LENGTH} characters).`)
      return
    }

    // Client inline validation via the same validator the server enforces.
    const result = validate()
    if (!result.ok) return

    create.mutate({
      title: title.trim(),
      description: description || undefined,
      descriptionJson: isEmptyTiptapDoc(descriptionJson as TiptapContent | undefined)
        ? null
        : (descriptionJson as TiptapContent),
      ticketTypeId: selectedType?.id,
      fieldValues: Object.keys(result.values).length > 0 ? result.values : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage id="portal.tickets.new.title" defaultMessage="New ticket" />
          </DialogTitle>
          <DialogDescription>
            <FormattedMessage
              id="portal.tickets.new.subtitle"
              defaultMessage="Tell us what you need and we'll track it to resolution."
            />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {types.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                <FormattedMessage id="portal.tickets.new.type" defaultMessage="Type" />
              </label>
              <Select value={selectedType?.id ?? ''} onValueChange={selectType}>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={intl.formatMessage({
                      id: 'portal.tickets.new.typePlaceholder',
                      defaultMessage: 'Select…',
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden>{t.icon}</span>
                        <span>{t.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              <FormattedMessage id="portal.tickets.new.subject" defaultMessage="Subject" />
            </label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              placeholder={intl.formatMessage({
                id: 'portal.tickets.new.subjectPlaceholder',
                defaultMessage: 'Summarize your request…',
              })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              <FormattedMessage id="portal.tickets.new.details" defaultMessage="Details" />
            </label>
            <RichTextEditor
              value={descriptionJson ?? ''}
              onChange={(json, _html, markdown) => {
                setDescriptionJson(json)
                setDescriptionMarkdown(markdown)
              }}
              features={VISITOR_CONVERSATION_FEATURES}
              onImageUpload={uploadImage}
              minHeight="120px"
              placeholder={intl.formatMessage({
                id: 'portal.tickets.new.detailsPlaceholder',
                defaultMessage: 'Add anything that helps us understand the issue.',
              })}
            />
          </div>

          <TicketFormFields
            fields={fields}
            values={fieldValues}
            onChange={setFieldValue}
            errors={fieldErrors}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <FormattedMessage id="portal.tickets.new.submit" defaultMessage="Create ticket" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
