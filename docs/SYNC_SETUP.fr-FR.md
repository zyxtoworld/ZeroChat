# Configuration de la synchronisation ZeroChat

Ce guide resume la synchronisation chiffree, les sauvegardes chiffrees et le proxy AI Cloudflare. Pour deployer uniquement la Web, utilisez `DEPLOY_WEB.fr-FR.md`.

## Choisir un mode

| Mode | Ideal pour | Limites |
| --- | --- | --- |
| Local | Un seul appareil ou un essai | Pas de synchro multi-appareils et pas de correction CORS navigateur |
| GitHub Gist | Chats texte legers entre appareils | Peu adapte aux nombreuses images ou gros historiques |
| Cloudflare Worker | Usage quotidien, images et proxy AI navigateur | Necessite Worker, Durable Object, KV et R2 |

## Mots de passe et cles

- Saisissez le mot de passe de chiffrement dans Réglages > Données.
- ZeroChat derive la cle d'acces Cloudflare avec `SHA-256("zerochat-access:v1:" + password)`, encodee en base64url sans padding.
- Dans Réglages > Sync > Cloudflare, copiez la valeur affichee et configurez-la comme `ZEROCHAT_ACCESS_KEY` dans le Worker.
- Cette cle derivee n'est pas le mot de passe original et ne peut pas dechiffrer les chats.
- Si le mot de passe de chiffrement change, mettez a jour `ZEROCHAT_ACCESS_KEY`, puis laissez ZeroChat resynchroniser.
- Le jeton GitHub reste local sur chaque appareil.
- Les cles AI API sont stockees dans le vault chiffre, sauf si elles sont hebergees comme Worker Secrets.

## GitHub Gist

1. Creez un jeton GitHub avec seulement le droit Gists read/write.
2. Saisissez le mot de passe de chiffrement dans Réglages > Données.
3. Dans Réglages > Sync, choisissez GitHub Gist et collez le token.
4. Sur le premier appareil, laissez Gist ID vide pour que ZeroChat cree un secret Gist.
5. Sur les autres appareils, utilisez le meme Gist ID, le meme nom de fichier et le meme mot de passe.

## Cloudflare Worker

Depuis la racine du projet:

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

Utilisez ces bindings dans `cloudflare/wrangler.toml`:

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

Le Durable Object est obligatoire et coordonne de facon coherente generation, head et snapshot. ZeroChat utilise `/sync/head` et `/sync/object/<key>` pour les manifestes, messages et Skills incrementaux chiffres ; sans R2, `/snapshot` utilise le meme coordinateur.

Dans ZeroChat, choisissez Cloudflare, saisissez l'URL du Worker et utilisez le meme mot de passe de chiffrement. La cle d'acces est derivee automatiquement.

## CORS navigateur et proxy AI

Le navigateur appelle votre Worker, puis le Worker appelle le fournisseur AI. Cela evite beaucoup d'echecs CORS cote fournisseur. Les hosts officiels sont autorises par defaut. Les relays personnalises peuvent etre appris apres une requete avec cle valide, et la Web/PWA met a jour `/proxy/hosts` quand les fournisseurs changent ou sont supprimes.

Le contrat du corps de `/proxy` depend de l'action. Chat, generation d'images, speech, embeddings, moderation et realtime client-secret utilisent `Content-Type: application/json`. Les editions d'image et les transcriptions audio envoient des fichiers et doivent rester en `multipart/form-data`; ne definissez pas `Content-Type` manuellement pour ces uploads, car le navigateur ou le runtime natif doit ajouter le form-data boundary. `shared/sync-api.openapi.yaml` publie les deux types de corps.

## Diagnostic Cloudflare

- `Worker setup incomplete: ZEROCHAT_ACCESS_KEY is missing`: configurez la cle derivee avec `pnpm dlx wrangler secret put ZEROCHAT_ACCESS_KEY`.
- `KV binding zerochat_kv is required`: creez KV et gardez exactement le binding `zerochat_kv`.
- `R2 binding zerochat_r2 is required`: ajoutez le bucket R2 comme `zerochat_r2`, ou gardez snapshot mode seulement pour des tests courts.
- 401 ou Unauthorized: la cle du Worker ne correspond pas au mot de passe de donnees actuel.

## Securite

- Ne partagez pas le jeton GitHub, la cle Cloudflare ni les cles AI API.
- Ne commitez pas `wrangler.toml`, `.dev.vars` ni de vrais secrets.
- Utilisez des Base URLs distantes en HTTPS.
- Si le mot de passe de chiffrement est perdu, les donnees distantes chiffrees ne peuvent pas etre recuperees.
