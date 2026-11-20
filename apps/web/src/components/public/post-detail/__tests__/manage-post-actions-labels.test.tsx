// @vitest-environment happy-dom
/**
 * The post modal's Manage icons carry accessible names (the words their
 * tooltips show), so a screen reader and a test can tell them apart.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it } from 'vitest'
import en from '@/locales/en.json'
import { ManagePostActions, type MetadataSidebarManageActions } from '../metadata-sidebar'

afterEach(cleanup)

const noop = () => {}

function mount(actions: MetadataSidebarManageActions) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ManagePostActions actions={actions} />
    </IntlProvider>
  )
}

it('names the merge, lock and delete icons on a live post', () => {
  mount({ onMergeOthers: noop, onMergeInto: noop, onToggleLock: noop, onDelete: noop })
  expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Lock comments' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete post' })).toBeInTheDocument()
})

it('names the unlock and restore icons on a locked, deleted post', () => {
  mount({ onToggleLock: noop, isCommentsLocked: true, onRestore: noop, isDeleted: true })
  expect(screen.getByRole('button', { name: 'Unlock comments' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Restore post' })).toBeInTheDocument()
})
