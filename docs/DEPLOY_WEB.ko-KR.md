# Web 배포 초보자 가이드

이 문서는 ZeroChat Web/PWA를 온라인에 올리는 방법만 다룹니다. 동기화 Worker, KV/R2, AI proxy는 사이트가 정상적으로 열린 뒤에 설정해도 되는 선택 단계입니다.

## Web 배포가 필요한가요?

ZeroChat을 호스팅된 browser URL로 열고 싶을 때만 deploy하세요. 로컬에서 실행하거나 native app을 쓰면서 cross-device sync만 원한다면 Web app을 deploy하지 않아도 됩니다. 대신 ZeroChat의 설정 > 동기화에서 GitHub Gist 또는 Cloudflare를 설정하세요.

`dist/`는 `pnpm run build`가 만드는 static output이며 Cloudflare Pages, GitHub Pages 또는 다른 static host용입니다. Sync 설정에는 필요하지 않습니다.

GitHub Pages는 Web app을 호스팅합니다. GitHub Gist는 encrypted sync에 쓰는 별도의 GitHub 기능입니다.

## 방법 선택

잘 모르겠다면 Cloudflare Pages 대시보드를 선택하세요. 로컬 Node와 pnpm이 필요 없고 첫 deploy는 브라우저에서 몇 가지 필드만 입력하면 됩니다.

| 방법 | 적합한 사용자 | 단계 |
| --- | --- | --- |
| Cloudflare Pages 대시보드 | 터미널을 쓰고 싶지 않은 초보자 | GitHub 연결, `pnpm run build` 입력, build directory에 `dist` 입력 |
| Cloudflare Wrangler | 터미널 사용이 괜찮은 사용자 | `pnpm install`과 `pnpm run deploy:cf` |
| GitHub Pages | 이미 GitHub에 저장소가 있는 사용자 | Pages Source를 GitHub Actions로 바꾸고 workflow 실행 |

Cloudflare 대시보드와 GitHub Actions 방식은 내 컴퓨터에 Node와 pnpm이 없어도 됩니다. 클라우드 build가 의존성을 설치하고 build를 실행합니다. Wrangler나 로컬 테스트를 할 때만 Node와 pnpm을 로컬에 설치하세요.

## 추천: Cloudflare Pages 대시보드

1. 프로젝트를 GitHub에 올립니다.
2. Cloudflare dashboard에서 Workers & Pages를 열고 Pages project를 만듭니다.
3. 이 GitHub repository를 선택합니다.
4. 아래 값으로 deploy합니다:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

이후 main branch에 push하면 자동으로 다시 배포됩니다.

공식 참고: [Cloudflare Pages React/Vite deployment guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## 명령어 최소: Cloudflare Wrangler

프로젝트 폴더에서 실행합니다:

```bash
pnpm install
pnpm run deploy:cf
```

처음 실행하면 Wrangler가 Cloudflare 로그인과 Pages project 생성 또는 선택을 안내합니다. Project name을 repository에 저장할 필요는 없습니다.

업로드 없이 local build만 확인하려면 실행하세요:

```bash
pnpm run deploy:cf -- --dry-run
```

공식 참고: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. 프로젝트를 GitHub의 `main` 또는 `master` branch에 push합니다.
2. Repository Settings > Pages를 엽니다.
3. Source를 GitHub Actions로 설정합니다.
4. Actions > Deploy Web을 열고 workflow를 실행합니다. 이후 push는 자동으로 배포됩니다.

이 repository에는 `.github/workflows/pages.yml`이 이미 포함되어 있습니다.
clean checkout Web/PWA evidence를 위해 먼저 `pnpm run verify:web-local`을 실행한
다음 `dist/`를 build하고 publish합니다.

공식 참고: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 선택 사항 Worker sync와 AI proxy

GitHub Pages와 일반 static hosting은 AI calls를 proxy할 수 없습니다. Web/PWA는 열리지만 provider check가 browser CORS/preflight에서 실패하면 ZeroChat Worker를 deploy하고 AI proxy로 사용하세요. Provider keys는 `pnpm dlx wrangler secret put PROVIDER_KEYS`로 Cloudflare Secrets에 저장합니다. 그러면 Worker-hosted provider-key mode가 켜지고 browser는 파생된 Worker key만 보냅니다.

`/proxy` body contract는 action에 따라 달라집니다. chat, images, speech, embeddings, moderation, realtime client-secret은 `Content-Type: application/json`을 사용합니다. `image-edits`와 `audio-transcriptions`는 file upload라서 `multipart/form-data`를 유지해야 합니다. 이런 upload에서는 `Content-Type`을 override하지 마세요. form-data boundary는 request의 일부입니다. OpenAPI contract는 두 body type을 모두 공개합니다. 실제 UI release evidence에는 `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL`을 설정하고, Worker에 keys를 둘 때는 `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true`도 설정합니다.

## 초보자가 자주 헷갈리는 점

- Web deployment와 cloud sync Worker는 별개입니다. 먼저 사이트를 배포하고, 동기화는 나중에 설정하세요.
- 로컬에서만 사용할 경우 동기화가 필요 없습니다.
- GitHub Pages는 Web app을 호스팅합니다. AI proxy가 될 수 없고 Cloudflare Worker를 대체하지 않습니다.
- Cloudflare Pages는 Web app을 호스팅합니다. Cloudflare Worker는 선택 가능한 sync/AI proxy backend입니다.
- 엄격한 browser CSP가 필요하면 `public/_headers`를 적용하는 Cloudflare Pages, Netlify 또는 다른 static host를 사용하세요. GitHub Pages는 custom headers를 적용하지 않습니다.
- API key를 code, docs, GitHub Secrets screenshot, public issue에 올리지 마세요.

## 게시 전 확인

```bash
pnpm run verify:release
```

이 command는 `.visual-audit/`에 screenshot도 저장하여 desktop, narrow window, mobile, settings, image mode UI를 눈으로 확인할 수 있게 합니다.
