/**
 * Read-only detail panel rendered when an API key row is expanded. Resolves
 * team and inbox IDs to display names where possible.
 */
import { useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import type { ApiKey } from '@/lib/shared/types'
import { useTeams } from '@/lib/client/hooks/use-teams-queries'
import { useInboxes } from '@/lib/client/hooks/use-inboxes-queries'

interface Props {
  apiKey: ApiKey
}

export function ApiKeyDetailPanel({ apiKey }: Props) {
  const { data: teams = [] } = useTeams({ includeArchived: true })
  const { data: inboxes = [] } = useInboxes({ includeArchived: true })

  const teamMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of teams) m.set(t.id, t.name)
    return m
  }, [teams])
  const inboxMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of inboxes) m.set(i.id, i.name)
    return m
  }, [inboxes])

  const isLegacy = apiKey.compatLegacyFullAccess && (apiKey.scopes ?? []).length === 0

  return (
    <div className="border-t border-border/50 mt-3 pt-3 space-y-3 text-xs">
      <Section label="Scopes">
        {isLegacy ? (
          <Badge variant="destructive">All scopes (legacy)</Badge>
        ) : (apiKey.scopes ?? []).length === 0 ? (
          <span className="text-muted-foreground italic">No scopes</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {apiKey.scopes.map((s) => (
              <Badge key={s} variant="outline" className="font-mono text-[10px]">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Section label="Allowed teams">
        {(apiKey.allowedTeamIds ?? []).length === 0 ? (
          <span className="text-muted-foreground italic">Any team</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {apiKey.allowedTeamIds.map((id) => (
              <Badge key={id} variant="outline">
                {teamMap.get(id) ?? id}
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Section label="Allowed inboxes">
        {(apiKey.allowedInboxIds ?? []).length === 0 ? (
          <span className="text-muted-foreground italic">Any inbox</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {apiKey.allowedInboxIds.map((id) => (
              <Badge key={id} variant="outline">
                {inboxMap.get(id) ?? id}
              </Badge>
            ))}
          </div>
        )}
      </Section>

      <Section label="Usage">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
          <Field
            label="Last used"
            value={
              apiKey.lastUsedAt
                ? formatDistanceToNow(apiKey.lastUsedAt, { addSuffix: true })
                : 'Never'
            }
          />
          <Field label="Last IP" value={apiKey.lastIp ?? '—'} mono />
          <Field
            label="Rotated"
            value={
              apiKey.rotatedAt ? formatDistanceToNow(apiKey.rotatedAt, { addSuffix: true }) : '—'
            }
          />
          <Field
            label="Expires"
            value={
              apiKey.expiresAt
                ? formatDistanceToNow(apiKey.expiresAt, { addSuffix: true })
                : 'Never'
            }
          />
          <Field
            label="Created"
            value={formatDistanceToNow(apiKey.createdAt, { addSuffix: true })}
          />
          {apiKey.lastUserAgent && (
            <Field label="Last UA" value={apiKey.lastUserAgent} mono truncate />
          )}
        </div>
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
  truncate = false,
}: {
  label: string
  value: string
  mono?: boolean
  truncate?: boolean
}) {
  return (
    <div className="space-y-0.5 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-[11px] ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : ''}`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}
