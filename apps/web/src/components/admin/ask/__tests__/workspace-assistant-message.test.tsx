// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it } from 'vitest'
import { WorkspaceAssistantMessage } from '../workspace-assistant-message'
import messages from '@/locales/en.json'

afterEach(cleanup)
const article = { type: 'article', id: 'acme-refunds', title: 'Refund policy', url: '/hc/refunds' }

it('shows cited knowledge with the shared source links and expandable list', () => {
  render(
    <IntlProvider locale="en" messages={messages}>
      <WorkspaceAssistantMessage text="Our policy is here [1]." citations={[article]} />
    </IntlProvider>
  )
  expect(screen.getByRole('link', { name: 'Source 1: Refund policy' })).toHaveAttribute(
    'href',
    '/hc/refunds'
  )
  const sources = screen.getByRole('button', { name: 'Searched the knowledge base · 1 source' })
  expect(sources).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(sources)
  expect(screen.getByRole('link', { name: '1 Refund policy' })).toHaveAttribute(
    'href',
    '/hc/refunds'
  )
})

it('preserves citation numbers when a persisted payload contains an invalid source', () => {
  render(
    <IntlProvider locale="en" messages={messages}>
      <WorkspaceAssistantMessage
        text="This policy [2] applies."
        citations={[{ title: 'Invalid source' }, article]}
      />
    </IntlProvider>
  )
  expect(screen.getByRole('link', { name: 'Source 2: Refund policy' })).toHaveAttribute(
    'href',
    '/hc/refunds'
  )
  expect(screen.queryByRole('link', { name: 'Source 1: Refund policy' })).toBeNull()
  expect(screen.queryByText('Invalid source')).toBeNull()
})

it('never links an unsafe citation URL', () => {
  render(
    <IntlProvider locale="en" messages={messages}>
      <WorkspaceAssistantMessage
        text="Read this [1]."
        citations={[{ ...article, url: 'javascript:alert(1)' }]}
      />
    </IntlProvider>
  )
  expect(screen.queryByRole('link')).toBeNull()
})
