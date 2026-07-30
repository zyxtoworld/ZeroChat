# Guide de deploiement Web pour debutants

Ce guide sert uniquement a mettre ZeroChat Web/PWA en ligne. Le Worker de synchronisation, KV/R2 et le proxy IA sont des etapes optionnelles a configurer apres que le site fonctionne.

## Faut-il deployer la Web?

Deployeez seulement si vous voulez ouvrir ZeroChat depuis une URL hebergee dans le navigateur. Si vous l'utilisez localement ou via une app native et que vous voulez seulement la synchronisation entre appareils, ne deployeez pas la Web. Configurez GitHub Gist ou Cloudflare dans Réglages > Sync.

`dist/` est seulement la sortie statique creee par `pnpm run build` pour Cloudflare Pages, GitHub Pages ou un autre hebergeur statique. Elle n'est pas necessaire pour configurer la synchronisation.

GitHub Pages heberge l'app Web. GitHub Gist est la fonction separee de GitHub utilisee pour la synchronisation chiffree.

## Choisir une methode

Si vous hésitez, choisissez le tableau de bord Cloudflare Pages. Il ne demande
pas Node et pnpm en local et le premier deploiement se limite a quelques champs dans
le navigateur.

| Methode | Ideal pour | Etapes |
| --- | --- | --- |
| Tableau de bord Cloudflare Pages | Debutants qui veulent eviter le terminal | Connecter GitHub, saisir `pnpm run build`, saisir le repertoire `dist` |
| Cloudflare Wrangler | Utilisateurs a l'aise avec le terminal | Lancer `pnpm install` puis `pnpm run deploy:cf` |
| GitHub Pages | Utilisateurs qui ont deja le depot sur GitHub | Definir GitHub Actions comme source Pages, puis lancer le workflow |

Le tableau de bord Cloudflare et GitHub Actions ne demandent pas Node et pnpm sur votre ordinateur. Le build dans le cloud installe les dependances et lance la compilation; installez Node et pnpm localement seulement pour Wrangler ou les tests locaux.

## Recommande: tableau de bord Cloudflare Pages

1. Mettez le projet sur GitHub.
2. Dans le tableau de bord Cloudflare, ouvrez Workers & Pages et creez un projet Pages.
3. Selectionnez ce depot GitHub.
4. Deployeez avec:

```text
Build command: pnpm run build
Build output directory / Build directory: dist
```

Les prochains push vers la branche principale redeploieront automatiquement.

Reference officielle: [guide de deploiement React/Vite sur Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)

## Moins de commandes: Cloudflare Wrangler

Lancez ceci dans le dossier du projet:

```bash
pnpm install
pnpm run deploy:cf
```

Au premier lancement, Wrangler vous demandera de vous connecter a Cloudflare et de creer ou choisir un projet Pages. Le nom du projet n'a pas besoin d'etre commit dans le depot.

Pour verifier le build local sans rien envoyer, lancez:

```bash
pnpm run deploy:cf -- --dry-run
```

Reference officielle: [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

## GitHub Pages

1. Poussez le projet sur la branche `main` ou `master` de GitHub.
2. Ouvrez Settings > Pages dans le depot.
3. Definissez Source sur GitHub Actions.
4. Ouvrez Actions > Deploy Web et lancez le workflow. Les prochains push seront deployes automatiquement.

Ce depot contient deja `.github/workflows/pages.yml`, qui lance
`pnpm run verify:web-local` pour une preuve Web/PWA en clean checkout, puis
construit et publie `dist/`.

Reference officielle: [workflows personnalises GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Worker sync et proxy AI optionnels

GitHub Pages et l'hebergement statique classique ne peuvent pas proxyer les appels AI. Si la Web/PWA s'ouvre mais que le test fournisseur echoue sur le CORS/preflight navigateur, deploiez ZeroChat Worker et utilisez-le comme AI proxy. Stockez les cles fournisseur en Cloudflare Secrets avec `pnpm dlx wrangler secret put PROVIDER_KEYS`; cela active le Worker-hosted provider-key mode afin que le navigateur n'envoie que la cle derivee du Worker.

Le contrat du corps de `/proxy` depend de l'action : chat, images, speech, embeddings, moderation et realtime client-secret utilisent `Content-Type: application/json`; `image-edits` et `audio-transcriptions` envoient des fichiers et doivent rester en `multipart/form-data`. Ne surchargez pas `Content-Type` pour ces uploads, car le form-data boundary fait partie de la request. Le contrat OpenAPI publie les deux types de corps. Pour une preuve de release avec vraie UI, configurez `ZEROCHAT_LIVE_PROVIDER_UI_PROXY_URL` et, si les cles sont dans le Worker, `ZEROCHAT_LIVE_PROVIDER_UI_WORKER_HOSTS_KEY=true`.

## Confusions frequentes

- Le deploiement Web et le cloud sync Worker sont separes. Publiez d'abord le site, configurez la synchronisation ensuite.
- L'utilisation locale seule ne demande pas de synchronisation.
- GitHub Pages heberge l'app Web. Il ne peut pas servir de proxy IA ni remplacer un Cloudflare Worker.
- Cloudflare Pages heberge l'app Web. Cloudflare Worker est le backend optionnel de synchronisation/proxy IA.
- Pour un CSP strict dans le navigateur, utilisez Cloudflare Pages, Netlify ou un autre hebergeur statique qui applique `public/_headers`; GitHub Pages n'applique pas les en-tetes personnalises.
- Ne publiez jamais de cles API dans le code, les docs, des captures de GitHub Secrets ou des issues publiques.

## Avant publication

```bash
pnpm run verify:release
```

Cette commande ecrit aussi les captures dans `.visual-audit/` pour verifier visuellement desktop, fenetre etroite, mobile, reglages et mode image.
