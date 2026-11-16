/**
 * Shared step visuals used by the inspector (step palette, per-step editor
 * headers) and the confirm-delete dialog reused by the branch editor. Split
 * out so the inspector doesn't have to import the step list just for an icon
 * map — these are the flat, single-tint icons used in inspector chrome,
 * distinct from the step cards' per-tone tiles.
 */
import {
  AdjustmentsHorizontalIcon,
  ArrowUturnLeftIcon,
  BoltIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
  FaceSmileIcon,
  FlagIcon,
  MoonIcon,
  NoSymbolIcon,
  PaperAirplaneIcon,
  RectangleStackIcon,
  ShieldCheckIcon,
  SignalIcon,
  SparklesIcon,
  TagIcon,
  TicketIcon,
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
  add_note: DocumentTextIcon,
  set_ticket_status: TicketIcon,
  convert_to_ticket: TicketIcon,
  send_webhook: PaperAirplaneIcon,
}

/** Icons for the 8 conversational block kinds (Phase C, slice C-5) — every
 *  one of them is customer-facing (or, for disable_composer, a direct effect
 *  on the customer's composer), so they share a family look distinct from
 *  the internal action/condition/wait/branch steps. */
export const BLOCK_ICONS: Record<BlockStepKind, typeof BoltIcon> = {
  message: ChatBubbleLeftRightIcon,
  send_ticket_form: TicketIcon,
  show_reply_time: SignalIcon,
  let_assistant_answer: SparklesIcon,
  disable_composer: NoSymbolIcon,
  reply_buttons: RectangleStackIcon,
  collect_data: ClipboardDocumentListIcon,
  collect_reply: ChatBubbleLeftEllipsisIcon,
  request_csat: FaceSmileIcon,
}

export const GATE_TINT = 'bg-muted text-foreground'
export const STEP_TINT = 'bg-muted text-muted-foreground'

/** The icon tile every step kind and tone shares: the soft fill with ink, per the admin's
 *  neutral category rule. A step's kind is carried by its icon and label. */
export const STEP_TILE = GATE_TINT

/** The label tab above a flow's first step. */
export const START_TAG = STEP_TILE

/** The dashed box a branch rule is drawn in on the canvas. */
export const RULE_BOX = `border-border ${STEP_TILE}`

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
