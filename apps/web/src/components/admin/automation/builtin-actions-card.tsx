import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { assistantQueries } from '@/lib/client/queries/assistant'
import type { AssistantAgentKind } from '@/lib/shared/assistant/config'

/**
 * A static, read-only audited list of Quinn's built-in tools (QUINN-TWO-AGENT-SPEC
 * D14): built-ins have no admin modes, so this card is presentation-only.
 */
export function BuiltInActionsCard({ agent }: { agent: AssistantAgentKind }) {
  const intl = useIntl()
  const toolsQuery = useQuery(assistantQueries.tools())

  const title = intl.formatMessage({
    id: 'automation.actions.builtin.title',
    defaultMessage: 'Built-in actions',
  })

  if (toolsQuery.isError) {
    return (
      <SettingsCard title={title}>
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.actions.builtin.loadError',
              defaultMessage: 'Built-in actions could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void toolsQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      </SettingsCard>
    )
  }

  if (toolsQuery.isPending) {
    return (
      <SettingsCard title={title}>
        <p role="status" className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.actions.builtin.loading',
            defaultMessage: 'Loading built-in actions…',
          })}
        </p>
      </SettingsCard>
    )
  }

  const tools = toolsQuery.data ?? []
  const description =
    agent === 'copilot'
      ? intl.formatMessage({
          id: 'automation.actions.builtin.description.copilot',
          defaultMessage:
            'Quinn Copilot calls these on request when a teammate asks for something that needs a write. They are audited and not individually configurable.',
        })
      : intl.formatMessage({
          id: 'automation.actions.builtin.description.agent',
          defaultMessage:
            'Quinn Agent runs these autonomously as part of a reply. They are audited and not individually configurable.',
        })

  return (
    <SettingsCard title={title} description={description}>
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.actions.builtin.empty',
            defaultMessage: 'No built-in actions are available.',
          })}
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {tools.map((tool) => (
            <div key={tool.name} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium">{tool.label}</h3>
                  <Badge
                    size="sm"
                    variant={tool.risk === 'write' ? 'outline' : 'secondary'}
                    shape="pill"
                  >
                    {tool.risk === 'write'
                      ? intl.formatMessage({
                          id: 'automation.actions.builtin.risk.write',
                          defaultMessage: 'Write',
                        })
                      : intl.formatMessage({
                          id: 'automation.actions.builtin.risk.read',
                          defaultMessage: 'Read',
                        })}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  )
}
