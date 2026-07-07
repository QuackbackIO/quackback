import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { manualSyncTicketFn } from '@/lib/server/functions/tickets'
import { Button } from '@/components/ui/button'
import { ExternalLink, RefreshCw, GitBranch } from 'lucide-react'
import { toast } from 'sonner'

interface TicketLinkedIssuesProps {
  ticketId: TicketId
}

export function TicketLinkedIssues({ ticketId }: TicketLinkedIssuesProps) {
  const queryClient = useQueryClient()
  const { data: links, isLoading } = useQuery(ticketQueries.externalLinks(ticketId))

  const syncMutation = useMutation({
    mutationFn: (params: { integrationId: string; direction: 'push' | 'pull' }) =>
      manualSyncTicketFn({
        data: { ticketId, integrationId: params.integrationId, direction: params.direction },
      }),
    onSuccess: (result: { success: boolean; error?: string }) => {
      if (result.success) {
        toast.success('Sync completed')
        queryClient.invalidateQueries({ queryKey: ['tickets', 'externalLinks', ticketId] })
      } else {
        toast.error(result.error ?? 'Sync failed')
      }
    },
    onError: () => toast.error('Sync failed'),
  })

  if (isLoading || !links?.length) return null

  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        Linked Issues
      </div>
      <div className="space-y-2">
        {links.map((link) => (
          <div
            key={link.id}
            className="flex items-center gap-2 text-sm rounded-md border px-2 py-1.5"
          >
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <a
              href={link.externalUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-foreground hover:underline truncate min-w-0"
            >
              <span className="font-mono text-xs">{link.externalDisplayId}</span>
              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
            </a>
            <span className="text-[10px] text-muted-foreground uppercase shrink-0">
              {link.syncDirection === 'outbound'
                ? '→'
                : link.syncDirection === 'inbound'
                  ? '←'
                  : '↔'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 ml-auto shrink-0"
              disabled={syncMutation.isPending || !link.integrationId}
              onClick={() =>
                link.integrationId &&
                syncMutation.mutate({
                  integrationId: link.integrationId,
                  direction: 'push',
                })
              }
              title="Sync to GitHub"
            >
              <RefreshCw className={`h-3 w-3 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
