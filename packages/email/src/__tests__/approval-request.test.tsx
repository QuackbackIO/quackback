import { describe, expect, it } from 'vitest'
import { render } from '@react-email/components'
import { ApprovalRequestEmail } from '../templates/approval-request'

describe('approval request email', () => {
  it('escapes the summary and links to review without a decision capability', async () => {
    const html = await render(
      ApprovalRequestEmail({
        summary: '<script>approve()</script>',
        reviewUrl: 'https://acme.test/admin/approvals/confirm?id=action&d=digest',
        workspaceName: 'Acme',
        preferencesUrl: 'https://acme.test/admin/settings/notifications',
      })
    )
    expect(html).toContain('&lt;script&gt;approve()&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Review request')
    expect(html).toContain('/admin/approvals/confirm?id=action')
    expect(html).toContain('/admin/settings/notifications')
    expect(html).not.toContain('approve=true')
  })
})
