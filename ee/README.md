# Quackback Enterprise Edition

This directory contains enterprise-only features for Quackback.

## License

The code in this directory is proprietary and requires a valid Enterprise license.
See [LICENSE](./LICENSE) for details.

The main Quackback codebase is licensed under AGPL-3.0.

## Enterprise Features

| Package      | Description                       | Tier       |
| ------------ | --------------------------------- | ---------- |
| `license`    | License validation and management | All        |
| `sso`        | SSO/SAML authentication           | Team+      |
| `scim`       | SCIM user provisioning            | Team+      |
| `audit-logs` | Extended audit logging            | Enterprise |
| `analytics`  | Advanced analytics dashboard      | Enterprise |

## Installation

Enterprise packages are only loaded when a valid license is present.
No additional installation steps are required.

## Development

```bash
# Run from repository root
bun run dev
```

Enterprise features are automatically enabled when:

1. A valid license key is present in the database
2. The organization's tier includes the feature

## Support

Enterprise customers receive priority support:

- Email: enterprise@quackback.io
- SLA: 4-hour response time (business hours)
