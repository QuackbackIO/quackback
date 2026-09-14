import type { LabsExperimentDefinition } from './types'

/**
 * Fixed Labs catalogue. Database rows store only `{ visible, enabled }` for a
 * registered id. Unknown ids never activate features or appear as cards.
 */
export const LABS_REGISTRY = [
  {
    id: 'refined-visual-theme',
    title: 'Refreshed UI',
    description: 'A quieter look with tighter spacing, solid icons, and simpler surfaces.',
    scope: 'workspace',
  },
] as const satisfies readonly LabsExperimentDefinition[]

export type LabsExperimentId = (typeof LABS_REGISTRY)[number]['id']

export const REFINED_VISUAL_THEME_ID = 'refined-visual-theme' satisfies LabsExperimentId

const REGISTRY_BY_ID = new Map<string, LabsExperimentDefinition>(
  LABS_REGISTRY.map((entry) => [entry.id, entry])
)

export function isRegisteredExperimentId(id: string): id is LabsExperimentId {
  return REGISTRY_BY_ID.has(id)
}

export function getRegisteredExperiment(id: string): LabsExperimentDefinition | undefined {
  return REGISTRY_BY_ID.get(id)
}

export function listRegisteredExperiments(): readonly LabsExperimentDefinition[] {
  return LABS_REGISTRY
}
