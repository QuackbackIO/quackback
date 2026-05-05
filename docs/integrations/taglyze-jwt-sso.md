# Integração Taglyze → Quackback: SSO via JWT Assinado

## Objetivo

Permitir que usuários autenticados na Taglyze acessem o Quackback automaticamente, sem necessidade de login separado, utilizando um token JWT assinado.

Essa integração estabelece um fluxo de autenticação confiável entre os dois sistemas, garantindo identidade consistente.

## Resultado esperado

1. Usuário faz login na Taglyze.
2. Taglyze gera um JWT assinado.
3. Usuário acessa o Quackback com esse token.
4. Quackback valida o token.
5. Usuário é autenticado automaticamente.
6. Sessão é criada no Quackback.

## Fluxo de autenticação

```txt
Usuário logado na Taglyze
  ↓
Taglyze gera JWT assinado
  ↓
Redirect para Quackback com token
  ↓
Quackback valida token
  ↓
Cria sessão
  ↓
Usuário autenticado
```

## Estrutura do JWT

Header:

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

Payload:

```json
{
  "sub": "taglyze_user_123",
  "email": "cliente@empresa.com",
  "name": "Cliente Exemplo",
  "iat": 1714900000,
  "exp": 1714900600,
  "iss": "taglyze",
  "aud": "quackback",
  "workspace_id": "workspace_123"
}
```

Campos obrigatórios:

- `sub` → ID do usuário na Taglyze
- `email`
- `iat`
- `exp`
- `iss`
- `aud`

Campos opcionais:

- `name`
- `workspace_id`

## Segurança

- Assinatura HMAC SHA-256
- Expiração curta (5 minutos recomendado)
- Verificação de issuer (`iss`)
- Verificação de audience (`aud`)
- Proteção contra replay (opcional com nonce)

## Variáveis de ambiente no Quackback

```env
TAGLYZE_JWT_SECRET=
TAGLYZE_JWT_ISSUER=taglyze
TAGLYZE_JWT_AUDIENCE=quackback
TAGLYZE_SSO_ENABLED=true
```

## Endpoint no Quackback

```txt
GET /auth/sso/taglyze?token=JWT
```

Responsabilidades:

- validar assinatura
- validar expiração
- validar issuer/audience
- extrair dados do usuário
- localizar ou criar usuário
- criar sessão
- redirecionar usuário

## Regras de autenticação

1. Validar token
2. Normalizar e-mail
3. Buscar vínculo externo (Taglyze)
4. Se não existir, criar usuário
5. Criar sessão autenticada

## Criação de sessão

Após validação:

- criar cookie de sessão
- associar usuário autenticado
- redirecionar para dashboard

## Estrutura de arquivos sugerida

```txt
apps/web/src/lib/server/integrations/taglyze/
  taglyze-jwt.service.ts
  taglyze-jwt.validator.ts

apps/web/src/routes/auth/sso/taglyze.ts
```

## O que precisa existir na Taglyze

- geração de JWT assinado
- endpoint para redirecionar usuário
- controle de sessão

## Exemplo de redirect

```txt
https://quackback.seudominio.com/auth/sso/taglyze?token=JWT
```

## Tratamento de erros

Erros possíveis:

- token inválido
- assinatura inválida
- token expirado
- usuário não encontrado

Resposta:

- redirecionar para login
- logar erro

## Plano de implementação

### Fase 1 — MVP

- validar JWT
- criar sessão
- login automático

### Fase 2 — Segurança

- proteção contra replay
- refresh token
- logs

### Fase 3 — Avançado

- logout sincronizado
- multi-tenant
- permissões por workspace

## Critérios de aceite

- usuário logado na Taglyze entra automaticamente no Quackback
- token inválido não autentica
- sessão é criada corretamente
- integração não quebra login padrão

## Recomendação

Implementar após sincronização de usuários para evitar duplicidade.
