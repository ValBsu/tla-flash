# Audit de TLA Flash — 6 octobre 2026

Audit de l’état local, y compris les huit fichiers modifiés avant l’audit. Aucun correctif fonctionnel appliqué. La compilation a régénéré `dist`, qui est ignoré par Git.

## Verdict

Le projet compile et les contrôles existants passent. Il présente toutefois des défauts de conservation des contenus, de génération en lot et d’export qui doivent être corrigés avant de considérer son usage hors connexion et ses sauvegardes comme fiables. Aucun problème critique exploitable en production n’a été établi par cet audit.

Priorités : P1 = contenu perdu ou sortie essentielle incomplète ; P2 = fiabilité, accessibilité ou maintenance importante ; P3 = amélioration limitée.

## Vérifications exécutées

| Contrôle | Résultat |
| --- | --- |
| `npm run test` | 3 fichiers, 10 tests réussis |
| `npm run lint` | Réussi |
| `npm run build` | Réussi ; avertissement de taille de bundle |
| `git diff --check` | Réussi |
| `npm audit --json` | 1 vulnérabilité élevée dans une dépendance de développement |
| `npm audit --omit=dev --json` | 0 vulnérabilité connue signalée |
| Scénarios exécutés avec les fonctions du projet | Doublons, réduction de grille et validation d’archive reproduits |
| Navigateur intégré | Connexion impossible : erreur du service d’exécution avant navigation |

Tests locaux exécutés avec Node 25.2.1 ; les configurations Netlify et GitHub Actions demandent Node 22. L’installation propre et la compilation avec Node 22 n’ont pas été vérifiées.

## Constats prioritaires

### 1. P1 — Les pictogrammes ARASAAC ne sont pas sauvegardés comme images locales

**Preuve :** `src/App.tsx:183` et `src/App.tsx:284` enregistrent une URL distante dans `imageData`. `src/services/backup.ts:87` sérialise les tableaux sans télécharger leurs images. `vite.config.ts` ne définit aucun cache des images distantes.

**Conséquence :** une sauvegarde ZIP contient les liens ARASAAC, mais pas les fichiers correspondants. Sur un autre appareil hors connexion, les pictogrammes ne sont pas disponibles ; sur le même appareil, leur présence dépend du cache ordinaire du navigateur. Le stockage local des tableaux ne garantit donc pas celui de leurs illustrations.

**Correction :** intégrer les images à l’importation ou dans un stockage local dédié, inclure les ressources dans les archives, gérer leurs échecs et vérifier une restauration hors connexion sur un nouveau navigateur.

### 2. P1 — Une liste avec doublons peut perdre des mots

**Preuve :** `src/domain/layout.ts:37` déduplique les mots, tandis que `src/App.tsx:278–284` réapplique les propositions par leur ancien index.

**Reproduction exécutée :** grille de deux cases, propositions `oui, oui, non`, chacune avec un pictogramme. `placeWords` produit `oui, non`, puis l’application produit `OUI, OUI`, avec un débordement vide. « non » disparaît.

**Correction :** dédupliquer avant la recherche et employer la même liste pour le placement et l’association des images. Ajouter un test de génération complète avec doublons et débordement.

### 3. P1 — Réduire une grille abandonne les images et styles des cases retirées

**Preuve :** `src/domain/layout.ts:18` ne conserve dans le débordement que les libellés.

**Reproduction exécutée :** une case contenant « NON », une image importée et du grand texte est retirée par une réduction, puis la grille est agrandie. « NON » reste dans les mots en attente ; la nouvelle case est vide et l’image et le style ne sont plus dans le tableau. L’historique temporaire permet une annulation immédiate, mais n’est pas sauvegardé après rechargement.

**Correction :** conserver des cellules complètes hors grille et permettre leur réinsertion. Prévenir l’utilisateur avant une réduction qui retire du contenu.

### 4. P1 — Le PDF peut être téléchargé avec des pictogrammes manquants sans avertissement

**Preuve :** `src/services/pdf.ts:28–43` convertit un double échec de téléchargement en `undefined`. L’export continue sans image à `src/services/pdf.ts:109`.

**Scénario déduit du code :** service d’images indisponible, réseau coupé ou URL invalide. Le libellé est imprimé mais le pictogramme manque ; l’utilisateur reçoit néanmoins un PDF.

**Correction :** compter et identifier les images indisponibles ; proposer de réessayer ou de télécharger explicitement une sortie incomplète. Ajouter un délai maximal aux chargements.

## Fiabilité et sécurité

### 5. P2 — Validation insuffisante des archives

**Preuve :** `src/services/backup.ts:42–70` vérifie les types mais pas les bornes positives, les dimensions maximales, le nombre et les positions des cellules, l’unicité des identifiants, les dates, ni les schémas et domaines des URL d’images. `readBackupFile` ne borne pas la taille du fichier JSON décompressé.

**Reproduction exécutée :** une archive comportant `rows: 0`, `columns: -1` et des dates invalides est acceptée.

**Conséquence :** import de tableaux incohérents, mise en page ou PDF défectueux, écrasement ambigu en cas d’identifiants dupliqués, consommation mémoire excessive avec une grosse archive. Une URL d’image arbitraire peut aussi déclencher une requête vers un tiers dès l’affichage ; aucune exécution de script n’a été démontrée.

**Correction :** valider les invariants métier, limiter les tailles et contrôler les sources d’images avant la transaction de restauration.

### 6. P2 — Les traitements asynchrones peuvent réutiliser un état obsolète

**Preuve :** `src/App.tsx:258–274` remplace les propositions lorsque la recherche se termine, même si la liste a été changée ou la fenêtre fermée entre-temps. Le champ reste éditable pendant le traitement (`src/App.tsx:509`). `importImage` (`src/App.tsx:344`) utilise le tableau et la cellule capturés au lancement du FileReader. La traduction ne possède pas de mécanisme qui écarte une réponse ancienne.

**Scénarios déduits :** modifier la liste avant la fin des recherches peut insérer les anciennes propositions ; importer une grande image puis changer de tableau peut ramener l’ancien tableau et son ancien contenu.

**Correction :** identifier chaque opération, ignorer les réponses périmées, annuler à la fermeture et appliquer les changements au tableau ciblé par identifiant.

### 7. P2 — Les opérations de dossier et le partage ne gèrent pas leurs erreurs

**Preuve :** `createFolder`, `renameFolder`, `removeFolder` et `shareBoard` dans `src/App.tsx` sont appelées avec `void` mais ne possèdent pas de gestion d’exception. La suppression d’un dossier utilise plusieurs sauvegardes puis une suppression, sans transaction commune.

**Conséquence :** une erreur IndexedDB ou un échec de partage peut rester sans retour compréhensible. Une suppression de dossier interrompue peut ne déplacer qu’une partie des tableaux. Le téléchargement de secours du partage crée aussi une URL Blob sans la libérer.

**Correction :** retour utilisateur pour les échecs, traitement distinct de l’annulation du partage, transaction de suppression de dossier et libération des URL.

### 8. P2 — L’indicateur de sauvegarde n’atteste pas la sauvegarde du tableau courant

**Preuve :** `src/App.tsx:53–56` affiche « Enregistré » après la lecture de la bibliothèque, alors que le tableau vierge initial n’a pas été écrit. Chaque sauvegarde terminée positionne ensuite le même indicateur global à « saved » (`src/App.tsx:65–69`), même si une sauvegarde plus récente est encore en cours. Un tableau ouvert puis modifié reste marqué comme éditable ; le rouvrir peut provoquer une réécriture et modifier sa date.

**Correction :** suivre l’état de persistance par tableau et par révision, distinguer un tableau neuf non enregistré, et ne sauvegarder que les changements métier. Les écritures sur fermeture de page ne doivent pas constituer une garantie de conservation.

### 9. P2 — Vulnérabilité dans les outils de développement

`npm audit` identifie `source-map-js@1.2.1`, utilisé par PostCSS/Vite et css-tree/jsdom. Le traitement de certaines source maps peut bloquer la boucle d’événements. La version corrigée indiquée est 1.2.2 : https://github.com/advisories/GHSA-68fv-2mgg-jv7q

La vulnérabilité est classée élevée par le registre ; sa présence ne démontre pas une attaque contre le site statique publié. L’audit sans dépendances de développement ne signale aucune vulnérabilité connue.

**Correction :** mettre à jour la dépendance transitive dans le lockfile puis vérifier l’audit, les tests et le build. Aucun `npm audit fix` n’a été exécuté.

### 10. P2 — Import d’images sans contrôle de taille ou de compatibilité

**Preuve :** `src/App.tsx:344–348` lit intégralement le fichier en base64 sans limite, réduction de résolution ni gestion d’erreur du FileReader. `accept="image/*"` est un filtre du sélecteur, pas une validation du contenu. Le PDF choisit principalement entre PNG et JPEG.

**Conséquence :** photos volumineuses dans IndexedDB, consommation mémoire, quota atteint, erreurs possibles avec des formats admis par le sélecteur mais incompatibles avec l’export.

**Correction :** vérifier le décodage, normaliser dans un format accepté par l’export, réduire les dimensions et limiter la taille finale.

## Interface, accessibilité et exports

### 11. P2 — L’aperçu ne représente pas fidèlement le PDF

**Preuve :** `src/App.tsx:515` réutilise les composants HTML et affiche les cases vides avec « Ajouter ». `src/services/pdf.ts:100` omet entièrement les cases sans libellé. L’écran tronque les textes sur une ligne (`src/App.css:13`) ; le PDF permet leur retour à la ligne (`src/services/pdf.ts:118`) sans vérifier leur hauteur. Les polices et les règles de taille diffèrent également ; un titre long n’est pas ajusté dans le PDF.

**Correction :** afficher le PDF réellement généré pour l’aperçu et vérifier les libellés longs, accents, symboles et titres longs. Prévoir une police embarquée pour les caractères non couverts par Helvetica.

### 12. P2 — Accessibilité des fenêtres et des commandes incomplète

**Preuve :** les fenêtres de recherche, liste, traduction et aperçu n’ont pas de rôle de dialogue, de `aria-modal`, de confinement du focus, de retour au déclencheur ni de fermeture avec Échap. Plusieurs boutons de fermeture et champs n’ont pas de nom accessible explicite. Les notifications n’utilisent pas de zone d’annonce. Les commandes de case sont rendues transparentes hors survol sans règle `:focus-within` (`src/App.css:13`).

**Conséquence :** navigation clavier et lecteur d’écran difficile, focus susceptible de sortir d’une fenêtre ouverte, commandes accessibles au clavier mais invisibles. Le déplacement des cases dépend du drag-and-drop natif et n’offre pas d’alternative clavier ou tactile explicite.

**Correction :** composant de dialogue accessible partagé, noms de commandes, annonces de statut, visibilité au focus et déplacement par boutons. Une vérification manuelle sur tablette et avec lecteur d’écran reste nécessaire.

### 13. P2 — Le chargement et le rendu de toute la bibliothèque limitent la montée en volume

**Preuve :** `src/services/storage.ts` charge tous les tableaux avec `getAll`. `src/App.tsx:104` rassemble tous les tableaux, et `src/App.tsx:500` les affiche intégralement, même lorsqu’un dossier ou les favoris sont sélectionnés. Chaque modification d’une cellule provoque une sauvegarde du tableau complet et un nouveau rendu de l’application.

**Conséquence :** croissance du DOM, des décodages d’images et du travail à chaque frappe. Les filtres affectent la liste latérale, pas les pages centrales. Aucun seuil de ralentissement n’a été mesuré.

**Correction :** rendre le tableau actif ou les pages visibles, appliquer les filtres conformément au comportement voulu, séparer les composants et maîtriser la fréquence des écritures.

### 14. P2 — Bundle initial lourd

**Mesure :** le principal fichier JS construit pèse 675,52 ko, soit 215,90 ko gzip. Le préchargement PWA représente environ 1,2 Mio. `src/App.tsx:9` importe le générateur PDF dès le chargement de l’application, alors que sauvegarde et traduction utilisent un import différé.

**Correction :** charger le PDF à la demande et mesurer le démarrage et l’interaction sur tablette. Un avertissement de bundle ne prouve pas à lui seul un ralentissement utilisateur.

### 15. P3 — Défauts mineurs de recherche, format et état visuel

- `src/App.tsx:549` affiche « Aucun résultat » dès qu’un terme prérempli existe, avant toute recherche.
- `src/App.tsx:444` utilise `/favicon.svg` au lieu de la base Vite ; le logo vise la racine du domaine sur GitHub Pages.
- Le bandeau et l’aperçu indiquent A4 en dur (`src/App.tsx:498`, `515`), alors que les archives acceptent A3 et le PDF le prend en charge.
- `src/App.css:13` colore le premier bouton des favoris ; depuis l’ajout du bouton de remplacement, ce premier bouton est le crayon plutôt que l’étoile.
- Les mots en attente du tableau actif sont affichés dans `BoardSheet` et une seconde fois dans le composant principal.
- « Revoir la sélection » ouvre la liste courante, sans la remplir avec les mots en attente.

**Correction :** états de recherche distincts, chemins relatifs à la base, format dérivé du tableau, sélecteurs CSS propres aux actions et gestion explicite du débordement.

## Architecture et couverture des tests

`App.tsx` concentre l’état métier, la persistance, les opérations réseau et l’interface. Les dix tests couvrent le placement, quelques validations d’archive et le parsing des traductions. Ils ne couvrent pas la sauvegarde IndexedDB, une restauration ZIP réelle, le PDF, les composants, les changements de tableau pendant une opération, ni le service worker.

Points solides : typage TypeScript, logique de placement isolée, transaction de restauration sur les tableaux et dossiers, contrôle du format versionné, confirmation des conflits d’import et des suppressions, contrôle des réponses HTTP, pipeline GitHub test/lint/build, absence de compte ou de serveur de données supplémentaire.

Ajouter en priorité des tests qui reproduisent les constats 2, 3, 5 et 6, puis une restauration/export complète avec des images et une vérification de conservation après rechargement. Éviter de multiplier les tests qui ne font que recopier l’implémentation.

## Publication et confidentialité

Les fichiers de publication existent pour Netlify et GitHub Pages. Netlify utilise le build mais n’exécute pas les tests ou le lint dans sa commande ; GitHub Actions les exécute. Les en-têtes Netlify ne prouvent pas que le site distant les applique et ne configurent pas GitHub Pages. Aucune URL publiée n’a été auditée.

Les requêtes externes comprennent ARASAAC, MyMemory et Google Fonts (`src/index.css:1`). Les tableaux restent dans IndexedDB, mais les termes de recherche et de traduction sortent du navigateur. La fenêtre de traduction l’indique après déclenchement du traitement ; le pied de page « Vos données restent privées » mériterait une formulation plus précise. Les archives ZIP ne sont pas chiffrées.

Améliorations : héberger les polices localement, expliquer les transmissions au bon endroit et restreindre les sources de ressources si une politique CSP est ajoutée. L’audit n’est pas une validation juridique, de conformité institutionnelle ou de licence ARASAAC.

## Ordre de traitement recommandé

1. Corriger les doublons et conserver les cellules complètes hors grille.
2. Stocker les images localement et garantir leur présence dans les ZIP.
3. Signaler les PDF incomplets et utiliser le PDF réel comme aperçu.
4. Valider les invariants des archives et sécuriser les opérations asynchrones et la persistance.
5. Mettre à jour `source-map-js`, compléter les tests des scénarios précédents.
6. Corriger l’accessibilité, puis mesurer et optimiser les performances sur tablette.

## Limites

L’inspection du code et les commandes ont été exécutées ; les défauts explicitement marqués comme reproduits l’ont été avec les fonctions du projet. Les autres scénarios sont déduits du code. Le navigateur intégré a échoué avant l’ouverture du site, donc aucune capture ni validation visuelle n’est fournie. Impression physique, Safari/iPad, partage natif, installation PWA, mise à jour hors connexion, concurrence entre onglets, quota IndexedDB et charge importante restent à tester. Aucun défaut supposé dans ces domaines n’est présenté ici comme mesuré.
