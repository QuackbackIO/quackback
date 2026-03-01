/**
 * Tests for prompt builder functions.
 * These are pure functions — no mocks needed.
 */

import { describe, it, expect } from 'vitest'
import { buildQualityGatePrompt } from '../prompts/quality-gate.prompt'
import { buildExtractionPrompt } from '../prompts/extraction.prompt'
import { buildSuggestionPrompt } from '../prompts/suggestion.prompt'

describe('buildQualityGatePrompt', () => {
  it('should include source type and content', () => {
    const result = buildQualityGatePrompt({
      sourceType: 'intercom',
      content: { subject: 'CSV Export', text: 'We need CSV export for our data' },
      context: {},
    })

    expect(result).toContain('intercom')
    expect(result).toContain('CSV Export')
    expect(result).toContain('We need CSV export for our data')
  })

  it('should handle missing subject gracefully', () => {
    const result = buildQualityGatePrompt({
      sourceType: 'slack',
      content: { text: 'The app crashes on login' },
      context: {},
    })

    expect(result).toContain('slack')
    expect(result).toContain('The app crashes on login')
  })

  it('should include thread messages when present', () => {
    const result = buildQualityGatePrompt({
      sourceType: 'intercom',
      content: { text: 'Help needed' },
      context: {
        thread: [
          {
            id: '1',
            role: 'customer',
            text: 'Your export feature is broken',
            sentAt: '2024-01-01T00:00:00Z',
          },
          { id: '2', role: 'agent', text: 'Let me check', sentAt: '2024-01-01T00:01:00Z' },
          {
            id: '3',
            role: 'customer',
            text: 'I need it for reporting',
            sentAt: '2024-01-01T00:02:00Z',
          },
        ],
      },
    })

    expect(result).toContain('customer_messages')
    expect(result).toContain('Your export feature is broken')
    expect(result).toContain('I need it for reporting')
    // Agent messages should not appear in customer section
    expect(result).not.toContain('Let me check')
  })
})

describe('buildExtractionPrompt', () => {
  it('should include source type, subject, text, and context', () => {
    const result = buildExtractionPrompt({
      sourceType: 'intercom',
      content: { subject: 'Dark mode', text: 'We need dark mode support' },
      context: { metadata: { voteCount: 5 } },
    })

    expect(result).toContain('intercom')
    expect(result).toContain('Dark mode')
    expect(result).toContain('We need dark mode support')
    expect(result).toContain('voteCount')
  })

  it('should handle missing subject', () => {
    const result = buildExtractionPrompt({
      sourceType: 'api',
      content: { text: 'Please add SSO login' },
      context: {},
    })

    expect(result).toContain('api')
    expect(result).toContain('Please add SSO login')
    // Should not throw
  })
})

describe('buildSuggestionPrompt', () => {
  it('should include signal info and board list', () => {
    const result = buildSuggestionPrompt({
      signal: {
        signalType: 'feature_request',
        summary: 'Users want CSV export',
        implicitNeed: 'Data portability',
        evidence: ['I need to export my data', 'CSV would be great'],
      },
      sourceContent: { subject: 'Export', text: 'We need CSV export' },
      boards: [
        { id: 'board_1', name: 'Feature Requests', slug: 'features' },
        { id: 'board_2', name: 'Bug Reports', slug: 'bugs' },
      ],
    })

    expect(result).toContain('feature_request')
    expect(result).toContain('Users want CSV export')
    expect(result).toContain('Data portability')
    expect(result).toContain('I need to export my data')
    expect(result).toContain('Feature Requests')
    expect(result).toContain('Bug Reports')
  })

  it('should handle empty boards list', () => {
    const result = buildSuggestionPrompt({
      signal: {
        signalType: 'bug_report',
        summary: 'Login page crashes',
        evidence: [],
      },
      sourceContent: { text: 'Login broken' },
      boards: [],
    })

    expect(result).toContain('bug_report')
    expect(result).toContain('Login page crashes')
    // Should not throw
  })
})
