// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { Profiler } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light' }) }))

import { Toaster } from '../sonner'
import { useToasterLocale } from '../use-toaster-locale'

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

it('follows a surface that picks its own language, and lets go when it unmounts', async () => {
  const { container, rerender } = render(
    <>
      <Toaster locale="en" />
      <AdminSurface locale="nl" />
    </>
  )
  const label = () => container.querySelector('section')?.getAttribute('aria-label')
  await waitFor(() => expect(label()).toMatch(/^Meldingen /))
  rerender(<Toaster locale="en" />)
  expect(label()).toMatch(/^Notifications /)
})

it('does not render again when a surface picks the language the page already has', async () => {
  let commits = 0
  render(
    <>
      <Profiler id="toaster" onRender={() => commits++}>
        <Toaster locale="en" />
      </Profiler>
      <AdminSurface locale="en" />
    </>
  )
  // Let the surface reach the toaster before counting.
  await import('../sonner')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(commits).toBe(1)
})
