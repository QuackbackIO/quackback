export type AutomaticBrandingStatus = {
  domain: string
  pendingActionId: string | null
  status: 'pending' | 'applied' | 'undone' | 'skipped' | 'failed'
  canUndo: boolean
}
