# Guia para principiantes de despliegue Web

Esta guia solo cubre como publicar la Web/PWA de ZeroChat. El Worker de sincronizacion, KV/R2 y el proxy de IA son pasos opcionales para despues de que el sitio ya abra correctamente.

## Necesitas desplegar la Web?

Despliega solo si quieres abrir ZeroChat desde una URL alojada en el navegador. Si lo ejecutas localmente o usas una app nativa y solo quieres sincronizacion entre dispositivos, no despliegues la Web. Configura GitHub Gist o Cloudflare en Ajustes > Sincronización.

`dist/` es solo la salida estatica creada por `pnpm run build` para Cloudflare Pages, GitHub Pages u otro hosting estatico. No se necesita para configurar la sincronizacion.

GitHub Pages aloja la Web. GitHub Gist es la funcion separada de GitHub usada para sincronizacion cifrada.

## Elige una ruta

Si dudas, elige el panel de Cloudflare Pages. No requiere Node y pnpm local y el
primer despliegue solo pide unos campos en el navegador.

| Ruta | Ideal para | Pasos |
| --- | --- | --- |
| Panel de Cloudflare Pages | Principiantes que no quieren usar la terminal | Conectar GitHub, poner `pnpm run build`, poner directorio `dist` |
| Cloudflare Wrangler | Usuarios comodos con la terminal | Ejecutar `pnpm install` y `pnpm run deploy:cf` |
| GitHub Pages | Usuarios que ya tienen el repositorio en GitHub | Activar GitHub Actions como origen de Pages y ejecutar el workflow |

El panel de Cloudflare y GitHub Actions no requieren Node y pnpm en tu computadora. La compilacion en la nube instala dependencias y ejecuta el build; instala Node y pnpm localmente solo para Wrangler o pruebas locales.

## Recomendado: panel de Cloudflare Pages

1. Sube el proyecto a GitHub.
2. En el panel de Cloudflare, abre Workers & Pages y crea un proyecto Pages.
3. Selecciona este repositorio de GitHub.
4. Despliega con:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

Los futuros push a la rama principal se desplegaran automaticamente.

Referencia oficial: [guia de despliegue React/Vite en Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## Menos comandos: Cloudflare Wrangler

Ejecuta esto en la carpeta del proyecto:

```bash
pnpm install
pnpm run deploy:cf
```

La primera vez, Wrangler te pedira iniciar sesion en Cloudflare y crear o elegir un proyecto Pages. No hace falta guardar el nombre del proyecto en el repositorio.

Para revisar el build local sin subir nada, ejecuta:

```bash
pnpm run deploy:cf -- --dry-run
```

Referencia oficial: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. Sube el proyecto a la rama `main` o `master` en GitHub.
2. Abre Settings > Pages en el repositorio.
3. Cambia Source a GitHub Actions.
4. Abre Actions > Deploy Web y ejecuta el workflow. Los siguientes push se desplegaran automaticamente.

Este repositorio ya incluye `.github/workflows/pages.yml`, que ejecuta
`pnpm run verify:web-local` para evidencia Web/PWA en clean checkout, y luego
construye y publica `dist/`.

Referencia oficial: [workflows personalizados de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Worker sync y proxy AI opcionales

GitHub Pages y el hosting estatico normal no pueden proxyar llamadas AI. Si la Web/PWA abre pero el chequeo del proveedor falla por CORS/preflight del navegador, despliega ZeroChat Worker y usalo como AI proxy. Guarda las claves del proveedor como Cloudflare Secrets con `pnpm dlx wrangler secret put PROVIDER_KEYS`; eso activa el Worker-hosted provider-key mode para que el navegador solo envie la clave derivada del Worker.

El contrato del cuerpo de `/proxy` depende de la accion: chat, imagenes, speech, embeddings, moderation y realtime client-secret usan `Content-Type: application/json`; `image-edits` y `audio-transcriptions` suben archivos y deben seguir en `multipart/form-data`. No sobrescribas `Content-Type` para esos uploads, porque el form-data boundary forma parte de la request. El contrato OpenAPI publica ambos tipos de cuerpo. Para evidencia de release con UI real, configura `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` y, si usas claves en el Worker, `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true`.

## Confusiones comunes

- El despliegue Web y el Worker de sincronizacion en la nube son cosas separadas. Publica primero el sitio y configura la sincronizacion despues.
- El uso solo local no necesita sincronizacion.
- GitHub Pages aloja la Web. No puede ser proxy de IA ni reemplazar un Cloudflare Worker.
- Cloudflare Pages aloja la Web. Cloudflare Worker es el backend opcional de sincronizacion/proxy de IA.
- Para CSP estricto en el navegador, usa Cloudflare Pages, Netlify u otro hosting estatico que aplique `public/_headers`; GitHub Pages no aplica encabezados personalizados.
- Nunca publiques claves API en codigo, documentos, capturas de GitHub Secrets ni issues publicos.

## Antes de publicar

```bash
pnpm run verify:release
```

Este comando tambien guarda capturas en `.visual-audit/` para revisar visualmente escritorio, ventanas estrechas, movil, ajustes y modo de imagen.
