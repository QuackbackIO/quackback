import {
  getRegisteredExperiment,
  isRegisteredExperimentId,
  REFINED_VISUAL_THEME_ID,
} from './registry'
import {
  DEFAULT_EXPERIMENT_STATE,
  DEFAULT_VISUAL_THEME,
  type ExperimentState,
  type VisibleExperiment,
  type VisualTheme,
} from './types'

export function resolveExperimentState(
  row: Partial<ExperimentState> | null | undefined
): ExperimentState {
  return {
    visible: row?.visible === true,
    enabled: row?.enabled === true,
  }
}

export function experimentStateMap(
  rows: ReadonlyArray<{ experimentId: string; visible: boolean; enabled: boolean }>
): Map<string, ExperimentState> {
  const states = new Map<string, ExperimentState>()
  for (const row of rows) {
    if (!isRegisteredExperimentId(row.experimentId)) continue
    states.set(row.experimentId, resolveExperimentState(row))
  }
  return states
}

export function getExperimentState(
  states: Map<string, ExperimentState> | Readonly<Record<string, ExperimentState>>,
  experimentId: string
): ExperimentState {
  if (!isRegisteredExperimentId(experimentId)) return DEFAULT_EXPERIMENT_STATE
  if (states instanceof Map) return states.get(experimentId) ?? DEFAULT_EXPERIMENT_STATE
  return states[experimentId] ?? DEFAULT_EXPERIMENT_STATE
}

export function resolveVisualTheme(
  states: Map<string, ExperimentState> | Readonly<Record<string, ExperimentState>>
): VisualTheme {
  return getExperimentState(states, REFINED_VISUAL_THEME_ID).enabled
    ? 'refined'
    : DEFAULT_VISUAL_THEME
}

export function projectVisibleExperiments(
  states: Map<string, ExperimentState> | Readonly<Record<string, ExperimentState>>
): VisibleExperiment[] {
  const entries = states instanceof Map ? states : new Map(Object.entries(states))
  const visible: VisibleExperiment[] = []
  for (const [id, state] of entries) {
    if (!state.visible) continue
    const definition = getRegisteredExperiment(id)
    if (!definition) continue
    visible.push({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      enabled: state.enabled === true,
    })
  }
  return visible
}

export function isVisualTheme(value: unknown): value is VisualTheme {
  return value === 'legacy' || value === 'refined'
}
