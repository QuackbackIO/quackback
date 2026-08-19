// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  AssistantDirtyStateProvider,
  type AssistantSettingsTab,
  useAssistantDirtyState,
  useUnsavedChanges,
} from '../assistant-form'

afterEach(cleanup)

function DirtyForm({ label, tab }: { label: string; tab: AssistantSettingsTab }) {
  const [dirty, setDirty] = useState(false)
  useUnsavedChanges(dirty, tab)
  return <button onClick={() => setDirty((current) => !current)}>{label}</button>
}

function DirtySummary() {
  const { dirtyTabs, hasUnsavedChanges } = useAssistantDirtyState()
  return (
    <output>
      {hasUnsavedChanges ? 'Unsaved' : 'Clean'}: {Array.from(dirtyTabs).join(',')}
    </output>
  )
}

it('tracks multiple dirty forms without clearing a tab prematurely', () => {
  render(
    <AssistantDirtyStateProvider>
      <DirtyForm label="Identity form" tab="basics" />
      <DirtyForm label="Voice form" tab="basics" />
      <DirtySummary />
    </AssistantDirtyStateProvider>
  )

  expect(screen.getByText('Clean:')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Identity form' }))
  fireEvent.click(screen.getByRole('button', { name: 'Voice form' }))
  expect(screen.getByText('Unsaved: basics')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Identity form' }))
  expect(screen.getByText('Unsaved: basics')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Voice form' }))
  expect(screen.getByText('Clean:')).toBeInTheDocument()
})
