export const VISUAL_THEME_VALUES = ['legacy', 'refined'] as const
export type VisualTheme = (typeof VISUAL_THEME_VALUES)[number]

export const LABS_SCOPES = ['workspace'] as const
export type LabsScope = (typeof LABS_SCOPES)[number]

export interface LabsExperimentDefinition {
  id: string
  title: string
  description: string
  scope: LabsScope
}

export interface ExperimentState {
  visible: boolean
  enabled: boolean
}

export interface VisibleExperiment {
  id: string
  title: string
  description: string
  enabled: boolean
}

export const DEFAULT_EXPERIMENT_STATE: ExperimentState = {
  visible: false,
  enabled: false,
}

export const DEFAULT_VISUAL_THEME: VisualTheme = 'legacy'
