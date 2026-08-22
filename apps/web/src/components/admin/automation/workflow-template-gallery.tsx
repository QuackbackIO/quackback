/**
 * "Create from template" gallery. Category rail + cards that show trigger,
 * class, and the dependencies the admin will hit after create.
 */
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useRouteContext } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/shared/utils'
import {
  WORKFLOW_TEMPLATE_CATEGORIES,
  templateGalleryChips,
  workflowTemplateCategoryCount,
  workflowTemplatesByCategory,
  type TemplateGalleryChip,
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
  const intl = useIntl()
  const [category, setCategory] = useState<WorkflowTemplateCategory>('popular')
  const templates = workflowTemplatesByCategory(category)
  const { settings } = useRouteContext({ from: '__root__' })
  const assistant = settings?.publicWidgetConfig?.messenger?.assistant
  const quinnOn = Boolean(assistant?.enabled && assistant?.respond)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[660px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-0 space-y-1">
          <DialogTitle>
            {intl.formatMessage({
              id: 'automation.templates.galleryTitle',
              defaultMessage: 'Start from a template',
            })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({
              id: 'automation.templates.galleryDescription',
              defaultMessage:
                'Ready-made workflows for the things every team automates. Created as a draft; anything marked "needs setup" is flagged until you point it at your own teams and options.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[26rem] gap-4 px-5 pb-4 pt-3.5">
          <nav
            className="flex w-32 shrink-0 flex-col gap-px"
            aria-label={intl.formatMessage({
              id: 'automation.templates.categories',
              defaultMessage: 'Template categories',
            })}
          >
            {WORKFLOW_TEMPLATE_CATEGORIES.map((c) => {
              const count = workflowTemplateCategoryCount(c.key)
              const selected = category === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  className={cn(
                    'flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors',
                    selected
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  {intl.formatMessage({ id: c.labelId, defaultMessage: c.label })}
                  <span className="text-[11px] font-medium text-muted-foreground">{count}</span>
                </button>
              )
            })}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 content-start gap-2.5 sm:grid-cols-2">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  chips={templateGalleryChips(template, { quinnOn })}
                  onSelect={onSelect}
                />
              ))}
              {templates.length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground">
                  {intl.formatMessage({
                    id: 'automation.templates.emptyCategory',
                    defaultMessage: 'No templates in this category yet.',
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function chipClass(chip: TemplateGalleryChip): string {
  if (chip.kind === 'class' && chip.label === 'Customer facing') {
    return 'border-transparent bg-pink-500/10 text-pink-700 dark:text-pink-300'
  }
  if (chip.kind === 'prereq') {
    return 'border-transparent bg-amber-500/10 text-amber-800 dark:text-amber-300'
  }
  if (chip.kind === 'setup') {
    return 'border-transparent bg-violet-500/10 text-violet-700 dark:text-violet-300'
  }
  return 'border-transparent bg-muted text-muted-foreground'
}

function TemplateCard({
  template,
  chips,
  onSelect,
}: {
  template: WorkflowTemplate
  chips: TemplateGalleryChip[]
  onSelect: (template: WorkflowTemplate) => void
}) {
  const Icon = template.icon

  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="flex flex-col rounded-[11px] border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'grid size-[26px] shrink-0 place-items-center rounded-lg',
            template.iconClassName
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="text-[13px] font-semibold leading-tight">{template.title}</span>
      </div>
      <p className="mt-1.5 mb-2 text-[11px] leading-snug text-muted-foreground">
        {template.benefit}
      </p>
      <div className="mt-auto flex flex-wrap gap-1">
        {chips.map((chip) => (
          <Badge
            key={`${chip.kind}-${chip.label}`}
            size="sm"
            variant="outline"
            className={cn('font-medium', chipClass(chip))}
          >
            {chip.label}
          </Badge>
        ))}
      </div>
    </button>
  )
}
