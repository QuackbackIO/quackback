# @quackback/ee-scim

SCIM 2.0 User Provisioning for Quackback Enterprise.

## Features

- Automatic user provisioning from identity providers
- User deprovisioning (deactivation)
- Group synchronization
- Support for major IdPs:
  - Okta
  - Azure AD (Entra ID)
  - OneLogin
  - Any SCIM 2.0 compliant provider

## SCIM Endpoints

| Method | Endpoint              | Description     |
| ------ | --------------------- | --------------- |
| GET    | `/scim/v2/Users`      | List users      |
| GET    | `/scim/v2/Users/:id`  | Get user        |
| POST   | `/scim/v2/Users`      | Create user     |
| PUT    | `/scim/v2/Users/:id`  | Replace user    |
| PATCH  | `/scim/v2/Users/:id`  | Update user     |
| DELETE | `/scim/v2/Users/:id`  | Deactivate user |
| GET    | `/scim/v2/Groups`     | List groups     |
| POST   | `/scim/v2/Groups`     | Create group    |
| PATCH  | `/scim/v2/Groups/:id` | Update group    |
| DELETE | `/scim/v2/Groups/:id` | Delete group    |

## Configuration

### Generate SCIM Token

1. Navigate to **Settings → Security → SCIM**
2. Click **Generate Token**
3. Copy the token (shown only once)
4. Configure your IdP with:
   - SCIM Base URL: `https://your-domain.com/scim/v2`
   - Bearer Token: (the generated token)

### Okta Setup

1. In Okta Admin, go to **Applications → Your App → Provisioning**
2. Enable SCIM provisioning
3. Enter the SCIM Base URL and Bearer Token
4. Enable desired provisioning features

### Azure AD Setup

1. In Azure Portal, go to **Enterprise Applications → Your App → Provisioning**
2. Set Provisioning Mode to "Automatic"
3. Enter the Tenant URL (SCIM Base URL) and Secret Token
4. Test connection and save

## License

Proprietary - See [ee/LICENSE](../../LICENSE)
