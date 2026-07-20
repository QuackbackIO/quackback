import type { ExternalStatusItem } from '../types'

/** Fetch Shortcut workflow states (all workflows, flattened) for the status-mapping UI. */
export async function fetchShortcutStates(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const response = await fetch('https://api.app.shortcut.com/api/v3/workflows', {
    headers: {
      'Shortcut-Token': params.accessToken,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) return []
  const workflows = (await response.json()) as Array<{
    states?: Array<{ id: number; name: string }>
  }>

  // Flatten all workflow states
  const states: ExternalStatusItem[] = []
  for (const workflow of workflows) {
    for (const state of workflow.states ?? []) {
      states.push({ id: state.name, name: state.name })
    }
  }
  return states
}
