# @quackback/ee-sso

Enterprise SSO/SAML authentication for Quackback.

## Features

- SAML 2.0 authentication
- Support for major identity providers:
  - Okta
  - Azure AD (Entra ID)
  - Google Workspace
  - OneLogin
  - Generic SAML

## Installation

This package is included with Quackback Enterprise Edition.

## Configuration

### Environment Variables

```bash
# Enable SSO (requires enterprise license)
ENTERPRISE_LICENSE_KEY="your-license-key"
```

### Admin UI

1. Navigate to **Settings → Security**
2. Click **Add SSO Provider**
3. Select your identity provider
4. Follow the provider-specific setup instructions

## Architecture

This package wraps `@better-auth/sso` to provide:

- Enterprise-grade SAML configuration
- Provider-specific optimizations
- Admin UI components for SSO management

## License

Proprietary - See [ee/LICENSE](../../LICENSE)
