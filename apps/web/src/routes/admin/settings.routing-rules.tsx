/**
 * Routing rules admin — list page with drag-reorder, inline enable toggle,
 * and a Sheet drawer for create/edit.
 */
import { Suspense, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import type { InboxId } from '@quackback/ids'
import { routingRuleQueries } from '@/lib/client/queries/routing-rules'
import { Button } from '@/components/ui/button'
import { PlusIcon } from '@heroicons/react/24/outline'
import { InboxPicker } from '@/components/admin/shared/inbox-picker'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { RoutingRuleList } from '@/components/admin/settings/routing/routing-rule-list'
import { RoutingRuleEditorSheet } from '@/components/admin/settings/routing/routing-rule-editor-sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/admin/settings/routing-rules')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await queryClient.ensureQueryData(routingRuleQueries.list({}))
  },
  errorComponent: createRouteErrorComponent('Failed to load routing rules'),
  component: RoutingRulesPage,
})

type ScopeMode = 'all' | 'workspace' | 'inbox'

function RoutingRulesPage() {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all')
  const [inboxScope, setInboxScope] = useState<InboxId | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const inboxIdScope =
    scopeMode === 'workspace'
      ? ('workspace' as const)
      : scopeMode === 'inbox' && inboxScope
        ? inboxScope
        : undefined

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Routing rules</h1>
          <p className="text-xs text-muted-foreground">
            Evaluated first-match-wins on incoming tickets, ordered by priority.
          </p>
        </div>
        <PermissionGate permission={PERMISSIONS.ROUTING_RULE_MANAGE}>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1" />
            New rule
          </Button>
        </PermissionGate>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Scope:</span>
        <Select value={scopeMode} onValueChange={(v) => setScopeMode(v as ScopeMode)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="workspace">Workspace-wide</SelectItem>
            <SelectItem value="inbox">Specific inbox…</SelectItem>
          </SelectContent>
        </Select>
        {scopeMode === 'inbox' && (
          <div className="w-64">
            <InboxPicker
              value={inboxScope}
              onValueChange={setInboxScope}
              allowClear
              placeholder="Pick inbox…"
            />
          </div>
        )}
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RoutingRuleList inboxIdScope={inboxIdScope} />
      </Suspense>

      <RoutingRuleEditorSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
