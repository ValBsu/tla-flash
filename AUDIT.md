# Audit TLA Flash — 21 octobre 2026

## Verdict et périmètre

Version examinée et redéployée : commit `a668a10` (`maj2.1`). Aucun correctif fonctionnel n’a été appliqué pendant cet audit. Le projet passe ses contrôles automatisés et le site publié sert le build attendu. La conservation des contenus, les sauvegardes hors connexion et les exports présentent néanmoins quatre défauts prioritaires. La réussite du build ne garantit pas la fiabilité de ces usages.

Audit du code applicatif, stockage, sauvegarde/restauration, réseau, PDF, accessibilité statique, performances, dépendances, PWA et configuration de publication. Les observations distinguent reproduction exécutée, lecture de code et vérification HTTP. Ce rapport ne constitue pas un test d’intrusion exhaustif ni une certification d’accessibilité ou de conformité.

## Publication réalisée

- Production : https://tla-flash.netlify.app
- Déploiement : `6ad8b83c0e321d7cb4cd0c0e`.
- Version figée : https://6ad8b83c0e321d7cb4cd0c0e--tla-flash.netlify.app
- Journal : https://app.netlify.com/projects/tla-flash/deploys/6ad8b83c0e321d7cb4cd0c0e
- Publication manuelle du dossier `dist` après tests, lint et build, sur le site existant relié à `ValBsu/tla-flash`. Aucun nouveau site créé.
- HTML, JS principal, CSS, service worker, manifeste et deux icônes : HTTP 200 et contenu identique aux fichiers locaux par SHA-256.
- Route profonde `/audit-navigation` : retour de `index.html`, conforme au repli SPA.
- En-têtes de sécurité présents : `nosniff`, `DENY`, politique de référent et permissions. `sw.js` servi avec `Cache-Control: no-cache` et portée `/`.

Résultats détaillés : [publication-2026-10-21.json](audit/publication-2026-10-21.json).

## Vérifications

| Contrôle | Résultat |
| --- | --- |
| `npm run test` | 4 fichiers, 13 tests réussis |
| `npm run lint` | Réussi |
| `npm run build` | Réussi, avertissement de taille JS |
| `git diff --check` | Réussi avant rédaction du rapport |
| `npm audit --json` | 2 dépendances vulnérables, sévérité élevée, outils de développement |
| `npm audit --omit=dev --json` | 0 vulnérabilité connue signalée |
| Reproductions ciblées | Doublons, perte d’image après réduction, archives invalides : confirmés |
| HTTPS en production | Vérifié, fichiers et en-têtes contrôlés |
| Navigateur intégré | Échec du service avant ouverture de page ; aucune validation visuelle |

Exécution sous Node `25.2.1`. Netlify et GitHub Actions configurent Node 22. L’installation propre `npm ci` et l’exécution sous Node 22 n’ont pas été vérifiées. L’interrogation npm a nécessité l’accès réseau hors sandbox après un échec DNS initial ; les deux audits ont ensuite répondu normalement.

## Constats prioritaires

P1 : perte de contenu ou sortie essentielle incomplète. P2 : fiabilité, sécurité ou accessibilité importante. P3 : défaut limité ou maintenance.

### 1. P1 — Sauvegarde ZIP sans les images ARASAAC

**Code :** `src/App.tsx:188`, `src/App.tsx:288`, `src/services/backup.ts:86`, `vite.config.ts`.

La sélection et la génération mémorisent l’URL distante dans `imageData`. Le ZIP sérialise les tableaux sans télécharger les images. Le service worker ne configure aucun cache des images ARASAAC. Une sauvegarde transférée sur un autre appareil hors connexion ne contient donc pas les ressources nécessaires à leur affichage. Les images importées en data URL sont, elles, sérialisées.

**Action :** intégrer les images au stockage local dès leur sélection et dans les sauvegardes ; gérer les échecs de téléchargement. Vérifier une restauration dans un navigateur neuf hors connexion.

### 2. P1 — Doublons dans une liste : des mots disparaissent

**Code :** `src/App.tsx:261`, `src/App.tsx:280`, `src/domain/layout.ts:36`.

**Reproduction exécutée :** grille 1 × 2, propositions `oui, oui, non`. Le moteur déduplique et place `oui, non`, puis l’association des pictogrammes réutilise les anciens indices : résultat `OUI, OUI`, sans débordement. « non » est perdu. La reproduction réexécute le moteur et la transformation des propositions, sans interface navigateur.

**Action :** dédupliquer avant la recherche et utiliser une liste commune au placement et à l’association des images. Ajouter un test du parcours de génération avec doublons.

### 3. P1 — Réduire la grille perd les images et les styles hors grille

**Code :** `src/domain/layout.ts:4`.

**Reproduction exécutée :** case « NON » avec image et grand texte, réduction 1 × 2 vers 1 × 1 puis retour à 1 × 2. Le mot reste dans `overflowWords`, les cases ajoutées sont vides et l’image a disparu. Le modèle de débordement ne conserve que des chaînes ; l’historique temporaire permet seulement une annulation immédiate.

**Action :** conserver les cellules complètes retirées et permettre leur réinsertion, avec avertissement avant une réduction destructive.

### 4. P1 — Export PDF incomplet sans avertissement

**Code :** `src/services/pdf.ts:9`, `:27`, `:80`, `:109`.

Après deux échecs de chargement, `fetchImageData` retourne `undefined`. Le PDF est généré sans pictogramme et sans signaler cette omission. Les chargements n’ont pas de délai maximal explicite. Constat de code ; aucune génération PDF réelle dans un navigateur pendant cet audit.

**Action :** identifier les images indisponibles, borner les chargements et demander une décision explicite avant une sortie incomplète.

## Fiabilité, sécurité et confidentialité

### 5. P2 — Validation trop permissive des archives

**Code :** `src/services/backup.ts:20`, `:42`, `:63`, `:100`.

**Reproduction exécutée :** `rows: 0`, `columns: -1` et dates invalides sont acceptés. Les dimensions maximales, positions, nombre de cellules, identifiants uniques et références de dossier ne sont pas validés. Les URL d’image sont acceptées comme chaînes ; elles peuvent déclencher une requête vers un tiers à l’affichage. Aucun plafond de taille de fichier ou de contenu JSON décompressé n’est imposé, ce qui expose à une consommation mémoire importante.

**Action :** schéma métier strict, bornes adaptées aux grilles 10 × 15, unicité et cohérence des références, validation des sources d’images, plafonds avant et pendant décompression. Aucune exécution de script démontrée.

### 6. P2 — Réponses asynchrones pouvant rétablir un ancien état

**Code :** `src/App.tsx:262`, `:296`, `:348`.

La recherche en lot termine même après édition de la liste ou fermeture de la fenêtre. La traduction ne possède pas d’identifiant d’opération. `FileReader.onload` utilise le tableau et la cellule capturés au lancement ; un changement de tableau entre-temps peut rétablir l’ancien tableau. Constat de code, sans reproduction temporelle en navigateur.

**Action :** cibler les écritures par identifiant de tableau et de cellule, vérifier la révision et ignorer ou annuler les réponses périmées.

### 7. P2 — Statut de sauvegarde global peu fiable

**Code :** `src/App.tsx:51`, `:60`, `:72`.

L’application affiche « Enregistré sur cet appareil » après la lecture de la bibliothèque, alors que le tableau vierge initial n’a pas été écrit. Une sauvegarde ancienne peut remettre l’indicateur à « saved » pendant qu’une autre écriture reste en cours. Chaque changement réécrit un tableau entier ; l’état éditable reste attaché à l’identifiant après réouverture. Les événements de fermeture ne garantissent pas l’achèvement d’une écriture IndexedDB.

**Action :** suivre la persistance par tableau et révision ; distinguer tableau neuf, modification en cours et révision effectivement écrite. Ne pas dépendre de la fermeture pour conserver les changements.

### 8. P2 — Suppression échouée : tableau marqué supprimé en mémoire

**Code :** `src/App.tsx:211`.

`removeBoard` ajoute l’identifiant dans `deletedBoardIds` et le retire des tableaux éditables avant d’attendre IndexedDB. Le `catch` affiche une erreur mais ne restaure pas ces ensembles. Si la suppression échoue, les changements suivants peuvent ne plus être sauvegardés pour ce tableau jusqu’au rechargement. Scénario déduit du code, non simulé.

**Action :** restaurer les marqueurs dans le chemin d’échec ou ne les valider qu’après succès, avec gestion des écritures déjà en cours.

### 9. P2 — Dossiers et partage : erreurs non traitées

**Code :** `src/App.tsx:232`, `:248`, `:441`, `src/services/storage.ts`.

Création, renommage, suppression de dossier et partage peuvent rejeter leur promesse sans retour utilisateur adapté. La suppression de dossier enregistre chaque tableau séparément avant de supprimer le dossier ; une interruption peut laisser un classement partiel. Le téléchargement de secours du partage ne libère pas son URL Blob.

**Action :** transaction commune pour les dossiers et tableaux concernés, traitement des erreurs, traitement distinct de l’annulation du partage et libération des URL.

### 10. P2 — Deux dépendances de développement vulnérables

Résultat actuel du registre npm :

| Dépendance installée | Signalement | Exposition |
| --- | --- | --- |
| `source-map-js@1.2.1` | Déni de service via certaines source maps, GHSA-68fv-2mgg-jv7q | Dépendance transitive PostCSS/css-tree, outils de développement |
| `vite@8.3.0` | Trois avis sur `launch-editor`, dont un classé élevé | Serveur et outils de développement, scénarios liés aux éditeurs/Windows |

Avis : https://github.com/advisories/GHSA-68fv-2mgg-jv7q ; https://github.com/advisories/GHSA-698v-4r3x-3vcv ; https://github.com/advisories/GHSA-r825-w8mm-5pxw ; https://github.com/advisories/GHSA-587h-7wmj-h5pm.

Le registre indique des correctifs disponibles. Zéro vulnérabilité connue dans l’audit des dépendances de production ne prouve pas l’absence de défaut. Aucun de ces signalements ne démontre une exploitation du site statique publié.

**Action :** mettre à jour le lockfile avec les versions corrigées compatibles, puis réexécuter installation propre, audit, tests, lint et build. Aucun `npm audit fix` ni changement de dépendance pendant cet audit.

### 11. P2 — Import d’images sans bornes ni normalisation

**Code :** `src/App.tsx:348`.

Le fichier est lu intégralement en base64, sans limite, contrôle du décodage, réduction des dimensions ni gestion d’erreur FileReader. `accept="image/*"` ne valide pas le contenu. De grandes photos peuvent saturer mémoire et quota IndexedDB ; certains formats acceptés par le sélecteur peuvent échouer lors de l’export PDF.

**Action :** décoder et normaliser en PNG/JPEG, limiter dimensions et poids, conserver un message d’échec clair.

### 12. P2 — Communications externes et information utilisateur

**Code :** `src/services/arasaac.ts`, `src/services/translation.ts`, `src/index.css:1`, `src/App.tsx:522`.

Les termes recherchés vont à ARASAAC ; titre et libellés vont à MyMemory ; les polices sont chargées depuis Google Fonts. L’information sur la traduction apparaît dans la fenêtre alors que l’appel est déjà lancé. Les ZIP ne sont pas chiffrés. Le stockage local ne signifie donc pas que tous les traitements restent sur l’appareil.

**Action :** informer avant l’envoi du texte, héberger les polices localement et préciser les limites du mode hors connexion. Pas de validation juridique ou de licence effectuée.

## Interface, accessibilité et performances

### 13. P2 — Aperçu différent du PDF

**Code :** `src/App.tsx:521`, `src/App.css:13`, `src/services/pdf.ts:92`, `:100`, `:118`.

L’aperçu est du HTML, pas le PDF généré. Il montre « Ajouter » dans les cases vides alors que le PDF les omet. L’écran tronque les libellés sur une ligne ; le PDF les renvoie à la ligne sans contrôler la hauteur restante. Le titre long n’est pas ajusté et aucune police Unicode n’est embarquée. A4 reste écrit en dur dans l’aperçu alors que A3 est accepté dans le modèle.

**Action :** afficher le PDF réel et valider des titres longs, libellés longs, accents et symboles. Vérifier la lisibilité des grilles maximales.

### 14. P2 — Dialogues et commandes peu accessibles au clavier

**Code :** `src/App.tsx:511`, `:521`, `:522`, `:563`, `:576`, `src/App.css:13`.

Pas de rôle de dialogue, `aria-modal`, confinement du focus, restauration du focus ni fermeture Échap pour les fenêtres principales. Plusieurs fermetures et champs manquent de nom explicite. Les notifications ne sont pas des zones d’annonce. Les actions de case deviennent visibles au survol mais pas au focus. Le déplacement utilise le glisser-déposer natif sans alternative explicite au clavier. Le sélecteur de grille ajoute 150 boutons à la navigation, sans navigation fléchée de grille.

**Action :** composant de dialogue accessible partagé, libellés, annonces, visibilité au focus et commandes de déplacement. Vérification manuelle avec lecteur d’écran et tablette nécessaire ; aucun score WCAG revendiqué.

### 15. P2 — Toute la bibliothèque rendue à chaque modification

**Code :** `src/App.tsx:104`, `:507`, `src/services/storage.ts:18`.

Tous les tableaux sont chargés avec `getAll` puis intégralement rendus, y compris leurs images. Les filtres de bibliothèque ne filtrent pas les pages centrales. Une frappe entraîne une modification d’état applicatif et une écriture du tableau complet. Ce comportement risque de ralentir les bibliothèques volumineuses ; aucun seuil mesuré.

**Action :** rendre le tableau actif ou les pages visibles, clarifier la portée des filtres et mesurer sur tablette avec une bibliothèque réaliste.

### 16. P2 — JavaScript initial volumineux

**Mesure du build :** chunk principal 676,41 ko, 216,27 ko gzip ; pré-cache PWA 1 199,40 Kio pour 19 entrées. Le PDF est importé immédiatement (`src/App.tsx:9`), à la différence de la sauvegarde et de la traduction.

**Action :** importer le PDF à la demande, examiner les dépendances d’export et mesurer les temps de démarrage sur appareil cible. L’avertissement de taille ne prouve pas à lui seul un ralentissement perceptible.

### 17. P2 — Mise à jour PWA et conservation non vérifiées en conditions réelles

**Code :** `vite.config.ts` : `registerType: 'autoUpdate'` et pré-cache de l’interface.

Le service worker et le manifeste sont publiés, mais aucun scénario d’installation, de mise à jour avec modifications en cours, de redémarrage hors connexion ou de concurrence entre onglets n’a été exécuté. Les appels réseau externes ne sont pas mis en cache par cette configuration.

**Action :** tester ancienne version installée → nouvelle publication, édition active, fermeture/réouverture et réseau coupé. Ce point est une lacune de validation, pas une panne démontrée.

### 18. P3 — Défauts d’état et de présentation

- La recherche affiche « Aucun résultat » dès qu’un terme est prérempli, avant le premier appel (`SearchPanel`).
- Le logo emploie `/favicon.svg` au lieu de la base Vite : chemin erroné sur GitHub Pages en sous-répertoire (`src/App.tsx:452`).
- Le sélecteur CSS des favoris colore le premier bouton, désormais celui du crayon, plutôt que l’étoile (`src/App.css:13`).
- Le modèle conserve des mots en débordement mais le rendu courant ne contient plus de notification `overflow-notice` : ces mots ne sont pas présentés dans l’éditeur principal.

**Action :** distinguer état initial et recherche terminée, utiliser `import.meta.env.BASE_URL`, cibler les actions par classe et rétablir un accès clair aux mots hors grille.

### 19. P3 — Publication et configuration à consolider

- Le manifeste est servi en `application/octet-stream`, constat HTTP ; utiliser `application/manifest+json`. Cela ne démontre pas à lui seul un échec d’installation.
- Les assets fingerprintés utilisent `public,max-age=0,must-revalidate` ; un cache long `immutable` pourrait limiter les revalidations.
- Netlify construit sans exécuter test/lint dans `netlify.toml`, contrairement au workflow GitHub Pages. Le présent déploiement a été précédé des trois contrôles.
- `.netlify/netlify.toml` est suivi par Git et contient un chemin absolu propre à cette machine ; configuration générée à exclure du dépôt.
- Absence de CSP : durcissement envisageable après inventaire des ressources et test des exports. Aucune faille XSS démontrée ; les textes sont rendus par React et aucune injection HTML explicite n’a été trouvée dans les sources examinées.

## Couverture et points solides

Les 13 tests couvrent le moteur de placement, le format de sauvegarde, le parsing de traduction et trois comportements de l’interface : impression simulée, suppression ciblée et commandes propres à chaque tableau. Les dépôts et le PDF sont simulés dans les tests UI : cela ne vérifie ni IndexedDB réel ni le rendu d’un PDF.

Points solides : typage TypeScript, logique métier partiellement isolée, restauration multi-store transactionnelle, confirmation des conflits, confirmation des suppressions, contrôle des erreurs HTTP, HTML en français, en-têtes de sécurité réellement appliqués et pipeline GitHub avec test/lint/build.

Les changements récents ont amélioré les commandes par tableau, les libellés associés et l’ouverture de l’impression. Les principaux défauts de conservation signalés le 6 octobre restent présents.

## Ordre de correction

1. Conserver les images dans le stockage et les sauvegardes ; corriger la génération avec doublons et le redimensionnement destructif.
2. Rendre les PDF incomplets explicites et afficher le véritable PDF en aperçu.
3. Renforcer la validation des archives, gérer les réponses périmées et fiabiliser les révisions sauvegardées et les chemins d’échec.
4. Corriger les dépendances de développement et imposer les contrôles avant chaque publication automatique.
5. Améliorer dialogues et navigation clavier, réduire le chargement initial et mesurer une bibliothèque volumineuse sur tablette.
6. Valider installation et mise à jour PWA, restauration hors connexion, impression physique et Safari/iPad.

## Preuves et limites

- [Reproductions ciblées](audit/reproductions-2026-10-21.json).
- [Contrôles HTTP de production](audit/publication-2026-10-21.json).
- [Audit précédent conservé](audit/AUDIT-2026-10-06.md).

Le navigateur intégré a échoué avant l’ouverture d’une page avec une erreur de configuration du service (`missing field sandboxPolicy`). Aucune capture, validation visuelle, interaction tactile, impression physique ou mesure Lighthouse n’a été réalisée. Aucune restauration ZIP complète dans un vrai navigateur, simulation de quota, test de concurrence entre onglets ou vérification Safari/iPad. Les scénarios non exécutés sont présentés comme lectures de code ou limites. Aucune modification des tableaux stockés chez les utilisateurs, aucun push Git et aucune correction applicative pendant l’audit.
