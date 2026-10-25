# Améliorations de TLA Flash — 25 octobre 2026

Les corrections et améliorations sont intégrées au projet local. Les sauvegardes existantes restent au format 1 ; le stockage IndexedDB passe de la version 3 à la version 4 avec une migration testée. Aucun déploiement distant n’a été effectué.

**Conservation du travail**

- La suppression utilise une corbeille récupérable. Une suppression échouée ne désactive plus les sauvegardes suivantes.
- Les imports photo s’appliquent à la version courante de la cellule, sans rétablir un ancien titre ou rouvrir un tableau quitté.
- Une réduction de grille conserve les cellules retirées, leurs identifiants, images et styles. Elles reviennent à l’agrandissement ou se réinsèrent depuis la réserve.
- Une file de sauvegarde ordonne les écritures par TLA et regroupe les modifications arrivées pendant une écriture. Les versions locales en attente restent disponibles lors d’un aller-retour entre deux tableaux.
- Les révisions de stockage empêchent un onglet ancien de remplacer silencieusement le travail d’un autre. L’utilisateur peut conserver sa version en copie ou en ZIP.
- La fermeture d’un onglet ne réécrit plus systématiquement son ancien état. Le statut de sauvegarde reflète la fin des écritures en attente.
- La suppression de dossier est transactionnelle. Les restaurations et réorganisations bloquent temporairement les éditions afin de préserver la cohérence entre sauvegarde et transaction.

**Sauvegardes et médias**

Les ZIP embarquent les images des cellules visibles et de leur réserve. Un échec de chargement produit un message explicite et empêche le téléchargement d’une archive incomplète. Les anciennes références de pictogrammes sont reconstruites pour l’hébergement courant. Les imports vérifient dimensions, nombre et positions des cases, identifiants, dates, références de dossiers, types d’image et limites de ressources. Les archives existantes correctement formées restent prises en charge.

Les nouvelles photos sont préparées à 1 600 pixels maximum sur leur plus grand côté, avec une limite de fichier de 20 Mio et conservation de la transparence. Les photos déjà présentes n’ont pas été recompressées. Le stockage séparé des Blob n’a pas été introduit : cela aurait ajouté une migration plus large. La normalisation des nouveaux imports réduit déjà les volumes réécrits.

**Rapidité et hors connexion**

La banque Sclera est normalisée une seule fois et les résultats récents sont mis en cache. Les recherches de changement de banque sont dédupliquées. Les opérations réseau disposent de délais maximaux, d’une concurrence limitée et d’une annulation ; les anciennes réponses ne remplacent pas les nouvelles.

La vue continue des tableaux est conservée, avec montage des pages proches de l’écran. Les images utilisent le chargement différé. Le moteur PDF se charge lors de son utilisation. Les polices DM Sans et Space Grotesk sont servies localement, avec leurs licences dans le dépôt et le site produit.

**Préparer hors connexion** télécharge explicitement les images du TLA et de sa réserve, ARASAAC compris, et indique leur disponibilité. **Protéger le stockage local** demande la persistance au navigateur et affiche son état. L’export ZIP reste une sauvegarde indépendante du stockage du navigateur.

**Création et navigation**

- Recherche de titres et de mots dans la bibliothèque, miniatures et filtres ; le tableau actif reste à l’écran pour préserver le contexte d’édition.
- Duplication avec de nouveaux identifiants pour le tableau et ses cellules.
- Modèles Repas, Émotions et Sortie, suivis d’une vérification des propositions de pictogrammes.
- Liste de mots normalisée avant recherche et insertion, sans décalage dû aux doublons.
- Choix entre remplissage des cases vides et remplacement du contenu ; variantes de pictogrammes consultables avant insertion.
- Option de passage automatique à la prochaine case vide.
- Déplacement ou échange de cellule par une liste de destinations, utilisable au clavier et au toucher.
- Sélecteur de grille avec saisie numérique, navigation par flèches et cibles agrandies.
- Reprise du dernier tableau ouvert, annulation et rétablissement conservés sur mobile, raccourcis clavier hors champs de saisie.
- Dialogues accessibles avec gestion du focus et fermeture Échap ; messages de statut et d’erreur annoncés aux aides techniques.

**PDF et impression**

L’aperçu utilise le PDF généré, réutilisable pour télécharger ou imprimer. Les erreurs d’image précisent les légendes concernées. Les téléchargements sont limités en concurrence et dédupliqués. Les textes sont bornés à leur zone, les cases vides sont dessinées et les formats A4/A3 sont pris en charge. Les TLA affichés dans la bibliothèque ou un dossier peuvent être exportés en PDF multipage.

Une légende trop longue peut être réduite ou abrégée pour rester dans sa case : l’aperçu doit être relu pour vérifier sa lisibilité, surtout sur une grille dense. La disponibilité du lecteur PDF intégré et du partage natif dépend du navigateur ; le téléchargement reste disponible.

**Mesures et vérifications**

| Contrôle | Résultat |
| --- | --- |
| Suite habituelle | **83 tests réussis**, dans 12 fichiers, contre 19 tests initialement |
| ESLint | Réussi |
| TypeScript | Mode strict activé, compilation réussie |
| Build production | Réussi, puis reconstruit avec succès pour vérifier le nettoyage |
| Audit npm complet après mises à jour compatibles | **0 vulnérabilité signalée**, contre 9 paquets affectés lors de l’audit initial |
| JavaScript principal minifié | **306,35 ko**, contre 680,09 ko |
| JavaScript principal gzip, mesure du build | **93,96 ko**, contre 217,44 ko, soit environ **57 % de moins** |
| Bibliothèque réelle de test | 50 TLA × 150 cases ; **300 cartes montées**, 48 pages différées, pour 7 500 cases logiques |
| Recherche locale, calcul Node isolé | Premier chargement JSON + préparation + recherche : **32,11 ms** ; 150 recherches en cache chaud : médiane **0,140 ms** |

Le benchmark utilise le module produit, construit dans un dossier temporaire isolé, avec l’index réel. Les résultats sont identiques à l’ancien algorithme sur les dix termes vérifiés et l’index n’est chargé qu’une fois. Le cache chaud ne mesure ni React, ni les images, ni un réseau ou une tablette ; son ratio ne doit pas être présenté comme une accélération globale de l’application.

La baisse du JavaScript principal concerne le chargement et l’exécution initiaux. Le précache PWA conserve les chunks différés et ajoute les polices locales ; son volume est d’environ 1 862 Kio. Le volume total d’installation n’a donc pas diminué dans la même proportion.

Les essais Chromium utilisent de vraies pages et IndexedDB, avec des données de test inventées. Ils couvrent persistance après rechargement, redimensionnement avec photo et styles, recherche Sclera locale, préparation hors connexion, duplication, filtre, corbeille, ZIP autonome avec restauration, PDF A4 réel, conflit entre onglets, écran de 360 px sans débordement horizontal et réouverture hors connexion. Aucun contenu personnel n’a été utilisé.

La CI vérifie désormais les pull requests, le code, la construction et les dépendances de production. Les permissions de publication sont limitées au job de déploiement sur un push de `main`. Une erreur intermittente de nettoyage de `dist`, liée à la recréation d’un fichier macOS `.DS_Store`, est traitée par un nettoyage borné au dossier généré avec tentatives supplémentaires.

**Preuves conservées**

- [Journal du contrôle complet](check-after-2026-10-25.log).
- [Audit npm après correction](dependencies-after-2026-10-25.json).
- [Parcours Chromium](verification-browser-2026-10-25.json) et [script](verification-browser-2026-10-25.mjs).
- [Bibliothèque de 7 500 cases](verification-bibliotheque-2026-10-25.json) et [capture](verification-bibliotheque-2026-10-25.png).
- [Benchmark du service réel](benchmark-search-after-2026-10-25.json) et [script](benchmark-search-after-2026-10-25.mjs).
- [Capture ordinateur](verification-desktop-2026-10-25.png), [capture mobile](verification-mobile-2026-10-25.png), [PDF produit](verification-export-2026-10-25.pdf) et [rendu du PDF](verification-pdf-2026-10-25.png).

Les scénarios `.repro.tsx` de l’audit initial décrivent les anciens défauts et restent des pièces historiques. Les tests qui vérifient les corrections sont dans `src`. La suite habituelle s’exécute avec `npm run check`. Les scripts Chromium utilisent une installation de Playwright temporaire distincte des dépendances du projet ; adapter ce chemin pour les rejouer sur une autre machine.

**Vérifications restant à faire sur le terrain**

Les essais automatisés ne prouvent pas l’absence de toute régression. Les gestes tactiles réels, Safari/iPad, l’installation sur écran d’accueil, les lecteurs d’écran et l’impression sur les imprimantes utilisées en établissement demandent encore des essais sur les appareils concernés. Le temps réel nécessaire pour créer un TLA reste à mesurer avec les utilisateurs.

Les modèles et les propositions de pictogrammes sont à adapter à chaque usage. Les futures fonctions de synonymes, de favoris réutilisables entre tableaux et de mode utilisation plein écran peuvent être évaluées après ces essais ; elles ne sont pas annoncées comme réalisées dans cette version.
