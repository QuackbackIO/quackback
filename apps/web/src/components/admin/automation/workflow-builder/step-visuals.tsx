/**
 * Shared step visuals used by the inspector (step palette, per-step editor
 * headers) and the confirm-delete dialog reused by the branch editor. Split
 * out from canvas.tsx so the inspector doesn't have to import the React Flow
 * canvas module just for an icon map — these are the flat, single-tint icons
 * used in inspector chrome, distinct from the canvas cards' per-tone tiles.
 */
import {
  AdjustmentsHorizontalIcon,
  ArrowUturnLeftIcon,
  BoltIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  FaceSmileIcon,
  FlagIcon,
  MoonIcon,
  NoSymbolIcon,
  RectangleStackIcon,
  ShieldCheckIcon,
  SignalIcon,
  SparklesIcon,
  TagIcon,
  UserGroupIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ActionType, BlockStepKind } from '../workflow-graph'
import type { Tone } from './flow-layout'

export const ACTION_ICONS: Record<ActionType, typeof BoltIcon> = {
  assign_agent: UserPlusIcon,
  assign_team: UserGroupIcon,
  add_tag: TagIcon,
  remove_tag: TagIcon,
  set_priority: FlagIcon,
  snooze: MoonIcon,
  close: CheckCircleIcon,
  reopen: ArrowUturnLeftIcon,
  apply_sla: ShieldCheckIcon,
  set_attribute: AdjustmentsHorizontalIcon,
}

/** Icons for the 8 conversational block kinds (Phase C, slice C-5) — every
 *  one of them is customer-facing (or, for disable_composer, a direct effect
 *  on the customer's composer), so they share a family look distinct from
 *  the internal action/condition/wait/branch steps (see TONE_TILE's 'pink'). */
export const BLOCK_ICONS: Record<BlockStepKind, typeof BoltIcon> = {
  message: ChatBubbleLeftRightIcon,
  show_reply_time: SignalIcon,
  let_assistant_answer: SparklesIcon,
  disable_composer: NoSymbolIcon,
  reply_buttons: RectangleStackIcon,
  collect_data: ClipboardDocumentListIcon,
  collect_reply: ChatBubbleLeftEllipsisIcon,
  request_csat: FaceSmileIcon,
}

export const GATE_TINT = 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
export const STEP_TINT = 'bg-muted text-muted-foreground'

/** Per-tone icon tile classes shared by the canvas cards and the step
 *  palette, so a step's tone reads the same in both places. 'pink' is the
 *  conversational-block family (see BLOCK_ICONS) — a distinct visual
 *  treatment for customer-facing steps vs. the internal action/branch/wait
 *  vocabulary, per the design brief's §4. */
export const TONE_TILE: Record<Tone, string> = {
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  pink: 'bg-pink-500/10 text-pink-700 dark:text-pink-300',
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
