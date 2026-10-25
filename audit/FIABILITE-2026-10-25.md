# Audit ciblé de fiabilité et de conservation des données — 25 octobre 2026

Périmètre : `src/services/{storage,backup,translation,arasaac}.ts` et leurs appels dans `App.tsx`. Aucun code de production modifié.

## Constats confirmés

### P1 — Une suppression échouée bloque les sauvegardes suivantes du TLA

`App.tsx:238-254` ajoute l’identifiant aux TLA supprimés et le retire des TLA modifiables **avant** la résolution de la suppression IndexedDB. Le `catch` affiche une erreur mais ne rétablit pas ces deux ensembles. Toute édition ultérieure ajoute à nouveau l’identifiant à `editableBoardIds`, mais l’effet de sauvegarde s’arrête à `App.tsx:64` parce que `deletedBoardIds` le contient toujours.

Reproduction exécutée : ouvrir un TLA, changer son titre, faire échouer `boardRepository.remove()`, changer à nouveau son titre. Le second titre apparaît à l’écran mais `boardRepository.save()` n’est plus appelé. La sauvegarde de fermeture reste une tentative et ne résout pas ce défaut pendant la session.

Correction : ne marquer la suppression qu’après validation de la transaction, ou restaurer les marqueurs dans le `catch`; garder une protection explicite contre les écritures encore en attente. Ajouter un test de non régression à partir de la reproduction.

### P1 — L’import d’une photo peut écraser des modifications récentes

`App.tsx:373-377` enregistre dans `FileReader.onload` une fonction `updateCell` qui capture le tableau au démarrage de la lecture (`App.tsx:118`). Le résultat reconstruit donc le tableau à partir de cette ancienne version.

Reproduction exécutée : démarrer une lecture de photo, modifier le titre du même TLA, terminer la lecture. Le titre revient à l’ancienne valeur et cette ancienne version est autosauvegardée. Le même mécanisme peut affecter d’autres cases ou rouvrir un tableau quitté pendant l’opération.

Correction : capturer les seuls identifiants du TLA et de la case, puis appliquer le résultat à la version courante avec une mise à jour fonctionnelle; vérifier que la cible existe toujours. Annuler l’opération si la cible a été supprimée.

### P2 — Les ZIP ne sont pas portables entre tous les hébergements

`pictograms.ts:25` enregistre des chemins incluant `import.meta.env.BASE_URL`. `backup.ts:95-98` exporte uniquement `backup.json`; `backup.ts:119-122` restitue les chemins sans les reconstruire.

Reproduction exécutée avec un vrai ZIP et `readBackupFile()` : `/tla-flash/pictograms/sclera/1.png` reste identique après restauration. Depuis Netlify à la racine, le fichier réel se trouve sous `/pictograms/sclera/1.png`. Les identifiants de banque et de pictogramme devraient servir à reconstruire l’URL locale au chargement. Cela ne pose pas problème à hébergement et préfixe identiques.

Les images ARASAAC restent aussi des URL distantes dans le ZIP : ce n’est pas une sauvegarde autonome des images. Pour garantir un transfert utilisable hors connexion, embarquer les images des tableaux sauvegardés et rétablir des références locales.

### P2 — La validation des archives vérifie les types mais pas la cohérence

`backup.ts:20-58` accepte des dimensions négatives ou de 1 000 000, un tableau de 20 cases avec `cells: []`, des identifiants et positions dupliqués, une date invalide et toute URL d’image. Ces six cas ont été exécutés : `isBackupData()` les accepte.

Conséquences : grilles incohérentes, documents imprimés incorrects, positions hors page, chargement automatique de ressources tierces choisies par l’archive. Les URL ne sont pas injectées comme HTML et ce constat ne démontre pas une exécution de script.

Correction : borner les grilles aux dimensions de l’interface (actuellement 1–10 lignes, 1–15 colonnes), vérifier nombre de cases, bornes et unicité des coordonnées et identifiants, dates valides, relations vers les dossiers, protocole/type des images. Reconstruire les images de banque depuis leurs identifiants plutôt que faire confiance à une URL importée.

### P2 — Les importations ZIP n’ont pas de limites de ressources

`backup.ts:101-118` charge puis décompresse `backup.json` entier, sans taille maximale du fichier, du JSON ou du nombre de TLA/cases/images. Une archive fortement compressée ou excessivement volumineuse peut saturer la mémoire et bloquer la page. C’est une lecture de code; aucun test de saturation n’a été exécuté.

Correction : limites explicites de taille compressée, décompressée et de cardinalité, validation avant transaction, indicateur d’avancement; déplacer les très grosses opérations dans un Worker si les bibliothèques doivent grandir.

### P2 — Deux onglets peuvent se remplacer mutuellement les modifications

`storage.ts:18` fait un `put()` sans version de révision ni contrôle de conflit; aucune notification entre onglets dans les services examinés. `App.tsx:75-81` réécrit le dernier tableau connu lors de la fermeture dès lors qu’il a été édité pendant la session. Un ancien onglet peut donc écraser une version plus récente enregistrée par un autre. Constat architectural, non exécuté en navigateur multi onglets.

Correction : révision numérique et contrôle atomique avant écriture, communication `BroadcastChannel`, et décision explicite si le même TLA a changé ailleurs. La sauvegarde de fermeture devrait écrire seulement une révision réellement modifiée et non encore enregistrée.

### P2 — Certaines opérations locales ne traitent pas les échecs

`App.tsx:257-282` laisse remonter les rejets de création/renommage/suppression de dossier; les appels JSX utilisent `void`, sans message de récupération. La suppression d’un dossier enregistre les TLA séparément puis supprime le dossier : un échec au milieu peut produire une suppression partielle. `storage.ts:9` conserve une promesse d’ouverture unique sans stratégie de récupération après échec.

Correction : transaction unique TLA+dossier, capture des erreurs et retour utilisateur concret. Ajouter un état d’initialisation et de récupération du stockage et une action d’export de secours quand les écritures échouent.

### P2 — Traduction sans délai limite et information tardive sur l’envoi

`translation.ts:21-27` utilise `fetch()` sans signal ni délai; `App.tsx:321-340` attend toute la traduction. Une requête qui ne se termine pas peut laisser le dialogue sur « Traduction en cours ». Fermer le dialogue n’annule pas les requêtes (`App.tsx:558`).

Le titre et tous les libellés sont transmis à MyMemory immédiatement au clic (`App.tsx:331`); la mention d’information n’apparaît que dans le dialogue déjà déclenché (`App.tsx:558`). La promesse générale « Vos données restent privées » dans la barre latérale (`App.tsx:538`) est donc trop large.

Amélioration : expliquer l’envoi à côté de l’action avant son déclenchement, permettre d’exclure titre/cases personnelles, ajouter délai, annulation et reprise des requêtes en échec. Cela décrit les flux de données constatés; aucune conclusion juridique ni politique de conservation du fournisseur n’a été évaluée ici.

## Points solides

- La restauration IndexedDB groupe TLA et dossiers dans une transaction (`storage.ts:20-27`), ce qui évite la restauration partielle au niveau de cette opération.
- Les archives sont identifiées et versionnées, les anciennes sauvegardes sans dossiers sont acceptées, et les conflits d’identifiants déclenchent une confirmation dans l’interface.
- Les sauvegardes PDF et ZIP sont produites dans le navigateur.
- La traduction déduplique les textes et borne déjà sa concurrence à trois requêtes; la copie anglaise reçoit de nouveaux identifiants et le dialogue permet de relire le résultat.
- La recherche manuelle ARASAAC accepte un `AbortSignal` et le paramètre de recherche est encodé.

## Preuves et exécution

`audit/reproductions-fiabilite-2026-10-25.repro.tsx` contient neuf reproductions. Les assertions décrivent volontairement les défaillances actuelles; elles devront être inversées pour devenir des tests de non régression après correction. Rapport machine : `audit/reproductions-fiabilite-2026-10-25.json` (9/9 réussies). Le suffixe `.repro.tsx` exclut ce fichier de la suite standard.

Pour les exécuter avec les autres reproductions du même audit, depuis la racine du dépôt :

```sh
./node_modules/.bin/vitest run --config audit/reproductions-2026-10-25.config.mts
```

Le fichier de reproduction est également vérifié avec ESLint.
