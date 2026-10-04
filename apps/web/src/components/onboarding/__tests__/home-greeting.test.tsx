// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it } from 'vitest'
import en from '@/locales/en.json'
import { HomeGreeting } from '../home-greeting'

afterEach(cleanup)

function greet(name: string | null, email: string | null) {
  render(
    <IntlProvider locale="en" messages={en}>
      <HomeGreeting name={name} email={email} />
    </IntlProvider>
  )
  return screen.getByRole('heading', { level: 1 }).textContent
}

it('greets by first name, never by email address', () => {
  expect(greet('sam+rev1@northwind.test', 'sam+rev1@northwind.test')).toBe('Welcome, Sam')
  cleanup()
  expect(greet('Jordan Lee', 'jordan@example.com')).toBe('Welcome, Jordan')
  cleanup()
  expect(greet(null, '42@example.com')).toBe('Welcome')
})
