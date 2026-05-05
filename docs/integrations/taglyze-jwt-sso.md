# Integração Taglyze → Quackback: SSO via JWT Assinado

## Objetivo

Permitir que usuários autenticados na Taglyze acessem o Quackback automaticamente, sem login separado, utilizando um token JWT assinado.

Esta implementação usa **auto-provisioning**: se o usuário ainda não existir no Quackback, ele é criado automaticamente no primeiro acesso via JWT.

Nenhum fluxo existente de autenticação do Quackback é desabilitado.

## Endpoint implementado no Quackback

```txt
GET /api/auth/taglyze-sso?token=<JWT>&redirectTo=/opcional
```

Exemplo:

```txt
https://quackback.seudominio.com/api/auth/taglyze-sso?token=JWT&redirectTo=/feedback
```

A rota:

1. recebe o JWT;
2. valida assinatura, `issuer`, `audience`, `exp` e payload mínimo;
3. cria o usuário no Quackback se ele ainda não existir;
4. grava o vínculo Taglyze em `user.metadata`;
5. autentica o usuário via Better Auth;
6. redireciona para `redirectTo` ou `/`;
7. preserva os fluxos atuais de login, magic link, OAuth, OTP e anonymous auth.

## Variáveis de ambiente no Quackback

```env
TAGLYZE_SSO_ENABLED=true
TAGLYZE_JWT_SECRET=coloque_um_segredo_forte_compartilhado
TAGLYZE_JWT_ISSUER=taglyze
TAGLYZE_JWT_AUDIENCE=quackback
```

### Importante

O mesmo valor de `TAGLYZE_JWT_SECRET` precisa estar configurado na Taglyze para assinar os tokens.

## O que precisa estar configurado na Taglyze

A Taglyze precisa gerar um JWT assinado com HS256 e redirecionar o usuário para o Quackback.

### 1. Gerar JWT

Header:

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

Payload mínimo:

```json
{
  "sub": "taglyze_user_123",
  "email": "cliente@empresa.com.br",
  "name": "Cliente Exemplo",
  "iss": "taglyze",
  "aud": "quackback",
  "iat": 1714900000,
  "exp": 1714900600
}
```

Campos obrigatórios:

- `sub`: ID único e estável do usuário na Taglyze;
- `email`: e-mail do usuário;
- `iss`: precisa bater com `TAGLYZE_JWT_ISSUER`;
- `aud`: precisa bater com `TAGLYZE_JWT_AUDIENCE`;
- `iat`: data de emissão;
- `exp`: data de expiração.

Campos opcionais aceitos:

- `name`;
- `picture`;
- `avatar_url`;
- `workspace_id`.

### 2. Redirecionar para o Quackback

Após gerar o token, a Taglyze deve redirecionar para:

```txt
https://quackback.seudominio.com/api/auth/taglyze-sso?token=<JWT>
```

Com destino opcional:

```txt
https://quackback.seudominio.com/api/auth/taglyze-sso?token=<JWT>&redirectTo=/feedback
```

`redirectTo` só aceita caminhos do mesmo domínio. URLs externas são ignoradas e o usuário vai para `/`.

### 3. Tempo de expiração recomendado

Use expiração curta:

```txt
5 minutos
```

Exemplo:

```txt
exp = iat + 300
```

## Auto-provisioning

O Quackback faz o seguinte:

1. normaliza o e-mail;
2. procura usuário existente pelo e-mail;
3. se existir, atualiza o vínculo em `user.metadata`;
4. se não existir, cria uma conta automaticamente;
5. grava o vínculo em `user.metadata`;
6. autentica a conta usando Better Auth.

A senha técnica de provisionamento é derivada de forma determinística usando:

```txt
TAGLYZE_JWT_SECRET + taglyze_user_id + email
```

Essa senha não precisa ser exibida nem conhecida pelo usuário.

## Vínculo Taglyze salvo no usuário

O schema atual do Quackback possui `user.metadata`, portanto esta implementação salva o vínculo externo sem migration nova.

Formato salvo em `user.metadata`:

```json
{
  "taglyze": {
    "userId": "taglyze_user_123",
    "workspaceId": "workspace_123",
    "lastSsoAt": "2026-05-05T19:00:00.000Z"
  }
}
```

Se já existir metadata, ela é preservada e apenas a chave `taglyze` é atualizada.

## Segurança

- O JWT é validado com `jose`.
- A assinatura precisa bater com `TAGLYZE_JWT_SECRET`.
- `iss` e `aud` são obrigatórios e validados.
- `sub` e `email` são obrigatórios.
- O token deve ter `exp` curto.
- O redirect é protegido contra open redirect.
- O login padrão do Quackback não é alterado.

## Limitação atual

Esta versão usa o e-mail como chave primária de auto-provisioning e grava `JWT.sub` dentro de `user.metadata.taglyze.userId`.

Isso resolve:

- criação automática do usuário;
- reaproveitamento de usuário por e-mail;
- rastreio do ID externo da Taglyze;
- identificação posterior do vínculo.

Em uma evolução futura, se for necessário suportar troca de e-mail de forma totalmente robusta, pode-se consultar também `user.metadata.taglyze.userId` ou migrar para uma tabela relacional/indexada.

## Arquivos implementados

```txt
apps/web/src/lib/server/integrations/taglyze/taglyze-jwt.ts
apps/web/src/lib/server/integrations/taglyze/taglyze-sso.service.ts
apps/web/src/routes/api/auth/taglyze-sso.ts
```

## Fluxo técnico

```txt
Taglyze
  ↓ gera JWT HS256
Quackback /api/auth/taglyze-sso
  ↓ verifyTaglyzeJwt()
  ↓ ensureTaglyzeUser()
  ↓ auth.api.signUpEmail() se necessário
  ↓ salva user.metadata.taglyze
  ↓ auth.api.signInEmail(asResponse: true)
  ↓ copia Set-Cookie do Better Auth
  ↓ redirect
```

## Critérios de aceite

- Token válido autentica o usuário.
- Usuário inexistente é criado automaticamente.
- Usuário existente pelo mesmo e-mail é reutilizado.
- `user.metadata.taglyze.userId` é salvo/atualizado.
- Token sem `sub` é rejeitado.
- Token sem `email` é rejeitado.
- Token expirado é rejeitado.
- `issuer` inválido é rejeitado.
- `audience` inválida é rejeitada.
- Login padrão do Quackback continua funcionando.
- Magic link, OAuth, OTP, anonymous auth e bearer auth continuam funcionando.

## Próxima evolução recomendada

Se a busca por `metadata.taglyze.userId` precisar ser performática ou suportar troca de e-mail em larga escala, criar uma tabela relacional/indexada para identidades externas.
