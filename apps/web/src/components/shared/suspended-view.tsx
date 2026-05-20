import { FriendlyShell } from './error-page'

export type WorkspaceState = 'active' | 'suspended' | 'deleting'

interface SuspendedViewProps {
  state: WorkspaceState
}

/**
 * Generic overlay rendered by __root.tsx whenever the workspace
 * state is anything other than `active`. Copy stays state-agnostic
 * so a visitor hitting a deleted, suspended, or paused workspace
 * sees the same neutral message instead of leaking the specific
 * lifecycle stage. The URL stays unchanged so a flip back to
 * active renders the real workspace on the next pass.
 */
export function SuspendedView(_props: SuspendedViewProps) {
  return (
    <FriendlyShell>
      <h1 className="text-2xl font-semibold tracking-tight">This workspace is unavailable.</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        It may have been deleted or disabled by its admin. If this is unexpected, please contact the
        workspace admin.
      </p>
    </FriendlyShell>
  )
}
