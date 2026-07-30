# Configurar la sincronizacion de ZeroChat

Esta guia resume la sincronizacion cifrada, las copias de seguridad y el proxy AI de Cloudflare. Para desplegar solo la Web, usa `DEPLOY_WEB.es-ES.md`.

## Elegir modo

| Modo | Mejor para | Limites |
| --- | --- | --- |
| Local | Un solo dispositivo o probar la app | No sincroniza entre dispositivos y no soluciona CORS del navegador |
| GitHub Gist | Chats de texto ligeros en varios dispositivos | No es ideal para muchas imagenes o historiales grandes |
| Cloudflare Worker | Uso diario, imagenes y proxy AI en navegador | Requiere desplegar Worker, Durable Object, KV y R2 |

## Contrasenas y claves

- Escribe la contrasena de cifrado de datos en Ajustes > Datos.
- ZeroChat deriva la clave de acceso Cloudflare con `SHA-256("zerochat-access:v1:" + password)` y base64url sin relleno.
- En Ajustes > Sincronización > Cloudflare, copia el valor mostrado y guárdalo como `ZEROCHAT_ACCESS_KEY` en el Worker.
- Esa clave derivada no es la contrasena original y no puede descifrar chats.
- Si cambias la contrasena de cifrado, actualiza `ZEROCHAT_ACCESS_KEY` y deja que ZeroChat vuelva a sincronizar.
- El token de GitHub se queda local en cada dispositivo.
- Las AI API keys se guardan dentro del vault cifrado, salvo que las alojes como Worker Secrets.

## GitHub Gist

1. Crea un token de GitHub solo con permiso Gists read/write.
2. Escribe la contrasena de cifrado en Ajustes > Datos.
3. En Ajustes > Sincronización, elige GitHub Gist y pega el token.
4. En el primer dispositivo deja Gist ID vacio para que ZeroChat cree un secret Gist.
5. En los otros dispositivos usa el mismo Gist ID, nombre de archivo y contrasena.

## Cloudflare Worker

Ejecuta desde la raiz del proyecto:

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

Usa estos bindings en `cloudflare/wrangler.toml`:

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

El Durable Object es obligatorio y coordina de forma consistente generation, head y snapshot. ZeroChat usa `/sync/head` y `/sync/object/<key>` para manifest, mensajes y Skills incrementales cifrados; sin R2, `/snapshot` usa el mismo coordinador.

En ZeroChat, elige Cloudflare, escribe la URL del Worker y usa la misma contrasena de cifrado. La clave de acceso se deriva automaticamente.

## CORS del navegador y proxy AI

El navegador llama a tu Worker, y el Worker llama al proveedor AI. Esto evita muchos fallos CORS del proveedor. Los hosts oficiales estan permitidos por defecto. Los relays personalizados se pueden aprender tras una solicitud con clave valida, y la Web/PWA actualiza `/proxy/hosts` cuando cambias o borras proveedores.

El contrato del cuerpo de `/proxy` depende de la accion. Chat, generacion de imagenes, speech, embeddings, moderation y realtime client-secret usan `Content-Type: application/json`. Las ediciones de imagen y transcripciones de audio suben archivos y deben quedarse en `multipart/form-data`; no definas `Content-Type` manualmente para esas subidas, porque el navegador o runtime nativo debe anadir el form-data boundary. `shared/sync-api.openapi.yaml` publica ambos tipos de cuerpo.

## Diagnostico Cloudflare

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: configura la clave derivada con `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY`.
- `KV binding zerochat_kv is required`: crea KV y usa exactamente el binding `zerochat_kv`.
- `R2 binding zerochat_r2 is required`: anade el bucket R2 como `zerochat_r2`, o usa snapshot mode solo para pruebas cortas.
- 401 o Unauthorized: la clave del Worker no coincide con la contrasena de datos actual.

## Seguridad

- No compartas el token de GitHub, la clave Cloudflare ni AI API keys.
- No subas `wrangler.toml`, `.dev.vars` ni secretos reales a Git.
- Usa Base URLs remotas con HTTPS.
- Si pierdes la contrasena de cifrado, los datos remotos cifrados no se pueden recuperar.
