/**
 * Tests for shared integration display helpers.
 */

import { describe, it, expect } from 'vitest'
import { getIntegrationDisplayName, getIntegrationActionVerb } from '../integrations'

describe('getIntegrationDisplayName', () => {
  it.each([
    ['linear', 'Linear'],
    ['github', 'GitHub'],
    ['jira', 'Jira'],
    ['gitlab', 'GitLab'],
    ['clickup', 'ClickUp'],
    ['asana', 'Asana'],
    ['shortcut', 'Shortcut'],
    ['azure_devops', 'Azure DevOps'],
    ['trello', 'Trello'],
    ['notion', 'Notion'],
    ['monday', 'Monday'],
  ])('returns %s for %s', (type, expected) => {
    expect(getIntegrationDisplayName(type)).toBe(expected)
  })

  it('falls back to raw type for unknown integrations', () => {
    expect(getIntegrationDisplayName('custom_tracker')).toBe('custom_tracker')
  })
})

describe('getIntegrationActionVerb', () => {
  it.each(['github', 'jira', 'gitlab', 'clickup', 'azure_devops'])(
    'returns Close for %s',
    (type) => {
      expect(getIntegrationActionVerb(type)).toBe('Close')
    }
  )

  it.each(['linear', 'asana', 'shortcut', 'trello', 'notion', 'monday'])(
    'returns Archive for %s',
    (type) => {
      expect(getIntegrationActionVerb(type)).toBe('Archive')
    }
  )

  it('returns Archive for unknown integrations', () => {
    expect(getIntegrationActionVerb('something_else')).toBe('Archive')
  })
})
