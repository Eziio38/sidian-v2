# Stockage des documents

Couche de persistance des fichiers téléversés. **Stockage uniquement.**

Avant cette couche, rien ne survivait : les pièces jointes du composer vivaient
en mémoire navigateur et disparaissaient au rafraîchissement. Il n'existait ni
bucket, ni table de métadonnées, ni policy.

- Migration : `supabase/migrations/20260803140000_document_storage.sql`
- Service : `src/lib/documents/`
- Tests : `src/lib/documents/documents.test.ts`

Cette couche n'est pas encore câblée à l'interface. Le composer de l'assistant
continue de gérer ses pièces jointes en mémoire ; le branchement est un
changement distinct.

## Aucune extraction n'existe

Le produit **ne sait pas lire le contenu** d'un document : pas d'OCR, pas de
parsing PDF côté serveur, pas de transcription audio.

`pdfjs-dist` est bien une dépendance, mais son unique usage est
`src/components/assistant/pdf-document-preview.tsx` : un `import()` dynamique
côté navigateur qui rend un aperçu à l'écran. Il ne produit aucune donnée
persistée et ne s'exécute jamais côté serveur.

`src/lib/documents/extraction.ts` ne définit donc que le **contrat** qu'un futur
fournisseur devrait respecter, plus une implémentation `disabled` qui répond
`{ status: "unavailable", reason: "capability_not_implemented" }`. Elle ne
renvoie jamais de texte : un contenu inventé serait indiscernable d'un contenu
réellement extrait.

Conséquence directe sur les états : un document dont les octets sont confirmés
reste en **`awaiting_processing`**, qui se lit « stocké, contenu jamais
analysé ». C'est l'état terminal actuel.

## États

| État | Signification |
| --- | --- |
| `pending_upload` | Ligne réservée, chemin calculé, octets pas encore arrivés. |
| `awaiting_processing` | Octets présents et vérifiés. Contenu jamais analysé. **État terminal actuel.** |
| `stored` | Réservé : à poser par une future chaîne d'analyse quand un document n'attend plus rien. Rien ne le pose aujourd'hui. |
| `quarantined` | Les octets reçus ne correspondent pas à ce qui avait été annoncé (taille ou type). Non restituable. |
| `deleted` | Suppression logique. La ligne subsiste, les octets aussi. |

## Convention de chemin

```
<prestataire_id>/<document_id>/<nom-de-fichier-assaini>
```

Le chemin n'est **jamais** fourni par l'appelant : il est calculé par
`public.register_document_upload` à partir de `auth.uid()`. Trois défenses se
superposent :

1. Zod (`documentFilenameSchema`) refuse tout nom contenant `/`, `\`, un segment
   `.`/`..`, un point initial ou un caractère de contrôle.
2. La RPC SQL assainit malgré tout le nom reçu (`sanitiseDocumentFilename` en est
   le miroir exact côté TypeScript, mêmes opérations dans le même ordre).
3. La contrainte `document_storage_path_convention` rejette toute ligne dont le
   chemin ne commence pas par `<prestataire_id>/<document_id>/`, et
   `document_storage_path_no_traversal` rejette tout segment `.` ou `..`.

Les policies sur `storage.objects` limitent lecture et écriture au préfixe
`(storage.foldername(name))[1] = current_prestataire_id()`.

## Allowlist

| Famille | Types MIME |
| --- | --- |
| PDF | `application/pdf` |
| Images | `image/png`, `image/jpeg`, `image/webp` |
| Texte | `text/plain`, `text/csv` |
| Word | `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Tableurs | `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |

**Archives refusées** (`zip`, `rar`, `7z`, `tar`, `gz`…) : un conteneur opaque ne
peut être ni contrôlé ni restitué honnêtement tant qu'aucune analyse de contenu
n'existe.

Un type absent de la liste est refusé proprement, avec l'erreur typée
`document_mime_not_allowed` — jamais une exception brute.

La liste vit à deux endroits qui doivent bouger ensemble :
`public.document_allowed_mime_types()` (SQL) et `DOCUMENT_ALLOWED_MIME_TYPES`
(`src/lib/documents/schemas.ts`).

### Écarts assumés avec le composer

`src/components/assistant/document-attachments.ts` accepte aujourd'hui, côté
interface, des familles que le stockage refuse : **audio** et **archives**. Ces
fichiers restent affichables dans la conversation mais ne seront pas
persistables. À arbitrer au moment du branchement de l'interface — soit élargir
l'allowlist, soit refuser ces familles dès la sélection.

## Plafond de taille

`20 MiB` (`20 * 1024 * 1024` = `20971520` octets).

Valeur retenue par alignement sur `MAX_DOCUMENT_FILE_SIZE`, déjà appliquée par
le composer : choisir autre chose ferait accepter à l'écran des fichiers que le
stockage refuserait ensuite.

Le plafond est appliqué à trois niveaux : `documentSizeBytesSchema` (Zod),
`document_size_bytes_range` (CHECK SQL) et `file_size_limit` du bucket. La
confirmation d'upload relit en plus la taille **réellement** stockée dans
`storage.objects` : une divergence bascule le document en `quarantined`.

**À revoir par le propriétaire** : 20 MiB est un compromis, pas une décision
produit documentée. Les scans de factures multi-pages peuvent dépasser cette
taille.

## Ownership

Aucune méthode de `DocumentRepository` ne reçoit d'identifiant de tenant. Le
tenant est fixé à la construction du dépôt, depuis la session serveur :

- côté Supabase, les RPC le dérivent de `auth.uid()` et les policies du bucket
  contrôlent le préfixe ;
- côté tests, le dépôt mémoire est lié à une `DocumentSession` — deux tenants
  signifient deux dépôts au-dessus du même magasin.

Un document appartenant à un autre prestataire est traité comme **inexistant**
(même code d'erreur `document_not_found`), pour que son existence ne soit pas
observable.

## URL signées

Le bucket `documents` est **privé**. Aucune URL publique n'est jamais produite.

- **Téléchargement** : `createSignedUrl`, TTL par défaut 60 s, plafond dur 300 s
  (`DOCUMENT_DOWNLOAD_URL_MAX_TTL_SECONDS`). Un document `quarantined`,
  `deleted` ou `pending_upload` n'est pas restituable.
- **Upload** : `createSignedUploadUrl`. Le TTL du jeton est **fixé par Supabase
  Storage** et n'est pas paramétrable — le code ne prétend pas le contrôler.

## Rétention et ménage

Deux mécanismes distincts, à ne pas confondre :

1. **Suppression logique** (`soft_delete_document`) : pose `status = 'deleted'`
   et `deleted_at`. La ligne et **les octets subsistent**.
2. **Ménage des uploads abandonnés**
   (`purge_abandoned_document_uploads`, service_role uniquement) : marque
   supprimées les lignes restées en `pending_upload` au-delà de
   `ABANDONED_DOCUMENT_UPLOAD_TTL_HOURS` (24 h par défaut) et renvoie leurs
   chemins ; `cleanupAbandonedDocumentUploads` retire ensuite les octets. Un
   index partiel `document_pending_upload_cleanup_idx` sert ce balayage.

Aucun ordonnanceur n'appelle ce ménage aujourd'hui. Le brancher sur le runtime
de jobs est un travail distinct.

## Décisions qui restent au propriétaire

Ces points sont **volontairement non tranchés** dans le code. Aucun défaut n'a
été inventé pour les combler.

1. **Durée de rétention.** Combien de temps conserve-t-on les octets d'un
   document supprimé logiquement ? Aujourd'hui : indéfiniment. Aucune purge
   différée n'existe.
2. **Analyse antivirus.** Le produit accepte des fichiers arbitraires dans un
   bucket privé et peut les restituer à leur propriétaire. Faut-il un scan avant
   de rendre un document téléchargeable ? L'état `quarantined` existe et serait
   l'aboutissement naturel d'un tel scan, mais aucun scanner n'est branché — et
   `quarantined` ne signifie aujourd'hui rien d'autre que « les octets reçus ne
   correspondent pas à ce qui était annoncé ».
3. **Suppression RGPD à la clôture de compte.** `prestataire_id` est en
   `on delete restrict` : fermer un compte échouera tant que ses documents
   existent. Il faut décider d'une procédure explicite (purge des octets, puis
   des lignes) et de son délai.
4. **Recalcul du `checksum`.** Le SHA-256 est accepté tel que fourni par le
   client, à titre indicatif. Il n'est jamais recalculé côté serveur : il ne
   prouve donc rien contre un client hostile.
5. **Familles de fichiers du composer** (audio, archives) — cf. écarts assumés
   ci-dessus.

## Points d'attention à l'exécution

La migration crée des policies sur `storage.objects`, ce qui suppose que le rôle
qui applique les migrations dispose des droits nécessaires sur le schéma
`storage`. Le bucket est créé par `insert ... on conflict do update` plutôt que
déclaré dans `supabase/config.toml` : ce dépôt décrit tout son schéma par
migrations, et une seconde source de vérité inviterait la dérive. Si le
propriétaire préfère la déclaration CLI, le bloc équivalent serait :

```toml
[storage.buckets.documents]
public = false
file_size_limit = "20MiB"
allowed_mime_types = ["application/pdf", "image/png", "..."]
```
