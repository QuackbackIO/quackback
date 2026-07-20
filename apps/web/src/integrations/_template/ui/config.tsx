/**
 * _template config panel (IF WO-12) — the connected-state settings body for a
 * provider. The shared `$type` route (IF WO-6) owns the header, the
 * platform-credentials dialog, the health panel, and the setup card; a provider
 * supplies ONLY this panel (via its registry entry's `renderConfig`) plus its
 * connection-actions component.
 *
 * Reuse the shared building blocks instead of hand-rolling: <DestinationPicker>
 * for routing targets (IF WO-7), <StatusSyncConfig> for status mapping, and the
 * NotificationChannelRouter for notification routing. This example wires a
 * dependent destination pair (project → issue type) to demonstrate the pattern.
 */
import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { DestinationPicker } from '@/components/admin/settings/integrations/shared/destination-picker'

interface TemplateConfigProps {
  integrationId: string
  /** Current stored config (whatever `exchangeCode` + this panel persist). */
  initialConfig: { projectId?: string; issueTypeId?: string }
  enabled: boolean
}

export function TemplateConfig({ initialConfig, enabled }: TemplateConfigProps) {
  const [projectId, setProjectId] = useState(initialConfig.projectId ?? '')
  const [issueTypeId, setIssueTypeId] = useState(initialConfig.issueTypeId ?? '')

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Project</Label>
        <DestinationPicker
          integrationType="template"
          kind="project"
          value={projectId}
          onSelect={(id) => {
            setProjectId(id)
            setIssueTypeId('') // reset the dependent selection when the parent changes
          }}
          disabled={!enabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Issue type</Label>
        <DestinationPicker
          integrationType="template"
          kind="issue-type"
          value={issueTypeId}
          onSelect={setIssueTypeId}
          parentId={projectId}
          disabled={!enabled}
        />
      </div>
    </div>
  )
}
