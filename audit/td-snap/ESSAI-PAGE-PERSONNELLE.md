# Essai sur la page personnelle native « Arasaac »

Fichier **TLA Flash - essai page Arasaac.spb** : **fonctionnement confirmé par l’utilisateur sur iPad le 30 octobre 2026**.

Il intègre les dix boutons et images de `Mon nouveau TLA.spb` dans une copie de la page personnelle `Arasaac.spb` fournie par l’utilisateur. La grille est de 5 colonnes et 4 lignes ; les deux dernières lignes restent libres.

## Ce que cet essai conserve

- Schéma natif 4.20 du nouvel export iPad ;
- identité et titre de la page **Arasaac** ;
- `SerializedMetadata` et `SyncHash` des trois pages, exactement identiques à ceux de l’export natif ;
- paramètres et identité de l’ensemble, sans remplacement des données de licence ;
- pages de tableau de bord et barre de message, leurs éléments et dispositions.

La page personnelle reçoit les boutons, les images, les positions et les styles du TLA. Ses dimensions et sa date de modification sont actualisées. Aucune nouvelle identité de page, signature ou métadonnée de licence n’est fabriquée. Les fichiers d’origine sont ouverts en lecture seule et restent inchangés.

## Import sur l’iPad

1. Copier le fichier d’essai dans **Fichiers > Sur mon iPad > TD Snap**.
2. Dans TD Snap, lancer l’import d’un sous-ensemble depuis un fichier local.
3. Sélectionner uniquement la page **Arasaac** pour cet essai.
4. Si TD Snap propose un conflit, cet import met à jour la page personnelle **Arasaac** : accepter son remplacement uniquement pour cette page de test.
5. Vérifier si le message de licence réapparaît, puis ouvrir la page et essayer ses boutons.

La page conserve volontairement le nom **Arasaac**. Elle ne crée pas une nouvelle page autonome. Ce procédé ne doit pas être utilisé pour exporter silencieusement plusieurs TLA : ils auraient la même identité et risqueraient de se remplacer.

## Vérifications

`verification-page-personnelle.json` résume les contrôles réalisés : intégrité SQLite, références, images et leurs SHA‑1, correspondance exacte avec les dix cases du TLA, conservation des identités et des métadonnées natives, absence de modification des autres pages.

L’utilisateur a confirmé que cet essai fonctionne sur son iPad. Cela valide cet exemple sans établir l’algorithme de contrôle interne de TD Snap.

Le bouton de l’application applique désormais cette méthode directement, sans sélection de fichier : la base personnelle fournie est intégrée et utilisée automatiquement. Le nom du fichier exporté suit le titre du TLA ; sa page TD Snap conserve le nom et l’identité **Arasaac**. Chaque import actualise donc cette même page et peut remplacer un TLA précédemment importé, ce que la confirmation dans l’application précise. Un contrôle avec les mêmes fichiers réels confirme que la sortie du service TypeScript reproduit l’essai accepté, hormis les UUID des boutons et la date de modification de la page.

Pour reproduire l’essai, avec un nouveau nom de sortie :

```sh
python3 audit/td-snap/adapt_personal_page.py \
  --native '/Users/valentin/Downloads/Arasaac.spb' \
  --donor '/Users/valentin/Downloads/Mon nouveau TLA.spb' \
  --page Arasaac \
  --output '/private/tmp/tla-flash-essai-page-personnelle.spb'
```
