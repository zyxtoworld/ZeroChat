# Руководство для новичков по веб-развертыванию

Это руководство только о том, как опубликовать ZeroChat Web/PWA. Worker для синхронизации, KV/R2 и AI proxy можно настроить позже, когда сайт уже открывается.

## Нужно ли развертывать Web?

Развертывайте только если хотите открывать ZeroChat по опубликованному URL в браузере. Если вы запускаете приложение локально или используете native app и хотите только синхронизацию между устройствами, Web app развертывать не нужно. Настройте GitHub Gist или Cloudflare в Настройки > Синхронизация.

`dist/` - это только статический результат `pnpm run build` для Cloudflare Pages, GitHub Pages или другого static hosting. Для настройки синхронизации он не нужен.

GitHub Pages размещает Web app. GitHub Gist - отдельная функция GitHub для encrypted sync.

## Выберите один способ

Если сомневаетесь, выберите панель Cloudflare Pages. Для нее не нужен локальный Node и pnpm, а первый deploy сводится к нескольким полям в браузере.

| Способ | Для кого | Шаги |
| --- | --- | --- |
| Панель Cloudflare Pages | Новичкам, которым не нужна командная строка | Подключить GitHub, указать `pnpm run build`, каталог сборки `dist` |
| Cloudflare Wrangler | Тем, кто готов использовать терминал | Выполнить `pnpm install` и `pnpm run deploy:cf` |
| GitHub Pages | Тем, у кого репозиторий уже на GitHub | Включить GitHub Actions как источник Pages и запустить workflow |

Панель Cloudflare и GitHub Actions не требуют Node и pnpm на вашем компьютере. Облачная сборка сама устанавливает зависимости и запускает build; устанавливайте Node и pnpm локально только для Wrangler или локальной проверки.

## Рекомендуется: панель Cloudflare Pages

1. Разместите проект на GitHub.
2. В панели Cloudflare откройте Workers & Pages и создайте проект Pages.
3. Выберите этот GitHub-репозиторий.
4. Разверните с такими значениями:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

Следующие push в основную ветку будут развертываться автоматически.

Официальная справка: [руководство Cloudflare Pages для React/Vite](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## Минимум команд: Cloudflare Wrangler

Выполните в папке проекта:

```bash
pnpm install
pnpm run deploy:cf
```

При первом запуске Wrangler попросит войти в Cloudflare и создать или выбрать проект Pages. Имя проекта не нужно сохранять в репозитории.

Чтобы проверить локальную сборку без загрузки, выполните:

```bash
pnpm run deploy:cf -- --dry-run
```

Официальная справка: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. Отправьте проект в ветку `main` или `master` на GitHub.
2. Откройте Settings > Pages в репозитории.
3. Установите Source в GitHub Actions.
4. Откройте Actions > Deploy Web и запустите workflow. Следующие push будут публиковаться автоматически.

В репозитории уже есть `.github/workflows/pages.yml`: он сначала запускает
`pnpm run verify:web-local` для Web/PWA evidence в clean checkout, затем
собирает и публикует `dist/`.

Официальная справка: [пользовательские workflow GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Необязательные Worker sync и AI proxy

GitHub Pages и обычный static hosting не могут proxy-запросы AI. Если Web/PWA открывается, но provider check падает на browser CORS/preflight, разверните ZeroChat Worker и используйте его как AI proxy. Храните provider keys в Cloudflare Secrets через `pnpm dlx wrangler secret put PROVIDER_KEYS`; это включает Worker-hosted provider-key mode, поэтому browser отправляет только производный Worker key.

Контракт тела `/proxy` зависит от action: chat, images, speech, embeddings, moderation и realtime client-secret используют `Content-Type: application/json`; `image-edits` и `audio-transcriptions` загружают файлы и должны оставаться `multipart/form-data`. Не переопределяйте `Content-Type` для этих uploads, потому что form-data boundary является частью request. Контракт OpenAPI публикует оба типа тела. Для release evidence с реальной UI задайте `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL`, а если keys лежат в Worker, также `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true`.

## Частые вопросы новичков

- Веб-развертывание и cloud sync Worker - разные вещи. Сначала опубликуйте сайт, затем настройте синхронизацию.
- Для локального использования синхронизация не нужна.
- GitHub Pages размещает веб-приложение. Он не может быть AI proxy и не заменяет Cloudflare Worker.
- Cloudflare Pages размещает веб-приложение. Cloudflare Worker - необязательный backend для синхронизации/AI proxy.
- Для строгого browser CSP используйте Cloudflare Pages, Netlify или другой static host, который применяет `public/_headers`; GitHub Pages не применяет custom headers.
- Никогда не публикуйте API keys в коде, документах, скриншотах GitHub Secrets или публичных issues.

## Перед публикацией

```bash
pnpm run verify:release
```

Эта команда также сохраняет скриншоты в `.visual-audit/`, чтобы глазами проверить desktop, узкое окно, mobile, настройки и режим изображений.
