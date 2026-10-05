// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light' }) }))

import { Toaster, useToasterLocale } from '../sonner'

afterEach(cleanup)

it('names the notifications region in the page language', () => {
  const { container } = render(<Toaster locale="de" />)
  expect(container.querySelector('section')?.getAttribute('aria-label')).toMatch(
    /^Benachrichtigungen /
  )
})

function AdminSurface({ locale }: { locale: string }) {
  useToasterLocale(locale)
  return null
}

it('follows a surface that picks its own language, and lets go when it unmounts', () => {
  const { container, rerender } = render(
    <>
      <Toaster locale="en" />
      <AdminSurface locale="nl" />
    </>
  )
  const label = () => container.querySelector('section')?.getAttribute('aria-label')
  expect(label()).toMatch(/^Meldingen /)
  rerender(<Toaster locale="en" />)
  expect(label()).toMatch(/^Notifications /)
})
