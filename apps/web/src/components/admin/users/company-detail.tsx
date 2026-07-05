import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useRouteContext } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  BuildingOffice2Icon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  PlusIcon,
  ChatBubbleLeftRightIcon,
  TicketIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { CompanyId, PrincipalId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { adminQueries } from '@/lib/client/queries/admin'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { cn } from '@/lib/shared/utils'
import { listConversationsFn } from '@/lib/server/functions/conversation'
import { listTicketsFn } from '@/lib/server/functions/tickets'
import {
  getCompanyFn,
  updateCompanyFn,
  deleteCompanyFn,
  listCompanyMembersFn,
  getCompanyActivityFn,
  attachPrincipalToCompanyFn,
  detachPrincipalFromCompanyFn,
  type CompanyDTO,
} from '@/lib/server/functions/companies'
import { formatMonthlySpend, SourceBadge } from '@/components/admin/users/companies-view'
import { useCompanyAttributes } from '@/lib/client/hooks/use-company-attributes-queries'

function companyKeys(companyId: string) {
  return {
    detail: ['admin', 'company', companyId] as const,
    members: ['admin', 'company', companyId, 'members'] as const,
    activity: ['admin', 'company', companyId, 'activity'] as const,
  }
}

/** Editable standard fields (name is edited in the header). */
interface StandardFieldsDraft {
  domain: string
  externalId: string
  plan: string
  monthlySpend: string
  size: string
  website: string
  industry: string
}

function draftFromCompany(company: CompanyDTO): StandardFieldsDraft {
  return {
    domain: company.domain ?? '',
    externalId: company.externalId ?? '',
    plan: company.plan ?? '',
    monthlySpend: company.mrrCents != null ? String(company.mrrCents / 100) : '',
    size: company.size ?? '',
    website: company.website ?? '',
    industry: company.industry ?? '',
  }
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right min-w-0 truncate">{children}</span>
    </div>
  )
}

/** Search-and-attach people picker over the portal users directory. */
function AttachMemberButton({ companyId }: { companyId: CompanyId }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const { data } = useQuery({
    ...adminQueries.portalUsers({ search: query || undefined, page: 1, limit: 8 }),
    enabled: open,
  })
  const candidates = data?.items ?? []

  const attach = async (principalId: PrincipalId) => {
    setBusy(true)
    try {
      await attachPrincipalToCompanyFn({ data: { companyId, principalId } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: companyKeys(companyId).members }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'company', 'for-principal'] }),
      ])
      setOpen(false)
      setQuery('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to attach person')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <PlusIcon className="h-3 w-3" />
          Add person
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end" sideOffset={4}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people..."
          className="mb-2 h-8 text-sm"
          autoFocus
        />
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No people found</p>
          ) : (
            candidates.map((person) => (
              <button
                key={person.principalId}
                type="button"
                disabled={busy}
                onClick={() => attach(person.principalId)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60 disabled:opacity-50"
              >
                <Avatar
                  src={person.image}
                  name={person.name ?? 'User'}
                  className="size-5 text-[9px]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {person.name ?? 'Unnamed'}
                  </span>
                  {person.email && (
                    <span className="block truncate text-muted-foreground">{person.email}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MembersSection({ companyId, canManage }: { companyId: CompanyId; canManage: boolean }) {
  const queryClient = useQueryClient()
  const keys = companyKeys(companyId)
  const { data: members, isLoading } = useQuery({
    queryKey: keys.members,
    queryFn: () => listCompanyMembersFn({ data: { companyId } }),
  })
  const [detaching, setDetaching] = useState<string | null>(null)

  const detach = async (principalId: string) => {
    setDetaching(principalId)
    try {
      await detachPrincipalFromCompanyFn({ data: { principalId } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.members }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'company', 'for-principal'] }),
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove person')
    } finally {
      setDetaching(null)
    }
  }

  return (
    <div className="border-t border-border/50 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">People{members ? ` (${members.length})` : ''}</h3>
        {canManage && <AttachMemberButton companyId={companyId} />}
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : !members || members.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No people linked yet</p>
      ) : (
        <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50">
          {members.map((member) => (
            <div key={member.principalId} className="flex items-center gap-2.5 px-3 py-2">
              <Avatar
                src={null}
                name={member.displayName ?? 'Person'}
                className="size-7 text-[10px]"
              />
              <div className="min-w-0 flex-1">
                <Link
                  to="/admin/users"
                  search={{ selected: member.principalId }}
                  className="block truncate text-sm font-medium text-foreground hover:underline"
                >
                  {member.displayName ?? 'Unnamed'}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.email ?? (member.type === 'anonymous' ? 'Anonymous visitor' : 'No email')}
                </span>
              </div>
              {canManage && (
                <button
                  type="button"
                  disabled={detaching === member.principalId}
                  onClick={() => detach(member.principalId)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  title="Remove from company"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActivitySection({ companyId }: { companyId: CompanyId }) {
  const { settings } = useRouteContext({ from: '__root__' })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const supportInboxEnabled = flags?.supportInbox ?? false
  const supportTicketsEnabled = flags?.supportTickets ?? false

  const { data: counts } = useQuery({
    queryKey: companyKeys(companyId).activity,
    queryFn: () => getCompanyActivityFn({ data: { companyId } }),
  })

  const { data: conversationsData } = useQuery({
    queryKey: ['admin', 'company', companyId, 'recent-conversations'],
    queryFn: () => listConversationsFn({ data: { companyId } }),
    enabled: supportInboxEnabled,
  })
  const recentConversations = (conversationsData?.conversations ?? []).slice(0, 5)

  const { data: recentTickets } = useQuery({
    queryKey: ['admin', 'company', companyId, 'recent-tickets'],
    queryFn: () => listTicketsFn({ data: { companyId, limit: 5 } }),
    enabled: supportTicketsEnabled,
  })

  if (!supportInboxEnabled && !supportTicketsEnabled) return null

  return (
    <div className="border-t border-border/50 pt-4 space-y-4">
      <h3 className="text-sm font-medium">Activity</h3>

      {/* Rollup counts */}
      <div className="grid grid-cols-2 gap-3">
        {supportInboxEnabled && (
          <div className="rounded-lg border border-border/50 bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ChatBubbleLeftRightIcon className="h-3.5 w-3.5" />
              Conversations
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {counts?.conversations ?? '-'}
            </div>
          </div>
        )}
        {supportTicketsEnabled && (
          <div className="rounded-lg border border-border/50 bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TicketIcon className="h-3.5 w-3.5" />
              Tickets
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{counts?.tickets ?? '-'}</div>
          </div>
        )}
      </div>

      {/* Recent conversations */}
      {supportInboxEnabled && recentConversations.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">Recent conversations</h4>
            <Link
              to="/admin/inbox"
              search={{ company: companyId }}
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50">
            {recentConversations.map((c) => (
              <Link
                key={c.id}
                to="/admin/inbox"
                search={{ c: c.id }}
                className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {c.subject ?? c.lastMessagePreview ?? 'Conversation'}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize',
                    c.status === 'open'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : c.status === 'snoozed'
                        ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-muted text-muted-foreground'
                  )}
                >
                  {c.status}
                </span>
                <TimeAgo
                  date={c.lastMessageAt}
                  className="shrink-0 text-[11px] text-muted-foreground"
                />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent tickets */}
      {supportTicketsEnabled && (recentTickets ?? []).length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">Recent tickets</h4>
          </div>
          <div className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50">
            {(recentTickets ?? []).map((t) => (
              <Link
                key={t.id}
                to="/admin/tickets"
                search={{ t: t.id }}
                className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors"
              >
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t.reference}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${t.status.color}1a`, color: t.status.color }}
                >
                  {t.status.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Typed editors over companies.custom_attributes, driven by the company
 * attribute definitions. Keys without a definition render read-only so
 * API-synced data is never hidden. Edits are global: every attached person's
 * view reflects them.
 */
function CompanyAttributesPanel({
  company,
  canManage,
}: {
  company: CompanyDTO
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const { data: definitions } = useCompanyAttributes()
  const values = company.customAttributes ?? {}
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)

  const defs = definitions ?? []
  const definedKeys = new Set(defs.map((d) => d.key))
  const extraEntries = Object.entries(values).filter(([key]) => !definedKeys.has(key))

  if (defs.length === 0 && extraEntries.length === 0) return null

  const valueAsString = (key: string): string => {
    const v = values[key]
    if (v == null) return ''
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }

  const startEditing = () => {
    const initial: Record<string, string> = {}
    for (const def of defs) initial[def.key] = valueAsString(def.key)
    setDraft(initial)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const next: Record<string, unknown> = { ...values }
      for (const def of defs) {
        const raw = (draft[def.key] ?? '').trim()
        if (raw === '') {
          delete next[def.key]
          continue
        }
        if (def.type === 'number' || def.type === 'currency') {
          const num = Number(raw)
          if (Number.isNaN(num)) {
            toast.error(`${def.label} must be a number`)
            setSaving(false)
            return
          }
          next[def.key] = num
        } else if (def.type === 'boolean') {
          next[def.key] = raw === 'true'
        } else {
          next[def.key] = raw
        }
      }
      await updateCompanyFn({ data: { id: company.id, customAttributes: next } })
      await queryClient.invalidateQueries({ queryKey: companyKeys(company.id).detail })
      setDraft(null)
      toast.success('Attributes updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update attributes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-border/50 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Custom attributes</h3>
        {canManage &&
          defs.length > 0 &&
          (draft ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDraft(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={startEditing}>
              <PencilIcon className="h-3 w-3 mr-1" />
              Edit
            </Button>
          ))}
      </div>
      <div className="rounded-lg border border-border/50 bg-card px-3 py-1">
        {defs.map((def) =>
          draft ? (
            <div key={def.key} className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">{def.label}</span>
              {def.type === 'boolean' ? (
                <Select
                  value={draft[def.key] || 'unset'}
                  onValueChange={(v) => setDraft({ ...draft, [def.key]: v === 'unset' ? '' : v })}
                >
                  <SelectTrigger className="h-8 flex-1 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not set</SelectItem>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={draft[def.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [def.key]: e.target.value })}
                  type={def.type === 'number' || def.type === 'currency' ? 'number' : 'text'}
                  placeholder={def.type === 'date' ? 'YYYY-MM-DD' : 'Not set'}
                  className="h-8 text-sm"
                />
              )}
            </div>
          ) : (
            <FieldRow key={def.key} label={def.label}>
              {values[def.key] != null ? (
                def.type === 'currency' && typeof values[def.key] === 'number' ? (
                  (values[def.key] as number).toLocaleString('en-US', {
                    style: 'currency',
                    currency: def.currencyCode ?? 'USD',
                  })
                ) : (
                  valueAsString(def.key)
                )
              ) : (
                <span className="text-muted-foreground/60">Not set</span>
              )}
            </FieldRow>
          )
        )}
        {extraEntries.map(([key, value]) => (
          <FieldRow key={key} label={key}>
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </FieldRow>
        ))}
      </div>
    </div>
  )
}

interface CompanyDetailProps {
  companyId: string
  onClose: () => void
  canManage: boolean
}

export function CompanyDetail({ companyId, onClose, canManage }: CompanyDetailProps) {
  const queryClient = useQueryClient()
  const keys = companyKeys(companyId)
  const { data: company, isLoading } = useQuery({
    queryKey: keys.detail,
    queryFn: () => getCompanyFn({ data: { id: companyId } }),
  })

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [draft, setDraft] = useState<StandardFieldsDraft | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const startEditing = () => {
    if (!company) return
    setEditName(company.name)
    setDraft(draftFromCompany(company))
    setIsEditing(true)
  }

  const saveEdits = async () => {
    if (!company || !draft) return
    const name = editName.trim()
    if (!name) {
      toast.error('Company name is required')
      return
    }
    const spend = draft.monthlySpend.trim()
    const mrrCents = spend === '' ? null : Math.round(Number(spend) * 100)
    if (mrrCents != null && Number.isNaN(mrrCents)) {
      toast.error('Monthly spend must be a number')
      return
    }
    setSaving(true)
    try {
      await updateCompanyFn({
        data: {
          id: company.id,
          name,
          domain: draft.domain.trim() || null,
          externalId: draft.externalId.trim() || null,
          plan: draft.plan.trim() || null,
          mrrCents,
          size: draft.size.trim() || null,
          website: draft.website.trim() || null,
          industry: draft.industry.trim() || null,
        },
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.detail }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'company', 'for-principal'] }),
      ])
      setIsEditing(false)
      toast.success('Company updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update company')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!company) return
    try {
      await deleteCompanyFn({ data: { id: company.id } })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] })
      toast.success('Company deleted')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete company')
    }
  }

  const backHeader = (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
      <Button variant="ghost" size="sm" onClick={onClose}>
        <ArrowLeftIcon className="h-4 w-4 mr-1.5" />
        Back to companies
      </Button>
    </div>
  )

  if (isLoading || !company) {
    return (
      <div className="max-w-5xl mx-auto w-full">
        {backHeader}
        <div className="p-4 space-y-6">
          <div className="flex items-start gap-4">
            <Skeleton className="h-14 w-14 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      {backHeader}
      <div className="p-4 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted">
            <BuildingOffice2Icon className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 max-w-sm text-base font-semibold"
                autoFocus
              />
            ) : (
              <h2 className="truncate text-lg font-semibold text-foreground">{company.name}</h2>
            )}
            <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="min-w-0 truncate">
                {company.domain ?? 'No domain'} · Created{' '}
                <TimeAgo date={new Date(company.createdAt)} />
              </span>
              <SourceBadge source={company.source} />
            </p>
          </div>
          {canManage && !isEditing && (
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={startEditing}>
                <PencilIcon className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          {isEditing && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setIsEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-8" onClick={saveEdits} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>

        {/* Standard fields */}
        <div className="rounded-lg border border-border/50 bg-card px-3 py-1">
          {isEditing && draft ? (
            <div className="space-y-3 py-2">
              {(
                [
                  { key: 'domain', label: 'Email domain', placeholder: 'acme.com' },
                  { key: 'externalId', label: 'External ID', placeholder: 'crm-123' },
                  { key: 'plan', label: 'Plan', placeholder: 'Scale' },
                  { key: 'monthlySpend', label: 'Monthly spend (USD)', placeholder: '499' },
                  { key: 'size', label: 'Size', placeholder: '11-50' },
                  { key: 'website', label: 'Website', placeholder: 'https://acme.com' },
                  { key: 'industry', label: 'Industry', placeholder: 'SaaS' },
                ] as const
              ).map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-muted-foreground">{field.label}</span>
                  <Input
                    value={draft[field.key]}
                    onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    type={field.key === 'monthlySpend' ? 'number' : 'text'}
                    className="h-8 text-sm"
                  />
                </div>
              ))}
            </div>
          ) : (
            <>
              <FieldRow label="Plan">
                {company.plan ?? <span className="text-muted-foreground/60">Not set</span>}
              </FieldRow>
              <FieldRow label="Monthly spend">{formatMonthlySpend(company.mrrCents)}</FieldRow>
              <FieldRow label="Size">
                {company.size ?? <span className="text-muted-foreground/60">Not set</span>}
              </FieldRow>
              <FieldRow label="Website">
                {company.website ?? <span className="text-muted-foreground/60">Not set</span>}
              </FieldRow>
              <FieldRow label="Industry">
                {company.industry ?? <span className="text-muted-foreground/60">Not set</span>}
              </FieldRow>
              <FieldRow label="External ID">
                {company.externalId ?? <span className="text-muted-foreground/60">Not set</span>}
              </FieldRow>
            </>
          )}
        </div>

        {/* Custom attributes */}
        <CompanyAttributesPanel company={company} canManage={canManage} />

        {/* Members */}
        <MembersSection companyId={company.id as CompanyId} canManage={canManage} />

        {/* Activity rollups */}
        <ActivitySection companyId={company.id as CompanyId} />
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete "${company.name}"?`}
        description="People linked to this company will be detached. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
