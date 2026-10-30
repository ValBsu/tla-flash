# Essai d’export TLA Flash vers TD Snap

**État actuel — 30 octobre 2026 :** l’essai qui met à jour une page personnelle native a été confirmé fonctionnel par l’utilisateur sur iPad. Voir [l’essai Arasaac](ESSAI-PAGE-PERSONNELLE.md). Le bouton télécharge désormais directement un `.spb` à partir de la base personnelle Arasaac intégrée ; il conserve son identité et ses métadonnées. Tous les exports actualisent donc cette même page à l’import. Le prototype décrit ci-dessous est historique et ne correspond plus au fonctionnement du bouton.

Le fichier [tla-flash-test.spb](tla-flash-test.spb) est un **prototype à tester sur l’iPad**, pas un export déjà validé dans TD Snap. Il a été produit par le script Python indépendant décrit ci-dessous. L’export de l’application est implémenté séparément dans `src/services/tdSnap.ts` et accessible par le bouton **Exporter vers TD Snap**.

Il contient une page **TLA Flash — Test iPad**, avec 3 colonnes et 2 lignes :

| boire | manger | eau |
| --- | --- | --- |
| bonjour | oui | non |

Les six PNG Sclera sont incorporés dans le fichier. Les boutons reprennent exactement la séquence de commande d’un bouton ordinaire du fichier de référence. Le comportement vocal effectif dépend de TD Snap et reste à tester.

## Essai sur iPad

1. Transférer `tla-flash-test.spb` dans **Fichiers** sur l’iPad, par exemple avec AirDrop depuis le Mac. Copier ensuite le fichier dans le dossier existant **Sur mon iPad > TD Snap** : appui prolongé sur le fichier → **Copier**, ouvrir le dossier TD Snap, appui prolongé dans une zone vide → **Coller**. Cette étape est décrite dans le [guide iPad de Yak Back](https://yakback.org/installation/) et peut expliquer une liste d’import local vide même si le fichier est ailleurs dans Fichiers.
2. Dans TD Snap : **Édition → Page → Importer/Exporter des pages → Importer un sous-ensemble de pages → À partir d’un fichier local**.
3. Choisir le fichier, puis importer la page **TLA Flash — Test iPad**.
4. Ouvrir la page ou créer un lien vers elle depuis un bouton de l’ensemble utilisé. La fonction **Importer et ajouter un lien vers la page** peut aussi réunir ces opérations.
5. Vérifier les six pictogrammes, leur position, les fonds verts/orange/roses et l’action obtenue en touchant chaque case. Vérifier ensuite les images sans connexion Internet.

En cas d’échec, noter le message exact et la version de TD Snap installée. La version de schéma `4.13` du fichier source n’est pas le numéro de version de l’application iPad.

Procédure d’import documentée par Tobii Dynavox : [manuel français, sections 9.9.6 et 13.3.2](https://download.mytobiidynavox.com/Snap/documents/TD_Snap_UsersManual_fr-FR.pdf).

## Résultats de l’analyse du fichier fourni

`2025 calendrier.spb` est une base SQLite, ouverte uniquement en lecture :

- 18 pages, 34 dispositions, 488 boutons, 488 séquences de commandes ;
- 16 médias incorporés, dont 4 PNG et un enregistrement sonore ;
- langue `fr_FR`, schéma natif `4.13` ;
- boutons reliés à leur page par `ElementReference` ; positions via `PageLayout` et `ElementPlacement` ;
- images personnelles dans `PageSetData`, avec identifiant `IMG:` suivi du SHA-1 des octets encodé en Base64 ;
- boutons ordinaires : `CommandFlags=8` et commande exacte `{"$type":"1","$values":[{"$type":"3","MessageAction":0}]}` ; tous les champs `Message` sont nuls dans cet exemple ;
- deux dispositions identiques par page ordinaire, conservées dans le prototype sous les variantes `3,2,False,0` et `3,2,True,0`.

Le prototype conserve les définitions natives des tables et index. Il ne contient aucune page du calendrier, aucun de ses médias, aucun enregistrement sonore ni historique d’usage. Les images viennent de la banque Sclera déjà présente dans TLA Flash. Tous les UUID de page, d’ensemble et de boutons sont nouveaux.

## Vérifications et limites

Un essai utilisateur sur iPad a permis d’accéder au fichier après son placement dans le dossier TD Snap, puis a signalé une erreur « la licence de Mon nouveau TLA a été altérée ». L’export natif n’est donc pas validé. Le fichier généré conserve les métadonnées de la page « Décembre 2025 » tout en portant un UUID différent. Le rôle exact du suffixe de métadonnées et son rapport avec ce contrôle ne sont pas confirmés. La prochaine référence utile est une page personnelle vierge créée et exportée nativement dans TD Snap ; une méthode officielle de génération externe reste à établir. Aucune modification de validation ou de licence n’a été appliquée.

La génération contrôle l’intégrité SQLite, les références, les positions, les couleurs, les libellés, les identifiants d’images et l’absence de collision d’UUID avec la source. Le SHA-256 de la source est vérifié avant et après ; le fichier d’origine reste inchangé.

Deux mécanismes natifs restent inconnus :

- `Page.SerializedMetadata` comprend du JSON suivi d’un suffixe Base64 de 32 octets ; sa signification et son calcul ne sont pas établis ;
- les champs `SyncHash` ne peuvent pas encore être recalculés fidèlement.

Ces valeurs sont conservées depuis des enregistrements natifs de référence. Elles **ne sont pas déclarées valides pour les nouvelles données**. Les UUID neufs, la grille 3×2 et les nouveaux PNG doivent encore être acceptés par TD Snap. Les contrôles SQLite ne prouvent ni l’import, ni le rendu, ni le fonctionnement vocal.

Le prototype ne gère que des grilles complètes avec libellés et PNG incorporés ou issus de la banque Sclera locale. Il ne constitue pas encore un exporteur général : photos JPEG, cases vides, styles détaillés, navigation, texte prononcé distinct du libellé et intégration au navigateur restent à développer selon les résultats de l’essai.

## Reproduire le fichier de test

Depuis la racine du projet, avec Python 3 et un **nouveau nom de fichier de sortie** :

```sh
python3 audit/td-snap/prototype.py \
  --template '/Users/valentin/Downloads/2025 calendrier.spb' \
  --board audit/td-snap/tla-flash-test.json \
  --output /private/tmp/tla-flash-nouvel-essai.spb \
  --asset-root public/pictograms/sclera
```

Le script n’utilise aucun paquet externe et ne remplace jamais un fichier de sortie existant. Le JSON de test reprend le modèle `Board` de TLA Flash. Le script et le `.spb` restent indépendants de l’application publiée.

Pictogrammes : **Sclera vzw — www.sclera.be**, [CC BY-NC 2.0 Belgique](https://creativecommons.org/licenses/by-nc/2.0/be/). PNG originaux non modifiés. Source : <https://www.sclera.be/resources/download/picto_fr.zip>. Attribution également incluse dans la description du fichier TD Snap.
