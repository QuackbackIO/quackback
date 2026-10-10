// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it } from 'vitest'
import { SetupSteps } from '../setup-steps'

afterEach(cleanup)

function label(text: string) {
  return screen.getByText(text, { selector: 'span' })
}

// On a phone only the current step keeps its label on screen; the others
// stay for assistive tech. At the end, the step being shown is Ready, so its
// label shows rather than three bare ticks.
it('keeps the current label on a phone, and shows Ready once setup is finished', () => {
  const { rerender } = render(
    <IntlProvider locale="en">
      <SetupSteps current="workspace" />
    </IntlProvider>
  )
  expect(label('Workspace').className).not.toMatch(/max-sm:sr-only/)
  expect(label('Ready').className).toMatch(/max-sm:sr-only/)

  rerender(
    <IntlProvider locale="en">
      <SetupSteps current="ready" finished />
    </IntlProvider>
  )
  expect(label('Ready').className).not.toMatch(/max-sm:sr-only/)
  expect(label('Account').className).toMatch(/max-sm:sr-only/)
})
