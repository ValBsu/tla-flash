# TLA studio

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
