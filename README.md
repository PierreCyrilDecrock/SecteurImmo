# SecteurImmo

**Le carnet de prospection terrain du mandataire immobilier.** Sur une carte, cochez chaque maison visitée (prospectus déposé, contact, absent, refus, à rappeler), suivez la couverture de vos secteurs, vos rappels et vos résultats de la semaine.

Application web **100 % HTML / CSS / JavaScript** : pas de serveur, pas de base de données, pas de compte. Tout reste dans **votre navigateur**, sur votre appareil. Elle s'utilise sur ordinateur et sur téléphone, et s'installe comme une application (y compris hors ligne).

## Sommaire

1. [Démarrage rapide](#démarrage-rapide)
2. [L'interface](#linterface)
3. [Prospecter sur la carte](#prospecter-sur-la-carte)
4. [Secteurs, rappels, bilan](#secteurs-rappels-bilan)
5. [Sur le terrain (téléphone)](#sur-le-terrain-téléphone)
6. [Sauvegarde, export, import](#sauvegarde-export-import)
7. [Publier sur GitHub Pages](#publier-sur-github-pages-facultatif)
8. [Limites à connaître](#limites-à-connaître)
9. [FAQ](#faq)
10. [Pour les développeurs](#pour-les-développeurs)

## Démarrage rapide

Un petit serveur local est nécessaire : OpenStreetMap bloque les pages ouvertes par double-clic sur `index.html` (adresse `file://`, sans en-tête *Referer*).

- **Windows** : double-clic sur `lancer.bat`
- **Mac / Linux** : `./lancer.sh`

Le script démarre `python -m http.server` sur `http://localhost:8000` et ouvre le navigateur (il faut **Python 3**, [python.org](https://www.python.org/downloads/)). Sans Python : l'extension « Live Server » de VS Code, ou toute commande qui sert le dossier en statique, convient aussi.

Au premier lancement, une courte présentation explique l'essentiel. Ensuite :
1. **Recherchez** votre ville ou votre rue (barre en haut, ou `Ctrl K`).
2. Zoomez sur les rues puis touchez **« Charger les maisons de cette zone »** (en bas de la carte).
3. **Secteurs** : dessinez votre zone pour suivre le pourcentage couvert.
4. Sur le terrain, passez en **Tournée rapide** et touchez chaque maison faite.
5. Suivez vos résultats dans **Bilan** et vos personnes à recontacter dans **Rappels**.

## L'interface

- **Navigation** : rail à gauche sur ordinateur (Carte, Secteurs, Bilan, Rappels, Données, Aide, Thème), barre d'onglets en bas sur téléphone (Données, Aide et Thème dans « Plus »). Le badge rouge de **Rappels** indique le nombre de personnes à rappeler ; une pastille orange sur **Données** signale qu'aucune sauvegarde n'a été faite depuis 7 jours.
- **Recherche et commandes** (`Ctrl K` ou `/`, ou la barre de recherche) : adresses et villes, maisons déjà renseignées (par nom, adresse ou note), secteurs, et toutes les actions (nouveau secteur, tournée, exporter, changer de thème…).
- **Thème** : automatique (suit le système), clair ou sombre ; la carte s'assombrit avec le thème.
- **Fonds de carte** (bouton calques, en haut à droite) : *Épuré* (plan désaturé, par défaut : les statuts ressortent), *Plan* (OpenStreetMap), *Plan IGN*, *Satellite* (IGN).
- **Notifications** : chaque action importante est confirmée, avec **« Annuler »** quand c'est utile.
- **Animations** discrètes (ouverture des panneaux, onde de validation sur une maison, compteurs, graphiques) ; elles sont désactivées si le système demande de réduire les animations.

## Prospecter sur la carte

### Charger les maisons

La pastille en bas de la carte guide : *« Zoomez pour afficher les maisons »* (un clic zoome), puis *« Charger les maisons de cette zone »*, puis *« 12 maisons ajoutées »*. Les bâtiments viennent d'OpenStreetMap (API Overpass) :
- requêtes bornées (zoom ≥ 16, zone ≤ 6 km², une seule à la fois) ; une zone déjà chargée n'est jamais retéléchargée (mémorisée 30 jours) ;
- en cas d'erreur 429 / 502 / 503 / 504 ou réseau : jusqu'à 4 essais espacés, en alternant avec le serveur miroir `overpass.kumi.systems` ; une fine barre de progression en haut de la carte indique les téléchargements.

### Le dock d'outils (en bas)

| Outil | Raccourci | Effet |
|---|---|---|
| **Consulter** | `V` | Toucher une maison ouvre sa fiche. |
| **Tournée rapide** | `T` | Un statut « de porte » est actif (choisi dans le bandeau ou avec les touches `1`…`9`) ; chaque maison touchée le reçoit, avec une onde colorée, une vibration sur téléphone et « Annuler ». |
| **Sélection multiple** | `S` | Entourez des maisons (rectangle ou lasso), puis appliquez un statut ou une étiquette à toutes. |
| **Ajouter** | `A` | Placez une maison absente d'OpenStreetMap. |
| **Annuler** | `Ctrl Z` | Annule la dernière modification. |

`Échap` revient au mode Consulter ou ferme le panneau ouvert. `?` ouvre l'aide.

### La fiche d'une maison

- **Statut** en un geste (touches `1` à `9`) ;
- **étiquettes** rapides à cocher (voir plus bas) ;
- date et heure du dernier passage, **nom et téléphone** (bouton d'appel direct), nombre de logements ;
- **qualification du contact** : potentiel (*chaud*, *tiède*, *froid*), projet (vente, achat, mise en location, succession, simple estimation, aucun), échéance (moins de 3 mois → plus d'un an), occupant (propriétaire / locataire) ; un second clic efface la valeur ;
- note, **historique des passages**, et **« Maison suivante à faire »** quand la maison appartient à un secteur.

Si OpenStreetMap ne connaît pas l'adresse, elle est cherchée une fois à l'ouverture de la fiche (géocodage IGN).

**Statuts de porte** : *Prospectus déposé* (bleu, contour tireté), *Contact personnel* (vert), *Absent / à repasser* (orange), *Refus / Stop pub* (rouge), *À rappeler* (violet), *Non fait* (gris).
**Statuts commerciaux** : *Estimation faite* (jaune), *Mandat signé* (vert foncé), *Mandat concurrent / vendu* (rose). Chaque statut a une couleur, un style de contour et une icône (à fort zoom) : il reste lisible sans distinguer les couleurs. Les 8 couleurs forment une palette validée pour les daltoniens (clair et sombre).

### Étiquettes

Repères rapides que vous créez vous-même (6 proposées au départ : *Stop pub*, *Chien*, *Maison à vendre*, *Travaux*, *Volets fermés*, *Boîte pleine*). Dans la fiche, touchez une étiquette pour la poser ou l'enlever, ou **« Nouvelle »** pour en créer une (posée aussitôt). **Gérer les étiquettes** (roue dentée de la fiche, ou `Ctrl K` → « Gérer les étiquettes ») : renommer, changer la couleur, supprimer (retirée de toutes les maisons, après confirmation). En sélection multiple, *« Ajouter une étiquette… »* l'applique à toutes les maisons entourées (une seule annulation suffit).

### La légende (en bas à gauche)

Compteurs par statut, avancement des maisons chargées. Touchez un statut pour le masquer ou l'afficher, et utilisez le **filtre** pour n'afficher que les maisons d'un **potentiel**, d'un **projet** ou d'une **étiquette** (ex. « Potentiel chaud » pour préparer vos relances).

## Secteurs, rappels, bilan

### Secteurs

**Nouveau secteur** → touchez la carte pour poser les coins (3 minimum), « Terminer », nommez-le. Chaque secteur affiche un anneau d'avancement, le nombre de maisons faites / à faire et la répartition par statut, avec :
- **Charger les maisons** (ou *Compléter*) : télécharge tout le secteur par cases d'environ 1,2 km, une requête à la fois (12 cases maximum, sinon découpez le secteur) ;
- **À faire** : met en évidence (contour rose) les maisons restant à faire, en direct ;
- **Suivante** : amène à la maison à faire la plus proche de votre position (si « Ma position » est actif) ou du centre de la carte, et ouvre sa fiche ;
- renommer, supprimer (avec confirmation ; les statuts des maisons ne sont pas touchés) ;
- option *Colorer les secteurs selon leur avancement*.

### Rappels

Les maisons « À rappeler », triées de la plus ancienne demande à la plus récente (en orange au-delà de 7 jours) ou par **potentiel**, avec le nom, la qualification (potentiel, projet, échéance), la note, **Appeler** (si un numéro est renseigné), **Fiche**, et **Contacté** (la passe en « Contact personnel », avec « Annuler »).

### Bilan

Tableau de bord filtrable par **période** (7, 30, 90 jours, tout) et par **secteur** :
- **indicateurs** : maisons faites, **taux de contact** (personnes rencontrées ÷ maisons faites ; un contact, un rappel, une estimation ou un mandat comptent comme « rencontrée »), **estimations**, **mandats signés** — comparés à la période précédente ;
- **objectif de la semaine** (modifiable, 80 maisons par défaut), maisons faites aujourd'hui, **série** de jours d'activité ;
- **activité** : colonnes empilées par statut, par jour ou par semaine, infobulle et tableau des valeurs ;
- **entonnoir commercial** : portes → contacts → estimations → mandats, avec le taux de passage entre chaque étape et les mandats perdus face à la concurrence (l'historique compte : une maison passée par « estimation » puis « mandat » compte dans les deux) ;
- **meilleurs créneaux** : taux de contact par jour de la semaine et moment de la journée (matin, midi, après-midi, soir), calculé sur chaque passage de l'historique, avec votre meilleur créneau mis en avant (à partir de 5 portes) ;
- **prospects à travailler** : potentiels chauds puis tièdes, les échéances les plus proches d'abord, avec appel direct ;
- **rappels** (en attente, en retard, les plus anciens), **répartition** par statut, **projets et échéances**, **étiquettes** posées, avancement des **secteurs**, **rues à terminer** ;
- **journal des passages** : recherche (nom, adresse, note, téléphone, projet, étiquette), filtres par statut et par qualification ou étiquette, tri, export CSV de la sélection ; un clic ouvre la maison sur la carte ;
- **Données d'exemple** : jeu fictif d'environ 300 maisons pour découvrir le bilan, jamais enregistré, sans effet sur vos données.

La date retenue pour une maison dans l'activité est celle de son **dernier changement de statut** (l'historique complet est dans la fiche, et sert à l'entonnoir et aux créneaux).

## Sur le terrain (téléphone)

- Barre d'onglets en bas ; la fiche et les panneaux s'ouvrent en **feuilles** que l'on referme en les tirant vers le bas (ou en touchant le fond).
- Grandes cibles tactiles et **zone d'appui élargie** autour des maisons.
- **Ma position** (bouton viseur à droite) : point bleu suivi en direct ; déplacez la carte pour arrêter le recentrage, retouchez pour recentrer, touchez pendant le suivi pour arrêter. L'écran reste allumé pendant le suivi si le navigateur le permet. La position n'est ni enregistrée ni envoyée (elle exige `localhost` ou `https://`).
- **Installer l'application** : menu du navigateur → « Installer » / « Ajouter à l'écran d'accueil » (un bouton apparaît aussi dans l'Aide quand le navigateur le propose). Elle démarre ensuite **sans connexion**, avec vos données ; seuls le fond de carte et le chargement de nouvelles maisons demandent du réseau. Les tuiles de carte ne sont jamais mises en cache (règle d'OpenStreetMap).

## Sauvegarde, export, import

Panneau **Données** :
- **Sauvegarde automatique** dans le navigateur (IndexedDB) : statuts, contacts, qualifications, étiquettes, notes, historiques, maisons ajoutées, adresses trouvées, secteurs, objectif, maisons chargées, position de la carte, fond choisi. Tout est restauré à l'ouverture. Les données sont propres au navigateur **et** à l'adresse (`localhost:8000`, `https://…github.io`) : pour changer d'appareil, exportez puis importez.
- **Stockage protégé** : dès la première maison renseignée, l'application demande au navigateur de ne jamais effacer ses données, même si l'espace disque manque (`navigator.storage.persist()`). Chrome et Edge l'accordent en général sans rien demander (surtout si l'application est installée ou utilisée souvent) ; Firefox peut afficher une demande d'autorisation. L'état (protégé ou non, espace utilisé) est affiché dans **Données**, avec un bouton **Protéger** si besoin.
- **Sauvegarde complète (JSON)** : à réimporter ailleurs (format versionné, schéma 4 ; les sauvegardes des versions précédentes restent importables).
- **Tableur (CSV)** : `id ; adresse ; nom ; telephone ; statut ; date ; potentiel ; projet ; echeance ; occupant ; etiquettes ; note ; logements ; latitude ; longitude`, séparateur `;`, UTF-8 avec BOM (s'ouvre directement dans Excel). Les cellules de texte commençant par `= + - @` sont préfixées d'une apostrophe (protection contre l'injection de formules).
- **Importer** (glisser-déposer ou clic) : aperçu, puis **Fusionner** (en cas de doublon, la version la plus récente est gardée) ou **Remplacer** (avec, par défaut, une copie de sécurité de vos données actuelles). Le fichier est validé et nettoyé.
- **Fichier lié** (Chrome / Edge) : réécrit automatiquement après chaque modification ; à reconnecter après un redémarrage du navigateur.
- **Effacer toutes mes données** (avec confirmation).
- Rappel si aucun export depuis plus de 7 jours (notification avec « Exporter », pastille sur Données).

## Publier sur GitHub Pages (facultatif)

Pratique pour installer l'application sur téléphone en `https://`. Le workflow `.github/workflows/pages.yml` publie uniquement l'application (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `vendor/`, `icons/`).

1. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. Poussez sur la branche `main` (ou lancez le workflow à la main : onglet *Actions* → « Publier sur GitHub Pages » → *Run workflow*).
3. Le site est disponible sur `https://<votre-compte>.github.io/<nom-du-dépôt>/`.

⚠ **Vos données de prospection ne sont jamais publiées** : elles restent dans votre navigateur. Ne committez jamais d'export (`secteurimmo-*.json`, `*.csv`) : le `.gitignore` les exclut et le workflow **échoue** si un tel fichier est dans le dépôt.

## Limites à connaître

- **Données OpenStreetMap** : certaines maisons manquent, beaucoup n'ont pas d'adresse, un immeuble est un seul bâtiment (utilisez « Ajouter » et le champ « Logements »).
- **Overpass** est un service public gratuit, limité par adresse IP : en cas d'indisponibilité, réessayez plus tard.
- **Clavier / lecteur d'écran** : les maisons sont dessinées sur un canevas et ne sont pas atteignables une à une au clavier ; utilisez la recherche (`Ctrl K`, par nom ou adresse), **Secteurs → Suivante** ou **Bilan → Journal**, qui ouvrent la fiche.
- **Performance** : testé avec 6 000 maisons affichées. Les icônes de statut ne sont dessinées qu'à fort zoom, pour la zone visible, et sont omises quand plus de 350 maisons cochées sont à l'écran (les couleurs et contours restent). Les scripts sont chargés en parallèle (`defer`), les bibliothèques servies depuis le cache, et le flou des panneaux est suspendu pendant les déplacements de la carte.
- **Meilleurs créneaux** : calculés sur vos propres passages ; avec peu de données, les pourcentages varient beaucoup (les cases de moins de 3 portes sont grisées, le « meilleur créneau » demande au moins 5 portes).
- **Non vérifié en conditions réelles** : le développement s'est fait dans un environnement dont le réseau bloquait OpenStreetMap, l'IGN et Overpass ; leur comportement (CORS, limites, champ `distance` du géocodage inverse, tuiles IGN) a été testé avec des réponses simulées, comme le fichier lié (API *File System Access*), l'installation sur un vrai téléphone, le GPS matériel et le workflow GitHub Pages.

## FAQ

**Mes données ont disparu.** Elles sont dans le navigateur : vider les données de navigation, changer de navigateur, d'adresse (`localhost:8000` ≠ `localhost:8080`) ou utiliser la navigation privée les fait disparaître. Exportez régulièrement, ou liez un fichier de sauvegarde.

**La carte reste grise.** Vérifiez la connexion ; essayez un autre fond. Ouverte par double-clic (`file://`), OpenStreetMap bloque les tuiles : utilisez `lancer.bat` / `lancer.sh`.

**« Serveur de données occupé ».** Overpass limite les requêtes ; l'application réessaie seule jusqu'à 4 fois.

**Comment passer de l'ordinateur au téléphone ?** Données → Sauvegarde complète, transférez le fichier, puis Données → Importer sur l'autre appareil.

**La localisation ne marche pas.** Autorisez-la pour le site dans les réglages du navigateur ; elle exige `localhost` ou `https://`.

## Pour les développeurs

Aucun build, aucun npm pour l'application : des scripts classiques (pas de modules ES), un objet global par fichier, des bibliothèques copiées dans `vendor/`.

```
index.html  manifest.json  sw.js  lancer.bat  lancer.sh
css/   tokens (thèmes, police) · composants · coquille (navigation, panneaux) · carte · panneaux · tableau
js/    pwa · theme · ui · notifications · geocode · data · statuts · etiquettes · map · coquille · carte-ui · etiquettes-ui · panneau
       position · secteurs · secteurs-ui · rappels-ui · stats · stats-ui · outils · palette · store · echange · aide · app
vendor/ leaflet 1.9.4 (BSD-2) · lucide (icônes, ISC, sous-ensemble en sprite SVG) · inter (police variable, SIL OFL)
icons/  icônes de l'application installée
tests/  tests de bout en bout (Playwright) – non publiés
```

- **Modèle** : `statuts.js` (statuts, qualification, fiches, historique, annulation) · `etiquettes.js` · `data.js` (Overpass : cache, reprises, miroir) · `secteurs.js` · `stats.js` (calculs) · `store.js` (IndexedDB, schéma versionné, `migrer()`) · `echange.js` (export, import, CSV, fichier lié).
- **Interface** : `coquille.js` (navigation, tiroir, fiche, feuilles glissantes) · `carte-ui.js` (fonds, zoom, chargement, légende) · `outils.js` (dock, modes, raccourcis) · `panneau.js` (fiche) · `palette.js` (Ctrl K) · `stats-ui.js` (bilan) · `notifications.js` · `theme.js`.
- **Design** : jetons (couleurs, rayons, ombres, mouvements) dans `css/tokens.css`, thème posé sur `<html data-theme>`. Les couleurs des statuts forment une palette catégorielle validée pour les daltoniens (clair et sombre).
- **Si vous ajoutez ou supprimez un fichier de l'application**, mettez à jour la liste `FICHIERS` de `sw.js` (et changez `VERSION`), ainsi que l'étape de copie du workflow Pages si c'est un nouveau dossier.
- **Tests** : `node tests/e2e.js` (Playwright doit être installé ; `axe-core` facultatif pour les contrôles d'accessibilité automatiques ; `node tests/e2e.js secteurs` ne lance qu'une rubrique). Les services externes sont simulés par interception réseau : les tests ne dépendent pas d'Internet.

## Données et vie privée

Aucune donnée n'est envoyée à un serveur du projet : tout reste dans votre navigateur. Seuls les services de carte et de données reçoivent des requêtes techniques (tuiles, recherche d'adresse, maisons d'une zone). La position GPS n'est jamais envoyée. Les fiches peuvent contenir des données personnelles (noms, téléphones, notes) : protégez vos exports et respectez le RGPD (informez les personnes, ne conservez que le nécessaire).

Cartes © contributeurs OpenStreetMap, © IGN · Icônes [Lucide](https://lucide.dev) (ISC) · Police [Inter](https://rsms.me/inter/) (SIL OFL) · [Leaflet](https://leafletjs.com) (BSD-2).
