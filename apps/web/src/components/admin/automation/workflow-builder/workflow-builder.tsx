/**
 * The fullscreen workflow builder (support platform §4.6): loads the
 * workflow, wires up the shared entity data (teammates/teams/tags/SLA
 * policies/attributes) once for the outline + canvas + inspector, and lays
 * out the three-panel shell — outline rail, canvas (or the JSON textarea),
 * inspector. All the editing state lives in useWorkflowBuilder; this
 * component just wires it to the panels.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { workflowDetailQuery } from '@/lib/client/queries/workflows'
import type { WorkflowDTO } from '@/lib/server/functions/workflows'
import { WorkflowEntitiesProvider } from './entities'
import { WorkflowBuilderTopBar } from './top-bar'
import { OutlineRail } from './outline-rail'
import { WorkflowBuilderCanvas } from './canvas'
import { JsonPanel } from './json-panel'
import { InspectorPanel } from './inspector/inspector-panel'
import { useWorkflowBuilder } from './use-workflow-builder'
import { VersionHistorySheet } from './version-history-sheet'
import { PreviewPanel } from './preview-panel'
import type { FrequencyCap, GraphCondition, SendWindow } from '../workflow-graph'

export function WorkflowBuilder({ workflowId }: { workflowId: string }) {
  const { data: workflow, isLoading } = useQuery(workflowDetailQuery(workflowId))

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">This workflow doesn&apos;t exist anymore.</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/admin/automation/workflows">Back to workflows</Link>
        </Button>
      </div>
    )
  }

  return (
    <WorkflowEntitiesProvider>
      <WorkflowBuilderShell key={workflow.id} workflow={workflow} />
    </WorkflowEntitiesProvider>
  )
}

function WorkflowBuilderShell({ workflow }: { workflow: WorkflowDTO }) {
  const b = useWorkflowBuilder(workflow)
  const stepCount = b.outline.filter((e) => e.kind !== 'path-header' && e.kind !== 'trigger').length

  return (
    <div className="flex h-full flex-col bg-background">
      <WorkflowBuilderTopBar
        name={b.name}
        onChangeName={b.changeName}
        status={b.status}
        workflowClass={b.workflowClass}
        issuesCount={b.issues.count}
        onJumpToFirstIssue={() => {
          if (b.issues.firstId) b.selectNode(b.issues.firstId)
        }}
        mode={b.graphDraft.mode}
        onSetMode={b.setEditorMode}
        dirty={b.dirty}
        saving={b.saving}
        onSave={b.save}
        canGoLive={b.canGoLive}
        onSetLive={b.setLive}
        onPause={b.pause}
        statusPending={b.statusPending}
        outlineCollapsed={b.outlineCollapsed}
        onToggleOutline={b.toggleOutline}
        onOpenHistory={b.openHistorySheet}
        onOpenPreview={b.openPreviewSheet}
      />
      <VersionHistorySheet
        workflowId={workflow.id}
        open={b.historySheetOpen}
        onOpenChange={(open) => (open ? b.openHistorySheet() : b.closeHistorySheet())}
        dirty={b.dirty}
      />
      <PreviewPanel
        workflowId={workflow.id}
        open={b.previewSheetOpen}
        onOpenChange={(open) => (open ? b.openPreviewSheet() : b.closePreviewSheet())}
        dirty={b.dirty}
      />
      <div className="flex min-h-0 flex-1">
        <OutlineRail
          outline={b.outline}
          stepCount={stepCount}
          selection={b.selection}
          collapsed={b.outlineCollapsed}
          onSelectNode={b.selectNode}
        />

        {b.graphDraft.mode === 'visual' ? (
          <WorkflowBuilderCanvas
            tree={b.graphDraft.tree}
            triggerLabel={b.triggerLabelText}
            triggerChannels={b.triggerSettings.channels}
            triggerFrequencyCap={b.triggerSettings.frequencyCap as FrequencyCap | undefined}
            triggerAudience={b.triggerSettings.audience as GraphCondition | undefined}
            triggerSendWindow={b.triggerSettings.sendWindow as SendWindow | undefined}
            selection={b.selection}
            stepIssues={b.stepIssues}
            onSelectNode={b.selectNode}
            onSelectInsertion={b.selectInsertion}
            onRemoveStep={b.removeStep}
          />
        ) : (
          <JsonPanel draft={b.graphDraft} onChange={b.changeGraphDraft} error={b.toggleError} />
        )}

        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border/50 bg-background">
          <InspectorPanel
            mode={b.graphDraft.mode}
            tree={b.graphDraft.mode === 'visual' ? b.graphDraft.tree : null}
            selection={b.selection}
            stepIssues={b.stepIssues}
            triggerType={b.triggerType}
            onChangeTriggerType={b.changeTriggerType}
            triggerSettings={b.triggerSettings}
            onChangeTriggerSettings={b.changeTriggerSettings}
            workflowClass={b.workflowClass}
            onChangeClass={b.changeClass}
            onInsert={b.insertAtSelection}
            onUpdateStep={b.updateSelectedStep}
          />
        </aside>
      </div>
    </div>
  )
}
