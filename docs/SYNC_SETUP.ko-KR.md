# ZeroChat 동기화 설정

이 문서는 암호화 동기화, 암호화 백업, Cloudflare AI 프록시를 간단히 설명합니다. Web/PWA만 배포하려면 `DEPLOY_WEB.ko-KR.md`를 사용하세요.

## 모드 선택

| 모드 | 적합한 경우 | 제한 |
| --- | --- | --- |
| Local | 한 기기 또는 빠른 테스트 | 여러 기기 동기화 없음, 브라우저 AI CORS 해결 없음 |
| GitHub Gist | 가벼운 텍스트 채팅 동기화 | 이미지가 많거나 기록이 큰 경우 부적합 |
| Cloudflare Worker | 일상 사용, 이미지, 브라우저 AI 프록시 | Worker, Durable Object, KV, R2 배포 필요 |

## 비밀번호와 키

- 데이터 암호화 비밀번호를 ZeroChat의 설정 > 데이터에 입력합니다.
- ZeroChat은 `SHA-256("zerochat-access:v1:" + password)`와 padding 없는 base64url로 Cloudflare access key를 만듭니다.
- 설정 > 동기화 > Cloudflare에 표시된 값을 복사해 Worker의 `ZEROCHAT_ACCESS_KEY`로 설정합니다.
- 파생된 키는 원래 비밀번호가 아니며 채팅을 복호화할 수 없습니다.
- 데이터 암호화 비밀번호를 바꾸면 `ZEROCHAT_ACCESS_KEY`도 업데이트하고 ZeroChat을 다시 동기화하세요.
- GitHub 토큰은 각 기기에 로컬로 남습니다.
- AI API keys는 Worker Secrets로 호스팅하지 않는 한 암호화 vault에 저장됩니다.

## GitHub Gist

1. Gists read/write 권한만 가진 GitHub 토큰을 만듭니다.
2. 설정 > 데이터에 데이터 암호화 비밀번호를 입력합니다.
3. 설정 > 동기화에서 GitHub Gist를 선택하고 토큰을 붙여넣습니다.
4. 첫 기기에서는 Gist ID를 비워 두어 ZeroChat이 secret Gist를 만들게 합니다.
5. 다른 기기에서는 같은 Gist ID, 파일 이름, 비밀번호를 사용합니다.

## Cloudflare Worker

프로젝트 루트에서 실행합니다:

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

`cloudflare/wrangler.toml`에 다음 bindings를 둡니다:

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

Durable Object는 필수이며 generation, head, snapshot을 일관되게 조정합니다. ZeroChat은 암호화된 incremental manifest, messages, Skills에 `/sync/head`와 `/sync/object/<key>`를 사용하고, R2가 없을 때도 `/snapshot`은 같은 coordinator를 사용합니다.

ZeroChat에서 Cloudflare를 선택하고 Worker URL을 입력한 뒤 같은 데이터 암호화 비밀번호를 사용합니다. Access key는 자동으로 파생됩니다.

## 브라우저 CORS와 AI 프록시

브라우저는 사용자의 Worker를 호출하고, Worker가 AI provider를 호출합니다. 이 방식은 provider 쪽 CORS 실패를 줄입니다. 공식 provider hosts는 기본 허용됩니다. Custom relay hosts는 유효한 access-key 요청 뒤 학습될 수 있고, Web/PWA는 provider 변경이나 삭제 때 `/proxy/hosts`를 업데이트합니다.

`/proxy` request body contract는 action에 따라 달라집니다. Chat, image generation, speech, embeddings, moderation, realtime client-secret은 `Content-Type: application/json`을 사용합니다. Image edits와 audio transcriptions는 파일을 업로드하므로 `multipart/form-data`를 유지해야 합니다. 이런 upload에서는 `Content-Type`을 직접 설정하지 마세요. browser 또는 native runtime이 form-data boundary를 넣어야 합니다. `shared/sync-api.openapi.yaml`은 두 body type을 모두 공개합니다.

## Cloudflare 문제 해결

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY`로 파생 키를 설정합니다.
- `KV binding zerochat_kv is required`: KV를 만들고 binding 이름을 정확히 `zerochat_kv`로 둡니다.
- `R2 binding zerochat_r2 is required`: R2 bucket을 `zerochat_r2` binding으로 추가하거나, 짧은 테스트에는 snapshot mode만 사용합니다.
- 401 또는 Unauthorized: Worker key가 현재 데이터 비밀번호와 일치하지 않습니다.

## 보안

- GitHub 토큰, Cloudflare access key, AI API keys를 공유하지 마세요.
- `wrangler.toml`, `.dev.vars`, 실제 secrets를 commit하지 마세요.
- 원격 provider Base URL은 HTTPS를 사용하세요.
- 암호화 비밀번호를 잃어버리면 원격 ciphertext를 복구할 수 없습니다.
