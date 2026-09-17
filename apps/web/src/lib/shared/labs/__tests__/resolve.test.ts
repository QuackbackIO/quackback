import { describe, expect, it } from 'vitest'
import { NEW_WORKSPACE_LAB_DEFAULTS, REFINED_VISUAL_THEME_ID } from '../registry'
import {
  experimentStateMap,
  getExperimentState,
  projectVisibleExperiments,
  resolveExperimentState,
  resolveVisualTheme,
} from '../resolve'

describe('NEW_WORKSPACE_LAB_DEFAULTS', () => {
  it('turns Refreshed UI on for a newly created workspace', () => {
    expect(NEW_WORKSPACE_LAB_DEFAULTS).toEqual([
      { experimentId: REFINED_VISUAL_THEME_ID, visible: true, enabled: true },
    ])
  })
})

describe('resolveExperimentState', () => {
  it('treats missing rows and non-true values as both false', () => {
    expect(resolveExperimentState(undefined)).toEqual({ visible: false, enabled: false })
    expect(resolveExperimentState(null)).toEqual({ visible: false, enabled: false })
    expect(resolveExperimentState({})).toEqual({ visible: false, enabled: false })
    expect(
      resolveExperimentState({
        visible: 1 as unknown as boolean,
        enabled: 'true' as unknown as boolean,
      })
    ).toEqual({
      visible: false,
      enabled: false,
    })
  })

  it('requires strict booleans', () => {
    expect(resolveExperimentState({ visible: true, enabled: true })).toEqual({
      visible: true,
      enabled: true,
    })
  })
})

describe('resolveVisualTheme', () => {
  it('stays legacy unless the registered theme experiment is enabled', () => {
    expect(resolveVisualTheme(new Map())).toBe('legacy')
    expect(
      resolveVisualTheme(
        experimentStateMap([
          { experimentId: REFINED_VISUAL_THEME_ID, visible: true, enabled: false },
        ])
      )
    ).toBe('legacy')
    expect(
      resolveVisualTheme(
        experimentStateMap([
          { experimentId: REFINED_VISUAL_THEME_ID, visible: true, enabled: true },
        ])
      )
    ).toBe('refined')
  })

  it('keeps the theme active when the experiment is hidden but enabled', () => {
    expect(
      resolveVisualTheme(
        experimentStateMap([
          { experimentId: REFINED_VISUAL_THEME_ID, visible: false, enabled: true },
        ])
      )
    ).toBe('refined')
  })

  it('never activates from an unknown id', () => {
    expect(
      resolveVisualTheme(
        experimentStateMap([
          { experimentId: 'not-a-real-experiment', visible: true, enabled: true },
        ])
      )
    ).toBe('legacy')
    expect(getExperimentState(new Map(), 'not-a-real-experiment')).toEqual({
      visible: false,
      enabled: false,
    })
  })
})

describe('projectVisibleExperiments', () => {
  it('omits hidden and unknown experiments, including hidden+enabled', () => {
    const states = experimentStateMap([
      { experimentId: REFINED_VISUAL_THEME_ID, visible: false, enabled: true },
      { experimentId: 'not-registered', visible: true, enabled: true },
    ])
    expect(projectVisibleExperiments(states)).toEqual([])
  })

  it('projects a visible registered experiment without exposing operator metadata', () => {
    const cards = projectVisibleExperiments(
      experimentStateMap([{ experimentId: REFINED_VISUAL_THEME_ID, visible: true, enabled: false }])
    )
    expect(cards).toEqual([
      {
        id: REFINED_VISUAL_THEME_ID,
        title: 'Refreshed UI',
        description: 'A quieter look with tighter spacing, solid icons, and simpler surfaces.',
        enabled: false,
      },
    ])
    expect(JSON.stringify(cards)).not.toContain('visible')
  })
})
