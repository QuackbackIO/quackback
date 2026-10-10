// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { ApiReferenceCard } = await import('../api-reference-card')

afterEach(cleanup)

describe('ApiReferenceCard', () => {
  it('shows the base URL and links to the API reference', () => {
    render(<ApiReferenceCard apiBaseUrl="https://feedback.acme.test/api/v1" />)
    expect(screen.getByText('https://feedback.acme.test/api/v1')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open API reference' })
    expect(link.getAttribute('href')).toBe('/api/v1/docs')
  })

  it('truncates a long base URL at phone width instead of overflowing', () => {
    render(<ApiReferenceCard apiBaseUrl="https://feedback.acme.test/api/v1" />)
    expect(screen.getByText('https://feedback.acme.test/api/v1').className).toMatch(/truncate/)
  })

  it('copies the base URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ApiReferenceCard apiBaseUrl="https://feedback.acme.test/api/v1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy base URL' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://feedback.acme.test/api/v1'))
  })
})
