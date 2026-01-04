# @quackback/ee-audit

Enterprise Audit Logging for Quackback.

## Features

- Comprehensive audit trails for all user actions
- Compliance-ready for SOC 2, GDPR, HIPAA, ISO 27001
- Searchable audit log UI
- Export to CSV/JSON for reporting
- Retention policy configuration

## Logged Events

| Category        | Events                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| **Auth**        | Login, logout, failed attempts, password reset, MFA changes, SSO login |
| **User**        | Create, update, delete, invite, role changes                           |
| **Team**        | Member added/removed, role changes                                     |
| **Post**        | Create, update, delete, status changes                                 |
| **Comment**     | Create, update, delete                                                 |
| **Board**       | Create, update, delete                                                 |
| **Settings**    | Configuration changes, branding, auth config                           |
| **Integration** | Connect, disconnect, config changes                                    |
| **Export**      | Data export started/completed/failed                                   |
| **Admin**       | License updates, SCIM token generation, SSO configuration              |

## Usage

```typescript
import { AuditLogger } from '@quackback/ee-audit'

const logger = new AuditLogger(db)

// Log a successful login
await logger.log({
  event: 'auth.login',
  actor: { id: user.id, email: user.email, ip: request.ip },
  description: 'User logged in successfully',
})

// Log a failed action
await logger.log({
  event: 'post.deleted',
  actor: { id: user.id, email: user.email },
  resource: { type: 'post', id: post.id, name: post.title },
  success: false,
  errorMessage: 'Permission denied',
})
```

## Database Schema

The audit package includes its own database schema (`audit_logs` table) that is kept separate from the main schema for clean EE/OSS separation.

## Admin UI

Access audit logs at **Settings → Security → Audit Logs**:

- Filter by date range, user, category, or resource
- Search within log entries
- Export filtered results

## License

Proprietary - See [ee/LICENSE](../../LICENSE)
