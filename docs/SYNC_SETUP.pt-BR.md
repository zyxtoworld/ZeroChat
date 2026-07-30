# Configuracao de sincronizacao do ZeroChat

Este guia resume sincronizacao criptografada, backups criptografados e o proxy AI do Cloudflare. Para publicar apenas a Web, use `DEPLOY_WEB.pt-BR.md`.

## Escolher modo

| Modo | Melhor para | Limites |
| --- | --- | --- |
| Local | Um dispositivo ou teste inicial | Nao sincroniza entre dispositivos e nao resolve CORS no navegador |
| GitHub Gist | Chats de texto leves em varios dispositivos | Nao e ideal para muitas imagens ou historico grande |
| Cloudflare Worker | Uso diario, imagens e proxy AI no navegador | Requer Worker, Durable Object, KV e R2 |

## Senhas e chaves

- Digite a senha de criptografia de dados em Configurações > Dados.
- ZeroChat deriva a chave Cloudflare com `SHA-256("zerochat-access:v1:" + password)` e base64url sem padding.
- Em Configurações > Sincronização > Cloudflare, copie o valor mostrado e configure-o como `ZEROCHAT_ACCESS_KEY` no Worker.
- A chave derivada nao e a senha original e nao consegue descriptografar chats.
- Se a senha de criptografia mudar, atualize `ZEROCHAT_ACCESS_KEY` e deixe o ZeroChat sincronizar de novo.
- O token do GitHub fica local em cada dispositivo.
- AI API keys ficam no vault criptografado, exceto quando hospedadas como Worker Secrets.

## GitHub Gist

1. Crie um token do GitHub apenas com permissao Gists read/write.
2. Digite a senha de criptografia em Configurações > Dados.
3. Em Configurações > Sincronização, escolha GitHub Gist e cole o token.
4. No primeiro dispositivo, deixe Gist ID vazio para o ZeroChat criar um secret Gist.
5. Nos outros dispositivos, use o mesmo Gist ID, nome de arquivo e senha.

## Cloudflare Worker

Execute na raiz do projeto:

```bash
pnpm install
pnpm dlx wrangler login
cd cloudflare
cp wrangler.toml.example wrangler.toml
pnpm dlx wrangler kv namespace create zerochat_kv
pnpm dlx wrangler r2 bucket create zerochat
pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY
pnpm dlx wrangler deploy
```

Use estes bindings em `cloudflare/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "zerochat_kv"
id = "your-kv-namespace-id"

[[r2_buckets]]
binding = "zerochat_r2"
bucket_name = "zerochat"

[[durable_objects.bindings]]
name = "ZEROCHAT_SYNC_COORDINATOR"
class_name = "ZeroChatSyncCoordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ZeroChatSyncCoordinator"]
```

O Durable Object e obrigatorio e coordena generation, head e snapshot com consistencia. ZeroChat usa `/sync/head` e `/sync/object/<key>` para manifest, mensagens e Skills incrementais criptografados; sem R2, `/snapshot` usa o mesmo coordenador.

No ZeroChat, escolha Cloudflare, informe a URL do Worker e use a mesma senha de criptografia. A chave de acesso e derivada automaticamente.

## CORS do navegador e proxy AI

O navegador chama seu Worker, e o Worker chama o provedor AI. Isso evita muitas falhas de CORS do provedor. Hosts oficiais sao permitidos por padrao. Relays personalizados podem ser aprendidos depois de uma requisicao com chave valida, e a Web/PWA atualiza `/proxy/hosts` quando provedores mudam ou sao excluidos.

O contrato do corpo de `/proxy` depende da acao. Chat, geracao de imagens, speech, embeddings, moderation e realtime client-secret usam `Content-Type: application/json`. Edicoes de imagem e transcricoes de audio enviam arquivos e devem permanecer em `multipart/form-data`; nao defina `Content-Type` manualmente nesses uploads, porque o navegador ou runtime nativo precisa inserir o form-data boundary. `shared/sync-api.openapi.yaml` publica os dois tipos de corpo.

## Diagnostico Cloudflare

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: configure a chave derivada com `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY`.
- `KV binding zerochat_kv is required`: crie o KV e mantenha exatamente o binding `zerochat_kv`.
- `R2 binding zerochat_r2 is required`: adicione o bucket R2 como `zerochat_r2`, ou use snapshot mode apenas para testes curtos.
- 401 ou Unauthorized: a chave do Worker nao corresponde a senha de dados atual.

## Seguranca

- Nao compartilhe o token do GitHub, chave Cloudflare ou AI API keys.
- Nao faca commit de `wrangler.toml`, `.dev.vars` ou segredos reais.
- Use Base URLs remotas com HTTPS.
- Se a senha de criptografia for perdida, os dados remotos criptografados nao podem ser recuperados.
