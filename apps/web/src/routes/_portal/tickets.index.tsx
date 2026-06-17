import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useMemo, useCallback } from 'react'
import type { JSONContent } from '@tiptap/react'
import { z } from 'zod'
import { useIntl, FormattedMessage } from 'react-intl'
import { ChatBubbleLeftRightIcon, PlusIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { portalTicketQueries, type PortalStatusCategory } from '@/lib/client/queries/portal-tickets'
import { PortalTicketRowItem } from '@/components/public/tickets/portal-ticket-row'
import {
  PortalTicketStatusFilter,
  type StatusFilterValue,
} from '@/components/public/tickets/portal-ticket-status-filter'
import { useCreateMyTicket } from '@/lib/client/queries/portal-tickets'
import { createTicketInitialThreadFn } from '@/lib/server/functions/portal-tickets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'
import { TICKET_CREATE_EDITOR_FEATURES } from '@/components/tickets/ticket-create-editor-features'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const searchSchema = z.object({
  status: z.enum(['open', 'pending', 'solved', 'closed', 'all']).optional().default('open'),
})

function statusToCategory(s: StatusFilterValue): PortalStatusCategory | undefined {
  return s === 'all' ? undefined : s
}

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

export const Route = createFileRoute('/_portal/tickets/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  beforeLoad: async ({ context }) => {
    // Check if myTickets tab is enabled for the user
    const parentData = context as any
    const enabledTabs = parentData.enabledTabs || {}
    if (enabledTabs.myTickets === false) {
      throw redirect({ to: '/' })
    }
  },
  loader: async ({ context, deps }) => {
    if (!context.session?.user) {
      throw redirect({ to: '/auth/login', search: { next: '/tickets' } as never })
    }
    await context.queryClient.ensureQueryData(
      portalTicketQueries.list({ statusCategory: statusToCategory(deps.status) })
    )
    return { workspaceName: context.settings?.name ?? '' }
  },
  head: ({ loaderData }) => {
    const title = loaderData?.workspaceName
      ? `My tickets · ${loaderData.workspaceName}`
      : 'My tickets'
    return { meta: [{ title }] }
  },
  component: TicketsListPage,
})

function TicketsListPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const intl = useIntl()
  const { data } = useSuspenseQuery(
    portalTicketQueries.list({ statusCategory: statusToCategory(search.status) })
  )
  const createTicket = useCreateMyTicket()
  const [isComposerOpen, setIsComposerOpen] = useState(data.rows.length === 0)
  const [subject, setSubject] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [descriptionJson, setDescriptionJson] = useState<JSONContent | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const { upload: uploadImage } = usePortalImageUpload()

  const descriptionText = useMemo(() => plainTextFromJson(descriptionJson), [descriptionJson])
  const canSubmit =
    subject.trim().length > 0 && descriptionText.length > 0 && !createTicket.isPending

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || [])
    setSelectedFiles((prev) => [...prev, ...files])
    e.currentTarget.value = '' // Reset input so same file can be selected again
  }, [])

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleCreate = useCallback(async () => {
    if (!canSubmit) return

    try {
      // Step 1: Create the ticket
      const created = await createTicket.mutateAsync({
        subject: subject.trim(),
        priority,
        descriptionJson,
        descriptionText,
      })

      // Step 2: If files are selected, create initial thread and upload files
      if (selectedFiles.length > 0) {
        try {
          const threadResponse = await createTicketInitialThreadFn({
            data: { ticketId: created.id },
          })

          // Step 3: Upload files to the thread
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i]
            try {
              const formData = new FormData()
              formData.append('file', file)

              // Use the attachment endpoint directly
              const attachmentRes = await fetch(
                `/api/v1/tickets/${created.id}/threads/${threadResponse.id}/attachments`,
                {
                  method: 'POST',
                  body: formData,
                }
              )

              if (!attachmentRes.ok) {
                await attachmentRes.text()
              }
            } catch {
              // Best-effort upload: ticket is already created.
            }
          }
        } catch (err) {
          // File upload failed but ticket was created - show warning
          console.error('File upload failed:', err)
          // Don't prevent navigation; show errors but let user proceed
        }
      }

      // Reset form and navigate
      setSubject('')
      setDescriptionJson(null)
      setPriority('normal')
      setSelectedFiles([])
      setIsComposerOpen(false)
      navigate({ to: '/tickets/$ticketId', params: { ticketId: created.id } })
    } catch (err) {
      console.error('Ticket creation failed:', err)
    }
  }, [
    canSubmit,
    createTicket,
    descriptionJson,
    descriptionText,
    navigate,
    priority,
    subject,
    selectedFiles,
  ])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <FormattedMessage id="portal.tickets.title" defaultMessage="My tickets" />
          </h1>
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.tickets.subtitle"
              defaultMessage="Tickets you opened or were added to."
            />
          </p>
        </div>
        <Button size="sm" onClick={() => setIsComposerOpen((prev) => !prev)}>
          <PlusIcon className="me-1.5 h-4 w-4" />
          {isComposerOpen ? (
            <FormattedMessage id="portal.tickets.create.hide" defaultMessage="Hide form" />
          ) : (
            <FormattedMessage id="portal.tickets.create.cta" defaultMessage="New ticket" />
          )}
        </Button>
      </div>

      {isComposerOpen && (
        <Card className="gap-0">
          <CardHeader className="border-b">
            <CardTitle>
              <FormattedMessage id="portal.tickets.create.title" defaultMessage="Open a ticket" />
            </CardTitle>
            <CardDescription>
              <FormattedMessage
                id="portal.tickets.create.subtitle"
                defaultMessage="Share what went wrong and our team will follow up."
              />
            </CardDescription>
            <CardAction>
              <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                <FormattedMessage
                  id="portal.tickets.create.response"
                  defaultMessage="Usually replies within 1 business day"
                />
              </span>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-2">
              <Label htmlFor="portal-ticket-subject">
                <FormattedMessage id="portal.tickets.create.subject" defaultMessage="Subject" />
              </Label>
              <Input
                id="portal-ticket-subject"
                maxLength={500}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'portal.tickets.create.subject.placeholder',
                  defaultMessage: 'Briefly summarize your issue',
                })}
                disabled={createTicket.isPending}
              />
            </div>

            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="portal-ticket-priority">
                <FormattedMessage id="portal.tickets.create.priority" defaultMessage="Priority" />
              </Label>
              <select
                id="portal-ticket-priority"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as 'low' | 'normal' | 'high' | 'urgent')
                }
                disabled={createTicket.isPending}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <option value="low">
                  {intl.formatMessage({ id: 'portal.tickets.priority.low', defaultMessage: 'Low' })}
                </option>
                <option value="normal">
                  {intl.formatMessage({
                    id: 'portal.tickets.priority.normal',
                    defaultMessage: 'Normal',
                  })}
                </option>
                <option value="high">
                  {intl.formatMessage({
                    id: 'portal.tickets.priority.high',
                    defaultMessage: 'High',
                  })}
                </option>
                <option value="urgent">
                  {intl.formatMessage({
                    id: 'portal.tickets.priority.urgent',
                    defaultMessage: 'Urgent',
                  })}
                </option>
              </select>
            </div>

            <div className="grid gap-2">
              <Label>
                <FormattedMessage id="portal.tickets.create.details" defaultMessage="Details" />
              </Label>
              <RichTextEditor
                value={descriptionJson ?? undefined}
                onChange={(json) => setDescriptionJson(json)}
                minHeight="140px"
                features={TICKET_CREATE_EDITOR_FEATURES}
                onImageUpload={uploadImage}
                placeholder={intl.formatMessage({
                  id: 'portal.tickets.create.details.placeholder',
                  defaultMessage:
                    'What were you trying to do, what happened, and what did you expect?',
                })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="portal-ticket-attachments">
                <FormattedMessage
                  id="portal.tickets.create.attachments"
                  defaultMessage="Attachments (optional)"
                />
              </Label>
              <Input
                id="portal-ticket-attachments"
                type="file"
                multiple
                onChange={handleFileSelect}
                disabled={createTicket.isPending}
              />
              {selectedFiles.length > 0 && (
                <div className="space-y-2 pt-2">
                  {selectedFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between rounded-md border border-input bg-muted/50 px-3 py-2 text-sm"
                    >
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="ml-2 text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                <FormattedMessage
                  id="portal.tickets.create.guidance"
                  defaultMessage="Include steps to reproduce and any error messages for faster help."
                />
              </p>
              <Button type="button" onClick={handleCreate} disabled={!canSubmit}>
                {createTicket.isPending ? (
                  <FormattedMessage
                    id="portal.tickets.create.submitting"
                    defaultMessage="Creating..."
                  />
                ) : (
                  <FormattedMessage
                    id="portal.tickets.create.submit"
                    defaultMessage="Create ticket"
                  />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <PortalTicketStatusFilter value={search.status} />

      {data.rows.length === 0 ? (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title={intl.formatMessage({
            id: 'portal.tickets.empty.title',
            defaultMessage: 'No tickets yet',
          })}
          description={intl.formatMessage({
            id: 'portal.tickets.empty.description',
            defaultMessage: "When our team handles a request from you, it'll appear here.",
          })}
        />
      ) : (
        <ul className="space-y-2">
          {data.rows.map((row) => (
            <li key={row.id}>
              <PortalTicketRowItem ticket={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
