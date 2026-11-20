// @vitest-environment happy-dom
/**
 * On a slow network the dialog opens at once with its title and a quiet
 * placeholder, so the click visibly worked and a second click does not close
 * an empty dialog.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { createId } from '@quackback/ids'

// The form's chunk never arrives.
vi.mock('../create-post-dialog-content', () => new Promise(() => {}))

import { CreatePostDialog } from '../create-post-dialog'

afterEach(cleanup)

describe('CreatePostDialog while its form loads', () => {
  it('opens a titled dialog with a placeholder', async () => {
    render(
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <CreatePostDialog
          boards={[{ id: createId('board'), name: 'Ideas', slug: 'ideas' } as never]}
          tags={[]}
          statuses={[{ id: createId('post_status'), name: 'Open', isDefault: true } as never]}
          currentUser={
            { principalId: 'principal_1', name: 'Sam', email: 'sam@example.com' } as never
          }
        />
      </IntlProvider>
    )
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'New post' })))
    const dialog = await screen.findByRole('dialog', { name: 'Create new post' })
    expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})
