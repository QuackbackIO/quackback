# Quackback Enterprise Edition

This directory contains proprietary Enterprise Edition features for Quackback.

## Features

| Package               | Description                                     |
| --------------------- | ----------------------------------------------- |
| `@quackback/ee-sso`   | SSO/SAML authentication with identity providers |
| `@quackback/ee-scim`  | SCIM 2.0 user provisioning                      |
| `@quackback/ee-audit` | Comprehensive audit logging for compliance      |

## License

The code in this directory is **proprietary** and requires an Enterprise License.

See [LICENSE](./LICENSE) for terms.

## Getting a License

Contact [enterprise@quackback.io](mailto:enterprise@quackback.io) to purchase an Enterprise License.

## Usage

Enterprise features are automatically enabled when:

1. A valid `ENTERPRISE_LICENSE_KEY` is configured
2. The EE packages are installed

```bash
# Set your license key in .env
ENTERPRISE_LICENSE_KEY="your-license-key"
```

## Development

EE packages follow the same patterns as core packages:

```
ee/packages/{name}/
├── package.json          # @quackback/ee-{name}
├── src/
│   └── index.ts          # Main exports
└── README.md
```

## Open Source Alternative

The core Quackback platform is open source under AGPL-3.0.
Self-hosted Community edition includes all features except:

- SSO/SAML
- SCIM provisioning
- Audit logs

See the main [README](../README.md) for the open source version.
