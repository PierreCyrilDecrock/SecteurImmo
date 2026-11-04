# SecteurImmo

Application web **100 % HTML / CSS / JavaScript** (sans serveur, sans base de données, sans compte) pour suivre sa prospection immobilière sur le terrain : on coche sur une carte les maisons où l'on a prospecté (contact personnel, prospectus déposé…), on suit sa couverture par secteur et ses statistiques.

Tout reste dans **votre navigateur**, sur votre appareil. La feuille de route de départ est dans `PLAN.md`.

## Sommaire

1. [Démarrage rapide](#démarrage-rapide)
2. [Utiliser l'application](#utiliser-lapplication)
3. [Sur téléphone, sur le terrain](#sur-téléphone-sur-le-terrain)
4. [Sauvegarde, export, import](#sauvegarde-export-import)
5. [Publier sur GitHub Pages (facultatif)](#publier-sur-github-pages-facultatif)
6. [Limites à connaître](#limites-à-connaître)
7. [FAQ](#faq)
8. [Pour les développeurs](#pour-les-développeurs)

## Démarrage rapide

Un petit serveur local est nécessaire : OpenStreetMap bloque les pages ouvertes par double-clic sur `index.html` (adresse `file://`, sans en-tête *Referer*).

- **Windows** : double-clic sur `lancer.bat`
- **Mac / Linux** : `./lancer.sh`

Le script démarre `python -m http.server` sur `http://localhost:8000` et ouvre le navigateur. Il faut **Python 3** ([python.org](https://www.python.org/downloads/)). Pour arrêter : fermez la fenêtre (ou Ctrl+C). Sans Python : l'extension « Live Server » de VS Code, ou toute commande qui sert le dossier en statique, convient aussi.

Puis, dans l'application (le bouton **❓** en bas à gauche rappelle ces étapes) :
1. Cherchez votre ville ou votre rue et zoomez jusqu'aux maisons (zoom 16 minimum).
2. **Charger les bâtiments de cette zone** : les maisons apparaissent en gris.
3. Facultatif : **🗺 Secteurs** → dessinez un secteur, chargez ses bâtiments pour suivre le pourcentage couvert.
4. **⚡ Tournée** : choisissez un statut, touchez chaque maison faite.
5. **📊 Statistiques** pour suivre l'avancement, **💾** pour exporter régulièrement.

## Utiliser l'application

### Carte et recherche

Carte plein écran ; fonds : plan OpenStreetMap, plan IGN, vue aérienne IGN (menu en haut à droite). Recherche de ville ou d'adresse avec suggestions (géocodage Géoplateforme IGN, secours Nominatim).

### Charger les maisons

Le bouton **« Charger les bâtiments de cette zone »** (actif à partir du zoom 16) télécharge les bâtiments OpenStreetMap de la zone visible (API Overpass) et les affiche en gris (« non fait »). Survol : type de bâtiment et adresse si OpenStreetMap la connaît.

- Requêtes bornées : zoom ≥ 16 et zone ≤ 6 km² ; une seule requête à la fois.
- Une zone (ou un bâtiment) déjà chargé n'est jamais retéléchargé (conservé 30 jours dans la sauvegarde locale).
- Erreurs 429 / 502 / 503 / 504 ou réseau : jusqu'à 4 essais espacés (2 s, 4 s, 8 s), en alternant entre `overpass-api.de` et le miroir `overpass.kumi.systems`.
- Les relations multipolygones sont gérées dans les cas simples (contours extérieurs déjà fermés) ; les contours non fermés sont ignorés.

### Cocher les maisons (barre d'outils)

- 👆 **Consulter** : toucher un bâtiment ouvre sa fiche (adresse, statut en un clic, date/heure modifiable, nombre de logements, note). Si OpenStreetMap n'a pas l'adresse, elle est cherchée par géocodage inverse (une fois, à l'ouverture de la fiche).
- ⚡ **Tournée** : on choisit un statut, puis chaque clic sur une maison le lui applique.
- ⬚ **Sélection** : glisser un **rectangle** ou un **lasso** (souris ou doigt), puis appliquer un statut à toutes les maisons entourées. La carte ne se déplace pas pendant ce mode.
- ➕ **Ajouter** : un clic sur la carte crée un point pour une maison absente d'OpenStreetMap (supprimable depuis sa fiche, non annulable).
- ↶ **Annuler** (ou Ctrl/Cmd+Z) : annule les changements de statut, note, logements, date. `Échap` revient au mode Consulter.
- 🎨 **Légende** : compteurs par statut, et cases pour masquer/afficher chaque statut.

Statuts : Non fait (gris), Prospectus déposé (bleu, contour tireté), Contact personnel (vert), Absent / à repasser (orange), Refus / Stop pub (rouge), À rappeler (violet). Chaque statut a aussi un style de contour et une icône (visible à fort zoom) pour rester lisible sans distinguer les couleurs.

### Secteurs et suivi de couverture (🗺)

- **Dessiner un secteur** : cliquez sur la carte pour poser les sommets (3 minimum), « Retirer le dernier point » pour corriger, puis « Terminer » ; saisissez le nom (modifiable avec ✎). Pour changer la forme, supprimez-le et redessinez-le.
- **Avancement** : bâtiments, faits, à faire, pourcentage, barre de répartition par statut. Un bâtiment compte dans un secteur si son centre y est situé. « Fait » = tout statut sauf « Non fait ». Le pourcentage ne porte que sur les bâtiments **chargés** : **📥 Charger les bâtiments** télécharge tout le secteur (cases d'environ 1,2 km, une requête à la fois avec une pause d'une seconde ; 12 cases maximum, au-delà il faut découper le secteur).
- **🔍 Non faits** : met en évidence (contour rouge épais) les maisons restant à faire, en direct.
- **⏭ Suivant** : amène à la maison à faire la plus proche de **votre position** (si 📍 est actif) ou du centre de la vue.
- **Colorer selon l'avancement** : remplissage du clair (peu avancé) au foncé (terminé).
- Un bâtiment situé dans deux secteurs qui se chevauchent est compté dans les deux.

### Statistiques (📊)

Écran plein cadre ; deux filtres s'appliquent à **toutes** les rubriques : **période** (tout, 7, 30, 90 jours) et **secteur**.
- **Résumé** : maisons faites, taux de contact (contacts personnels ÷ maisons faites), prospectus, contacts, à rappeler, absents, refus, logements touchés, répartition par statut.
- **Évolution** : colonnes empilées par statut, par jour ou par semaine, infobulle au survol ou au clavier, tableau des valeurs. La date retenue pour une maison est celle de son **dernier changement de statut**.
- **Rues** : avancement par rue, rues non terminées en premier. La rue vient de l'adresse OpenStreetMap ou de celle trouvée à l'ouverture de la fiche ; les maisons de rue inconnue sont regroupées à part.
- **Liste** : maisons faites filtrables (statut, texte dans les notes/adresses), triables, **export CSV de la sélection** ; un clic sur l'adresse centre la carte et ouvre la fiche.
- **À rappeler** : de la plus ancienne à la plus récente.
- **Données de démonstration** (case en haut) : jeu fictif de ~170 maisons, jamais enregistré, qui ne modifie pas vos données.

## Sur téléphone, sur le terrain

- **Interface tactile** : boutons plus grands sur écran tactile, fiche en bas d'écran, zone d'appui élargie autour des maisons.
- **📍 Ma position** (en bas à droite) : point bleu suivi en direct avec son cercle de précision. La carte vous suit ; déplacez la carte pour arrêter le recentrage (le point reste affiché), recliquez pour recentrer, cliquez pendant le suivi pour arrêter. L'écran reste allumé pendant le suivi si le navigateur le permet. La position n'est ni enregistrée ni envoyée. La géolocalisation exige `localhost` ou une adresse `https://`.
- **Installer l'application** (PWA) : sur un site `https://` (GitHub Pages, voir plus bas) ou `localhost`, menu du navigateur → « Installer l'application » / « Ajouter à l'écran d'accueil ». Elle démarre ensuite **sans connexion**, avec vos données. Seul le fond de carte (tuiles) et le chargement de nouveaux bâtiments demandent du réseau ; les maisons déjà chargées restent affichées et cochables hors ligne.
- Les tuiles de carte ne sont **jamais** mises en cache (respect de la politique d'OpenStreetMap) : hors ligne, le fond est gris mais les maisons sont là.

## Sauvegarde, export, import

- **Sauvegarde automatique** dans le navigateur (IndexedDB) : statuts, notes, points ajoutés, adresses trouvées, secteurs, contours des bâtiments téléchargés, zones chargées, position de la carte et fond choisi. Tout est restauré au rechargement. Les données sont propres au navigateur **et** à l'adresse (`localhost:8000`, `https://…github.io`) : changer de navigateur, de port ou d'adresse repart de zéro ; utilisez l'export/import pour les déplacer.
- **💾 Mes données** :
  - *Exporter (JSON)* : sauvegarde complète (`secteurimmo-AAAA-MM-JJ.json`) ; seuls les contours des bâtiments cochés sont inclus. Format versionné (schéma 2 ; les sauvegardes de schéma 1 restent importables).
  - *Exporter (CSV)* : `id ; adresse ; statut ; date ; note ; logements ; latitude ; longitude`, séparateur `;`, UTF-8 avec BOM (s'ouvre directement dans Excel français). Les cellules de texte commençant par `= + - @` sont préfixées d'une apostrophe (protection contre l'injection de formules).
  - *Importer* : aperçu puis **Fusionner** (en cas de conflit sur un bâtiment, l'entrée la plus récente est gardée) ou **Remplacer** (avec, par défaut, téléchargement préalable d'une sauvegarde de vos données actuelles). Le fichier est validé et nettoyé.
  - *Lier un fichier de sauvegarde* (Chrome / Edge) : le fichier est réécrit automatiquement après chaque modification ; à redonner après un redémarrage du navigateur (« Reconnecter le fichier lié »).
  - *Effacer toutes mes données*.
- **Rappel** : un bandeau apparaît si aucun export n'a été fait depuis plus de 7 jours.
- Sans IndexedDB (navigation privée…), l'application fonctionne sans sauvegarde automatique : un message l'indique, exportez régulièrement.

## Publier sur GitHub Pages (facultatif)

Pratique pour installer l'application sur téléphone en `https://`. Le workflow `.github/workflows/pages.yml` publie uniquement le code (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `vendor/`, `icons/`).

1. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. Poussez sur la branche `main` (ou lancez le workflow à la main : onglet *Actions* → « Publier sur GitHub Pages » → *Run workflow*).
3. Le site est disponible sur `https://<votre-compte>.github.io/<nom-du-dépôt>/`.

⚠ **Vos données de prospection ne sont jamais publiées** : elles restent dans votre navigateur. Ne committez jamais d'export (`secteurimmo-*.json`, `*.csv`) : le `.gitignore` les exclut, et le workflow **échoue** si un tel fichier est dans le dépôt. Le code de l'application, lui, est public si le site l'est ; l'adresse du site Pages est publique (selon l'offre de votre compte GitHub, un dépôt privé peut ne pas pouvoir publier de site).

## Limites à connaître

- **Données OpenStreetMap** : certaines maisons manquent, beaucoup de bâtiments n'ont pas d'adresse (affichée « adresse inconnue » ; le géocodage inverse la complète à l'ouverture de la fiche), et un immeuble est un seul bâtiment pour plusieurs logements (champ « logements », bouton ➕ pour ajouter une maison manquante).
- **Overpass** : serveur public gratuit, avec limites par IP ; en cas d'indisponibilité, réessayez plus tard.
- **Clavier / lecteur d'écran** : les maisons (dessinées sur un canevas) ne sont pas atteignables une à une au clavier ; utilisez **Secteurs → ⏭ Suivant** ou **Statistiques → Liste**, dont les boutons ouvrent la fiche de la maison.
- **Performance** : testé avec 6 000 bâtiments affichés (déplacement fluide) ; les icônes de statut ne sont créées que pour la zone visible.
- **Non vérifié en conditions réelles** : le développement s'est fait dans un environnement dont le réseau bloquait OpenStreetMap, l'IGN et Overpass ; leur comportement (CORS, limites, champ `distance` du géocodage inverse, tuiles IGN) a été testé avec des réponses simulées. Idem pour le fichier lié (API *File System Access* simulée), l'installation PWA sur un vrai téléphone, la géolocalisation matérielle et le workflow GitHub Pages. Si quelque chose ne marche pas, regardez la console du navigateur.

## FAQ

**Mes données ont disparu.** Elles sont dans le navigateur : vider les données de navigation, changer de navigateur, d'adresse (`localhost:8000` ≠ `localhost:8080`) ou utiliser la navigation privée les fait disparaître. Exportez régulièrement (💾), ou liez un fichier de sauvegarde.

**La carte reste grise.** Vérifiez la connexion ; essayez un autre fond (menu en haut à droite). Ouvert par double-clic (`file://`), OpenStreetMap bloque les tuiles : utilisez `lancer.bat` / `lancer.sh`.

**« Zoomez davantage » / bouton grisé.** Le chargement des bâtiments exige le zoom 16 minimum.

**« Serveur de données occupé ».** Overpass limite les requêtes ; l'application réessaie seule jusqu'à 4 fois. Patientez ou réessayez plus tard.

**Une maison manque ou une rue est « inconnue ».** Données OpenStreetMap incomplètes : ajoutez la maison avec ➕ ; ouvrir la fiche d'une maison complète son adresse.

**Comment passer d'un ordinateur à un téléphone ?** Exportez en JSON (💾), transférez le fichier, puis *Importer* sur l'autre appareil.

**Comment installer l'application ?** Voir [Sur téléphone](#sur-téléphone-sur-le-terrain). Un bouton « Installer l'application » apparaît aussi dans l'aide (❓) quand le navigateur le propose.

**La localisation ne marche pas.** Autorisez-la pour le site dans les réglages du navigateur ; elle exige `localhost` ou `https://`.

## Pour les développeurs

Aucun build, aucun npm : des scripts classiques (pas de modules ES) et un objet global par fichier.

```
index.html  manifest.json  sw.js  lancer.bat  lancer.sh
css/style.css
js/  pwa  geocode  data  statuts  ui  map  panneau  position  secteurs  secteurs-ui
     stats  stats-ui  outils  store  echange  aide  app
vendor/leaflet/   (Leaflet 1.9.4, BSD-2)
icons/            (icônes PWA)
.github/workflows/pages.yml
```

- `data.js` : Overpass (cache, reprises, miroirs) · `statuts.js` : modèle + annulation · `map.js` : carte, rendu Canvas, icônes limitées à la vue · `store.js` : IndexedDB, schéma versionné (`migrer()`) · `echange.js` : export/import/CSV/fichier lié · `sw.js` : cache « réseau d'abord » des seuls fichiers de l'application.
- **Si vous ajoutez ou supprimez un fichier de l'application**, mettez à jour la liste `FICHIERS` de `sw.js` (et changez `VERSION` si un fichier est supprimé), ainsi que l'étape de copie du workflow Pages si c'est un nouveau dossier.
- Tests : réalisés avec Playwright (réponses des services simulées par interception réseau), y compris hors ligne, géolocalisation simulée, axe-core (accessibilité) et 6 000 bâtiments.

## Bibliothèques

- [Leaflet](https://leafletjs.com/) 1.9.4 (BSD-2), copiée dans `vendor/leaflet/`. Aucune autre dépendance au runtime.
- Cartes © contributeurs OpenStreetMap, © IGN.

## Données et vie privée

Aucune donnée n'est envoyée à un serveur du projet : tout reste dans votre navigateur. Seuls les services de carte et de données reçoivent des requêtes techniques (tuiles, recherche d'adresse, bâtiments d'une zone). La position GPS n'est jamais envoyée. Les notes peuvent contenir des données personnelles : protégez vos exports.
