# TLA Flash

Application locale-first de création de tableaux de langage augmenté, pensée pour un usage éducatif.

Node.js 22.12 ou plus récent est nécessaire. `npm ci` installe les versions vérifiées du fichier de verrouillage.

L’éditeur conserve la vue continue des TLA et ne monte les pages éloignées que lorsqu’elles approchent de l’écran. La bibliothèque permet de rechercher un titre ou un mot, de filtrer les tableaux, de consulter leurs miniatures et de restaurer la corbeille. Le dernier TLA ouvert est repris au démarrage.

Le panneau **Modifier** propose la duplication, des modèles par activité, l’insertion dans les cases vides et le choix des variantes avant insertion en lot. Une réduction de grille conserve les cases retirées avec leurs images et styles dans une réserve ; agrandir la grille ou utiliser **Réinsérer** permet de les retrouver. Le déplacement est aussi disponible par une liste de positions, au clavier ou au toucher.

## Tester sur le réseau local

Sur l’ordinateur qui lance l’application :

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Vite affiche une adresse réseau, par exemple `http://192.168.1.20:5173/`. Ouvrez cette adresse depuis une tablette ou un autre ordinateur connecté au même Wi-Fi. Les données restent dans le navigateur de chaque appareil : ce mode ne synchronise pas les appareils.

## Publier sur GitHub Pages

Le workflow `.github/workflows/deploy.yml` teste et construit les pull requests, puis publie automatiquement `dist` sur GitHub Pages à chaque push sur `main`. Il contrôle aussi les dépendances de production. Dans GitHub, sélectionner **Settings > Pages > GitHub Actions** comme source.

URL attendue : `https://valbsu.github.io/tla-flash/`.

## Publier manuellement sur Netlify sans GitHub

1. Construire le site avec `npm ci && npm run build`. Le site prêt à publier est dans `dist` ; les règles Netlify `_headers` et `_redirects` y sont copiées automatiquement.
2. Créer un site dans Netlify sans connecter de dépôt Git, puis déposer le dossier `dist` dans la zone de déploiement manuel de Netlify.
3. Utiliser l’adresse HTTPS fournie par Netlify dans Chrome ou Edge et choisir **Installer TLA Flash** dans le menu du navigateur.
4. Pour publier une mise à jour, reconstruire le projet et déposer le nouveau `dist` dans l’onglet **Deploys** du même site.

Le fichier `netlify.toml` configure aussi la construction automatique si l’équipe décide plus tard de connecter un dépôt. Le déploiement manuel décrit ci-dessus n’utilise pas GitHub. Un site Netlify est public par défaut : vérifier avec l’informatique que cet hébergement est autorisé avant de l’utiliser en contexte professionnel. Les TLA restent dans le stockage du navigateur ; le PDF et le ZIP sont produits côté navigateur et doivent être transférés manuellement vers le stockage approuvé par l’établissement. La recherche ARASAAC et la traduction MyMemory restent des services externes.

## Installer et utiliser comme PWA

La version de production est installable depuis le navigateur et met en cache l’interface pour la rouvrir hors connexion. La recherche ARASAAC et la traduction anglaise nécessitent toujours Internet. Pour l’IME, l’informatique peut publier le contenu de `dist` sur un serveur privé en HTTPS ; l’adresse interne doit rester la même sur les appareils pour retrouver leur stockage local. Le ZIP reste le moyen de transfert ou de sauvegarde entre appareils.

Après le déploiement, ouvrez l’adresse dans Chrome ou Edge et choisissez **Installer TLA Flash** depuis le menu du navigateur. Sur iPhone/iPad, utilisez **Partager > Sur l’écran d’accueil** dans Safari.

Dans **Modifier**, **Préparer hors connexion** télécharge les images du TLA et de sa réserve, y compris celles d’ARASAAC, et indique le nombre de médias disponibles. Cela prépare le tableau choisi, sans télécharger toute la banque. Les images restent soumises au stockage conservé par le navigateur. **Protéger le stockage local** permet de demander la persistance ; le navigateur peut la refuser. Conservez aussi une sauvegarde ZIP indépendante.

## Sauvegarder les TLA

Les modifications sont mises immédiatement en file de sauvegarde dans IndexedDB ; les écritures d’un même TLA sont ordonnées et les éditions intermédiaires sont regroupées quand une écriture est déjà en cours. Attendez **Enregistré sur cet appareil** avant de quitter. Une coupure pendant une écriture peut empêcher la dernière modification d’être conservée. Une fermeture ne réécrit pas les anciennes données d’un onglet inactif.

Les révisions empêchent un autre onglet d’écraser silencieusement un tableau modifié ailleurs. En cas de conflit ou d’erreur de stockage, le travail reste à l’écran : **Conserver ma version en copie** ou **Sauvegarder en ZIP** permet de le préserver. La suppression déplace le tableau dans une corbeille récupérable depuis la bibliothèque.

**Sauvegarder** télécharge une archive ZIP de la bibliothèque complète, nommée avec le titre du TLA ouvert ; les dossiers, le classement et les médias des cases visibles et de la réserve sont inclus. Si une image nécessaire est inaccessible, l’application signale l’échec et ne télécharge pas d’archive incomplète. **Restaurer** fusionne l’archive avec la bibliothèque locale ; les TLA ou dossiers portant le même identifiant sont remplacés après confirmation, les autres sont conservés. Les sauvegardes de format 1 restent prises en charge et les anciens chemins de banques locales sont adaptés à l’hébergement actuel. Pour changer de navigateur ou d’appareil, transférez la sauvegarde ZIP.

Les imports vérifient la cohérence des grilles, les identifiants, les dates, les références et les images. Les limites sont de 128 Mio pour le ZIP, 256 Mio pour son JSON décompressé et 1 000 TLA par archive. Les photos nouvellement importées sont limitées à 20 Mio et préparées à une résolution maximale de 1 600 pixels sur leur plus grand côté ; la transparence est conservée.

La traduction en anglais utilise le service public MyMemory et nécessite une connexion Internet. Le titre et les libellés du TLA lui sont transmis pour traduction ; relis et corrige les propositions avant de créer la copie anglaise. Le TLA original reste inchangé.

**Aperçu** affiche le PDF réellement généré. Les légendes longues sont ajustées à leur zone, les cases vides sont conservées et une image manquante empêche l’export avec un message indiquant les cases concernées. Vérifiez la lisibilité dans l’aperçu, en particulier pour les grilles denses. La bibliothèque peut exporter les TLA affichés ou un dossier en un PDF multipage.

## Commandes

```bash
npm run dev
npm run test
npm run lint
npm run build
npm run check
npm run audit:production
```

## Bibliothèques

- Vite, React et TypeScript : application front-end rapide et typée.
- `idb` : accès IndexedDB pour la sauvegarde locale.
- `lucide-react` : icônes accessibles et cohérentes.
- `jspdf` et `file-saver` : export PDF côté navigateur avec images intégrées, chargé à la demande.
- ARASAAC : recherche distante réelle de pictogrammes, sans données fictives.

## Limites

Le partage dépend du navigateur. ARASAAC nécessite une connexion au moment d’une nouvelle recherche. GitHub Pages héberge le front-end, mais n’ajoute ni compte, ni serveur, ni bibliothèque commune entre appareils. Les tests automatisés couvrent aussi les transactions, la migration de stockage et les cas de perte de travail corrigés. Les fichiers `.repro.tsx` de l’audit du 25 octobre décrivent volontairement les défauts de l’ancienne version ; les tests de non régression actuels se trouvent dans `src`.

### Banque Sclera

Le panneau Pictogrammes propose ARASAAC et Sclera. Le choix est enregistré par TLA ; les anciennes sauvegardes utilisent ARASAAC par défaut. Changer de banque recherche une nouvelle image pour chaque case contenant un mot, conserve sa mise en forme et préserve les photos importées. Une absence de résultat laisse seulement le mot. En cas d’erreur réseau, le changement complet est annulé.

La banque française provient de https://www.sclera.be/resources/download/picto_fr.zip. Les PNG originaux sont conservés sous `public/pictograms/sclera/`, avec des identifiants locaux et un index des noms français. Attribution : www.sclera.be, licence CC BY-NC 2.0 Belgique (voir `LICENSE.txt` dans ce dossier). Les images représentent environ 75 Mo sur l’hébergement, mais ne sont pas téléchargées en bloc au démarrage. Aucune clé API n’est nécessaire.

La version de production met l’index en cache avec l’application et conserve les images Sclera consultées dans un cache dédié. Le hors connexion reste limité aux images déjà chargées et dépend du stockage conservé par le navigateur ; le téléchargement hors connexion de la banque complète n’est pas encore proposé.

### Banque Makaton

Le panneau Pictogrammes propose aussi la banque Makaton Niveau 1 fournie par l’utilisateur. Les 69 fichiers PNG sont intégrés sous `public/pictograms/makaton/` et recherchables par mot, avec prise en compte des accents et variantes du même pictogramme. L’utilisateur a confirmé l’autorisation d’intégrer et publier ces fichiers. Les images sont incluses dans le déploiement et téléchargées à la demande, pas en bloc au démarrage. Attribution dans le PDF : Makaton — Niveau 1 (fichiers fournis par l’utilisateur).
