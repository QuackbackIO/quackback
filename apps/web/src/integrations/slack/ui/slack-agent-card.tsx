import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { getSlackAgentSettingsFn, setSlackAssistantEnabledFn } from '../server/agent/settings'
export function SlackAgentCard() {
  const allowed = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['slack-agent-settings'],
    queryFn: () => getSlackAgentSettingsFn(),
    enabled: allowed,
  })
  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      setSlackAssistantEnabledFn({ data: { expectedRevision: query.data!.revision, enabled } }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['slack-agent-settings'] }),
        client.invalidateQueries({ queryKey: ['assistant', 'settings'] }),
      ])
    },
  })
  return (
    <section id="ai-assistant" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="slack-assistant-toggle" className="font-medium">
          AI assistant in Slack
        </Label>
        <Switch
          id="slack-assistant-toggle"
          checked={query.data?.enabled ?? false}
          disabled={
            !allowed ||
            !query.data ||
            save.isPending ||
            (!query.data.enabled && (!query.data.active || query.data.missingScopes.length > 0))
          }
          onCheckedChange={(value) => save.mutate(value)}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Mention @Quackback in a thread, DM it, or use /quackback. Team members can ask questions and
        approve proposed feedback or tickets.
      </p>
      {!allowed && (
        <p className="text-sm text-muted-foreground">
          An administrator with AI settings permission can enable this.
        </p>
      )}
      {query.data && query.data.routing !== 'direct' && (
        <p className="text-xs text-muted-foreground">
          Routing:{' '}
          {query.data.routing === 'registered'
            ? 'registered ✓'
            : query.data.routing === 'unavailable'
              ? 'could not be checked'
              : 'not registered — reconnect Slack'}
        </p>
      )}
      {query.data && query.data.missingScopes.length === 0 && (
        <p className="text-xs text-muted-foreground">Assistant permissions granted ✓</p>
      )}
      {(query.error || save.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(save.error ?? query.error)?.message}
        </p>
      )}
    </section>
  )
}
