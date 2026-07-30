# Настройка синхронизации ZeroChat

Это краткое руководство по зашифрованной синхронизации, зашифрованным резервным копиям и AI proxy через Cloudflare. Если нужно только опубликовать Web/PWA, используйте `DEPLOY_WEB.ru-RU.md`.

## Выбор режима

| Режим | Когда подходит | Ограничения |
| --- | --- | --- |
| Local | Один device или быстрая проверка | Нет синхронизации между устройствами и нет исправления CORS в браузере |
| GitHub Gist | Легкие текстовые чаты на нескольких устройствах | Не лучший вариант для множества изображений или большого архива |
| Cloudflare Worker | Ежедневное использование, изображения и браузерный AI proxy | Нужно развернуть Worker, Durable Object, KV и R2 |

## Пароли и ключи

- Введите пароль шифрования данных в Настройки > Данные.
- ZeroChat выводит Cloudflare access key через `SHA-256("zerochat-access:v1:" + password)` и base64url без padding.
- В Настройки > Синхронизация > Cloudflare скопируйте показанное значение и укажите его как `ZEROCHAT_ACCESS_KEY` в Worker.
- Производный ключ не является исходным паролем и не может расшифровать чаты.
- Если пароль шифрования изменился, обновите `ZEROCHAT_ACCESS_KEY` и дайте ZeroChat пересинхронизироваться.
- Токен GitHub остается локальным на каждом устройстве.
- AI API keys хранятся в зашифрованном vault, кроме случая хранения как Worker Secrets.

## GitHub Gist

1. Создайте токен GitHub только с правом Gists read/write.
2. Введите пароль шифрования в Настройки > Данные.
3. В Настройки > Синхронизация выберите GitHub Gist и вставьте token.
4. На первом устройстве оставьте Gist ID пустым, чтобы ZeroChat создал secret Gist.
5. На остальных устройствах используйте тот же Gist ID, имя файла и пароль.

## Cloudflare Worker

Выполните из корня проекта:

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

Используйте такие bindings в `cloudflare/wrangler.toml`:

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

Durable Object обязателен и согласованно координирует generation, head и snapshot. ZeroChat использует `/sync/head` и `/sync/object/<key>` для зашифрованных incremental manifest, сообщений и Skills; без R2 `/snapshot` использует тот же координатор.

В ZeroChat выберите Cloudflare, введите Worker URL и используйте тот же пароль шифрования. Access key будет выведен автоматически.

## CORS браузера и AI proxy

Браузер обращается к вашему Worker, а Worker обращается к AI provider. Это помогает обойти многие CORS ошибки на стороне провайдера. Официальные hosts разрешены по умолчанию. Пользовательские relay hosts могут быть запомнены после запроса с валидным ключом, а Web/PWA обновляет `/proxy/hosts` при изменении или удалении providers.

Контракт тела `/proxy` зависит от action. Chat, image generation, speech, embeddings, moderation и realtime client-secret используют `Content-Type: application/json`. Image edits и audio transcriptions загружают файлы и должны оставаться `multipart/form-data`; не задавайте `Content-Type` вручную для этих uploads, потому что browser или native runtime должен добавить form-data boundary. `shared/sync-api.openapi.yaml` публикует оба типа тела запроса.

## Диагностика Cloudflare

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: задайте производный ключ через `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY`.
- `KV binding zerochat_kv is required`: создайте KV и оставьте binding строго `zerochat_kv`.
- `R2 binding zerochat_r2 is required`: добавьте R2 bucket с binding `zerochat_r2`, либо используйте snapshot mode только для коротких тестов.
- 401 или Unauthorized: ключ Worker не совпадает с текущим паролем данных.

## Безопасность

- Не передавайте токен GitHub, Cloudflare access key или AI API keys.
- Не коммитьте `wrangler.toml`, `.dev.vars` или реальные secrets.
- Используйте удаленные HTTPS Base URLs.
- Если пароль шифрования потерян, удаленные ciphertext данные восстановить нельзя.
