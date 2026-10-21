# ZeroChat Documentation

ZeroChat provides user-facing sync and deployment documentation for the same languages supported by the application interface. The default guide is English; localized guides use language-code suffixes.

## Sync and Web Deployment

Sync setup guides cover local mode, GitHub Gist synchronization, Cloudflare
Worker deployment, zerochat_kv, zerochat_r2, derived ZEROCHAT_ACCESS_KEY, AI
proxy/CORS behavior, encrypted backups, and security checks.

Web deployment guides cover only static Web/PWA hosting. They do not require
KV/R2, a sync Worker, or a provider API key before the site can be opened.

Web deployment is only needed when you want to host the Web/PWA at a browser URL.
It is separate from encrypted sync. If you only want cross-device sync, configure
GitHub Gist or Cloudflare inside ZeroChat Settings > Sync; you do not need the
`dist/` folder or a Web hosting provider.

Quick choice:

- Local use: run ZeroChat locally or install a native app. No Web deployment or
  cloud sync setup is required.
- Multi-device sync: use a sync setup guide. No `dist/` folder or Web host is
  required.
- Hosted browser URL: use a Web deployment guide. Add the sync Worker only when
  you also want encrypted cloud sync or the Worker AI proxy.

For hosting the Web/PWA itself, the shortest path is:

- Cloudflare Pages: build command `pnpm run build`, build output directory
  `dist`.
- GitHub Pages: set Pages source to `GitHub Actions`; the included workflow deploys `dist`.
- If you are unsure which hosted path to choose, use the Cloudflare Pages
  dashboard path first because it needs no local terminal setup.
- GitHub Pages hosts the Web app. GitHub Gist is the separate GitHub feature used
  for encrypted sync.
- Beginner Web deployment guides are available in every interface language.
- Before publishing, run `pnpm run verify:release`. CI and the GitHub Pages
  workflow run `pnpm run verify:web-local` for clean-checkout Web/PWA evidence;
  that hosted gate does not replace the local release gate or ignored
  `.manual-qa/` release diagnostics.
- After a disposable live cloud-sync drill passes, run
  `pnpm run verify:release:live-sync` so the final release gate refuses skipped
  or diagnostic sync evidence.
- For provider release evidence, run
  `pnpm run check:live-provider-full-capability`; it requires a passing
  `.manual-qa/live-provider-smoke-full-current.json` with chat, image, audio,
  embeddings, moderation, and Realtime proof.
- Before claiming an all-platform release, run
  `pnpm run verify:all-platforms`. It checks native SDK/host prerequisites first
  and is expected to fail on machines missing Xcode or Linux/WSL.
- For final all-platform release evidence after a disposable live cloud-sync
  pass, run `pnpm run verify:all-platforms:live-sync`.
- After target-host runtime smoke artifacts exist for Windows, Android, Apple,
  and Linux, run `pnpm run verify:all-platforms:runtime`; for the strictest
  final local gate, run `pnpm run verify:all-platforms:runtime-live-sync`; after
  the first real hosted native CI artifacts are downloaded and recorded, run
  `pnpm run verify:all-platforms:runtime-live-sync-hosted`; after the
  full-capability provider report also passes, run
  `pnpm run verify:all-platforms:runtime-live-sync-hosted-provider`.
- If a strict all-platform gate is blocked by missing external evidence, it
  writes `.manual-qa/strict-release-preflight.json` as a sanitized diagnostic
  with `releaseEvidence: false`; validate that handoff with
  `pnpm run check:strict-release-preflight` before sharing it. To regenerate
  and validate the current strict-preflight report in one diagnostic command,
  run `pnpm run report:strict-release-preflight`; the report can be a fresh
  blocked state or a zero-blocker passed diagnostic, and a successful command
  still does not mean release readiness.
- To share the current blocked state as one sanitized handoff, run
  `pnpm run report:release-blockers`. It validates the source diagnostic
  reports and writes `.manual-qa/release-blockers-current.json`; a passing
  summary command still means "current blocker map", not release readiness.
  To check the existing summary without refreshing its timestamp, run
  `pnpm run check:release-blockers`.
- For the safest single local handoff, run `pnpm run report:release-diagnostics`.
  It strips live provider, live sync, and GitHub credential environment
  variables before refreshing diagnostics, writes
  `.manual-qa/release-diagnostics-current.json`, and audits that the broad
  runtime-artifact gate still fails only on the expected Windows trusted MSIX
  host AppX cleanup blocker. A passing diagnostics command still means
  "current sanitized blocker handoff", not release readiness. To check the
  existing summary without refreshing diagnostic timestamps or hashes, run
  `pnpm run check:release-diagnostics`.
- After the aggregate JSON is current, run `pnpm run report:current-evidence`
  to print a sanitized Markdown handoff with the exact current hashes, blocker
  IDs, and next actions. Run `pnpm run sync:current-evidence` to update the
  generated current-evidence blocks in `REQUIREMENTS.md` / `QA_AUDIT.md`, then
  run `pnpm run check:current-evidence` to verify that the docs mention the
  current hashes and diagnostic timestamp without refreshing source reports.
- For the visual release pass, open
  `.visual-audit/visual-audit-gallery.html` and review the screenshots by eye.
- `QA_AUDIT.md` maps the all-platform quality goal to concrete evidence and
  calls out the platform checks that still need real SDK machines.
- `NATIVE_QA_CHECKLIST.md` is the required runtime and visual checklist before
  any Android, Apple, Windows, or Linux build is called release-ready.

| Language | Web Deployment Guide |
| --- | --- |
| English | [DEPLOY_WEB.md](DEPLOY_WEB.md) |
| Chinese | [DEPLOY_WEB.zh-CN.md](DEPLOY_WEB.zh-CN.md) |
| Spanish | [DEPLOY_WEB.es-ES.md](DEPLOY_WEB.es-ES.md) |
| Hindi | [DEPLOY_WEB.hi-IN.md](DEPLOY_WEB.hi-IN.md) |
| Arabic | [DEPLOY_WEB.ar-SA.md](DEPLOY_WEB.ar-SA.md) |
| Portuguese | [DEPLOY_WEB.pt-BR.md](DEPLOY_WEB.pt-BR.md) |
| Russian | [DEPLOY_WEB.ru-RU.md](DEPLOY_WEB.ru-RU.md) |
| Japanese | [DEPLOY_WEB.ja-JP.md](DEPLOY_WEB.ja-JP.md) |
| Korean | [DEPLOY_WEB.ko-KR.md](DEPLOY_WEB.ko-KR.md) |
| French | [DEPLOY_WEB.fr-FR.md](DEPLOY_WEB.fr-FR.md) |

| Language | File |
| --- | --- |
| English | [SYNC_SETUP.md](SYNC_SETUP.md) |
| Chinese | [SYNC_SETUP.zh-CN.md](SYNC_SETUP.zh-CN.md) |
| Spanish | [SYNC_SETUP.es-ES.md](SYNC_SETUP.es-ES.md) |
| Hindi | [SYNC_SETUP.hi-IN.md](SYNC_SETUP.hi-IN.md) |
| Arabic | [SYNC_SETUP.ar-SA.md](SYNC_SETUP.ar-SA.md) |
| Portuguese | [SYNC_SETUP.pt-BR.md](SYNC_SETUP.pt-BR.md) |
| Russian | [SYNC_SETUP.ru-RU.md](SYNC_SETUP.ru-RU.md) |
| Japanese | [SYNC_SETUP.ja-JP.md](SYNC_SETUP.ja-JP.md) |
| Korean | [SYNC_SETUP.ko-KR.md](SYNC_SETUP.ko-KR.md) |
| French | [SYNC_SETUP.fr-FR.md](SYNC_SETUP.fr-FR.md) |

## Other Technical Documents

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DEPLOY_WEB.md](DEPLOY_WEB.md)
- [DEPLOY_WEB.zh-CN.md](DEPLOY_WEB.zh-CN.md)
- [DEPLOY_WEB.es-ES.md](DEPLOY_WEB.es-ES.md)
- [DEPLOY_WEB.hi-IN.md](DEPLOY_WEB.hi-IN.md)
- [DEPLOY_WEB.ar-SA.md](DEPLOY_WEB.ar-SA.md)
- [DEPLOY_WEB.pt-BR.md](DEPLOY_WEB.pt-BR.md)
- [DEPLOY_WEB.ru-RU.md](DEPLOY_WEB.ru-RU.md)
- [DEPLOY_WEB.ja-JP.md](DEPLOY_WEB.ja-JP.md)
- [DEPLOY_WEB.ko-KR.md](DEPLOY_WEB.ko-KR.md)
- [DEPLOY_WEB.fr-FR.md](DEPLOY_WEB.fr-FR.md)
- [PLATFORMS.md](PLATFORMS.md)
- [NATIVE_QA_CHECKLIST.md](NATIVE_QA_CHECKLIST.md)
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
- [LOCAL_TOOLCHAINS.md](LOCAL_TOOLCHAINS.md)
- [SECURITY.md](SECURITY.md)
