# TLA Flash

Application locale-first de création de tableaux de langage augmenté, pensée pour un usage éducatif.

## Tester sur le réseau local

Sur l’ordinateur qui lance l’application :

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Vite affiche une adresse réseau, par exemple `http://192.168.1.20:5173/`. Ouvrez cette adresse depuis une tablette ou un autre ordinateur connecté au même Wi-Fi. Les données restent dans le navigateur de chaque appareil : ce mode ne synchronise pas les appareils.

## Publier sur GitHub Pages

Le workflow `.github/workflows/deploy.yml` teste, construit et publie automatiquement `dist` sur GitHub Pages à chaque push sur `main`. Dans GitHub, sélectionner **Settings > Pages > GitHub Actions** comme source.

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

## Sauvegarder les TLA

Les TLA modifiés sont enregistrés immédiatement comme brouillons dans le navigateur ; une fermeture de page déclenche aussi une dernière tentative de sauvegarde. Ils restent disponibles après fermeture de l’app et redémarrage de l’ordinateur, dans le même navigateur. Une coupure de courant pendant l’écriture IndexedDB peut toutefois empêcher la toute dernière modification d’être conservée. **Sauvegarder** télécharge une archive ZIP de la bibliothèque complète, nommée avec le titre du TLA ouvert ; les dossiers et leur classement sont inclus. **Restaurer** fusionne l’archive avec la bibliothèque locale ; les TLA ou dossiers portant le même identifiant sont remplacés après confirmation, les autres sont conservés. Pour changer de navigateur ou d’appareil, transférez la sauvegarde ZIP.

La traduction en anglais utilise le service public MyMemory et nécessite une connexion Internet. Le titre et les libellés du TLA lui sont transmis pour traduction ; relis et corrige les propositions avant de créer la copie anglaise. Le TLA original reste inchangé.

## Commandes

```bash
npm run dev
npm run test
npm run lint
npm run build
```

## Bibliothèques

- Vite, React et TypeScript : application front-end rapide et typée.
- `idb` : accès IndexedDB pour la sauvegarde locale.
- `lucide-react` : icônes accessibles et cohérentes.
- `jspdf`, `html-to-image` et `file-saver` : export PDF côté navigateur avec images intégrées.
- ARASAAC : recherche distante réelle de pictogrammes, sans données fictives.

## Limites

Le partage et la dictée dépendent du navigateur. ARASAAC nécessite une connexion au moment de la recherche. GitHub Pages héberge le front-end, mais n’ajoute ni compte, ni serveur, ni bibliothèque commune entre appareils.
