# Guia de implantação Web para iniciantes

Este guia cobre apenas como colocar o ZeroChat Web/PWA no ar. O Worker de sincronização, KV/R2 e o proxy de IA são etapas opcionais para depois que o site estiver abrindo corretamente.

## Você precisa implantar a Web?

Implante somente se quiser abrir o ZeroChat por uma URL hospedada no navegador. Se você roda localmente ou usa um app nativo e só quer sincronização entre dispositivos, não implante a Web. Configure GitHub Gist ou Cloudflare em Configurações > Sincronização.

`dist/` é apenas a saída estática criada por `pnpm run build` para Cloudflare Pages, GitHub Pages ou outro host estático. Ela não é necessária para configurar sincronização.

GitHub Pages hospeda o app Web. GitHub Gist é o recurso separado do GitHub usado para sincronização criptografada.

## Escolha um caminho

Se estiver em dúvida, escolha o painel do Cloudflare Pages. Ele não exige Node e pnpm local e o primeiro deploy fica limitado a alguns campos no navegador.

| Caminho | Melhor para | Passos |
| --- | --- | --- |
| Painel do Cloudflare Pages | Iniciantes que querem o menor número de partes móveis | Conectar GitHub, definir `pnpm run build`, definir diretório `dist` |
| Cloudflare Wrangler | Quem se sente confortável com terminal | Rodar `pnpm install` e `pnpm run deploy:cf` |
| GitHub Pages | Quem já hospeda o repositório no GitHub | Ativar GitHub Actions como origem do Pages e rodar o workflow |

O painel da Cloudflare e o GitHub Actions não exigem Node e pnpm no seu computador. O build na nuvem instala dependências e roda a compilação; instale Node e pnpm localmente só para Wrangler ou testes locais.

## Recomendado: painel do Cloudflare Pages

1. Coloque o projeto no GitHub.
2. No painel da Cloudflare, abra Workers & Pages e crie um projeto Pages.
3. Selecione este repositório do GitHub.
4. Implante com:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

Pushes futuros para a branch principal reimplantam automaticamente.

Referência oficial: [guia de implantação React/Vite no Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## Menos comandos: Cloudflare Wrangler

Execute na pasta do projeto:

```bash
pnpm install
pnpm run deploy:cf
```

No primeiro uso, o Wrangler pedirá login na Cloudflare e criação ou escolha de um projeto Pages. O nome do projeto não precisa ser salvo no repositório.

Para verificar o build local sem enviar nada, rode:

```bash
pnpm run deploy:cf -- --dry-run
```

Referência oficial: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. Envie o projeto para a branch `main` ou `master` no GitHub.
2. Abra Settings > Pages no repositório.
3. Defina Source como GitHub Actions.
4. Abra Actions > Deploy Web e rode o workflow. Pushes posteriores implantam automaticamente.

Este repositório já inclui `.github/workflows/pages.yml`, que roda
`pnpm run verify:web-local` para evidência Web/PWA em clean checkout, depois
compila e publica `dist/`.

Referência oficial: [workflows personalizados do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Worker sync e proxy AI opcionais

GitHub Pages e hospedagem estatica comum nao conseguem proxyar chamadas AI. Se a Web/PWA abre, mas o teste do provedor falha por CORS/preflight do navegador, implante o ZeroChat Worker e use-o como AI proxy. Guarde as chaves do provedor como Cloudflare Secrets com `pnpm dlx wrangler secret put PROVIDER_KEYS`; isso ativa o Worker-hosted provider-key mode para que o navegador envie apenas a chave derivada do Worker.

O contrato do corpo de `/proxy` depende da acao: chat, imagens, speech, embeddings, moderation e realtime client-secret usam `Content-Type: application/json`; `image-edits` e `audio-transcriptions` enviam arquivos e devem ficar em `multipart/form-data`. Nao sobrescreva `Content-Type` nesses uploads, porque o form-data boundary faz parte da request. O contrato OpenAPI publica os dois tipos de corpo. Para evidencia de release com UI real, configure `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` e, se as chaves ficarem no Worker, `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true`.

## Confusões comuns

- Implantação Web e cloud sync Worker são coisas separadas. Publique o site primeiro e configure a sincronização depois.
- Uso somente local não precisa de sincronização.
- GitHub Pages hospeda o app Web. Ele não pode atuar como proxy de IA nem substituir um Cloudflare Worker.
- Cloudflare Pages hospeda o app Web. Cloudflare Worker é o backend opcional de sincronização/proxy de IA.
- Para CSP estrito no navegador, use Cloudflare Pages, Netlify ou outro host estático que aplique `public/_headers`; o GitHub Pages não aplica headers personalizados.
- Nunca publique chaves de API em código, documentos, capturas de GitHub Secrets ou issues públicas.

## Antes de publicar

```bash
pnpm run verify:release
```

Esse comando tambem grava capturas em `.visual-audit/` para revisar visualmente desktop, janela estreita, mobile, configurações e modo de imagem.
