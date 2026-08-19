/**
 * "Create from template" gallery for the workflows list (support platform
 * §4.6). A left category rail filters the card grid; picking a card hands the
 * template's prebuilt payload back to the caller, which creates the workflow
 * and navigates to the builder. Templates that need workspace-specific setup
 * (a team, SLA policy, or tag) still create fine -- see workflow-templates.ts
 * for why -- they just need a follow-up edit before going live.
 */
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/shared/utils'
import {
  WORKFLOW_TEMPLATE_CATEGORIES,
  workflowTemplatesByCategory,
  type WorkflowTemplate,
  type WorkflowTemplateCategory,
} from './workflow-templates'

interface WorkflowTemplateGalleryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (template: WorkflowTemplate) => void
}

export function WorkflowTemplateGallery({
  open,
  onOpenChange,
  onSelect,
}: WorkflowTemplateGalleryProps) {
  const [category, setCategory] = useState<WorkflowTemplateCategory>('popular')
  const templates = workflowTemplatesByCategory(category)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Create a new workflow</DialogTitle>
          <DialogDescription>
            Start from a template and adjust it, or build one from scratch.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[26rem]">
          <nav className="w-44 shrink-0 space-y-0.5 border-r bg-muted/30 p-3">
            {WORKFLOW_TEMPLATE_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                className={cn(
                  'w-full rounded-md px-3 py-1.5 text-left text-sm font-medium transition-colors',
                  category === c.key
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <TemplateCard key={template.id} template={template} onSelect={onSelect} />
              ))}
              {templates.length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground">
                  No templates in this category yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: WorkflowTemplate
  onSelect: (template: WorkflowTemplate) => void
}) {
  const Icon = template.icon
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="flex flex-col gap-2 rounded-lg border p-3.5 text-left transition-colors hover:border-primary hover:shadow-sm"
    >
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg',
          template.iconClassName
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-sm font-semibold leading-tight">{template.title}</div>
      <span className="self-start rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {template.benefit}
      </span>
      <div className="mt-auto border-t pt-2 text-xs text-muted-foreground">
        {template.stepsSummary}
      </div>
    </button>
  )
}
