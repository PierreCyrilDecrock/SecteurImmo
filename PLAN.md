# SecteurImmo – Faisabilité et plan de développement

Application web 100 % HTML / CSS / JS pour suivre la prospection terrain d'un mandataire immobilier : une carte où l'on coche les maisons déjà « faites » (contact personnel, prospectus déposé, etc.) et des statistiques de couverture du secteur.

---

## 1. Verdict de faisabilité : **faisable, sans backend ni base de données**

| Besoin | Solution retenue | Verdict |
|---|---|---|
| Carte interactive | **Leaflet** (bibliothèque JS libre, ~40 Ko), copiée dans le dépôt (`vendor/`) | ✅ |
| Fond de carte | OpenStreetMap (gratuit) + option vue aérienne IGN | ✅ (voir point d'attention n°1) |
| Les maisons à cocher | Emprises de bâtiments **OpenStreetMap** récupérées via l'API **Overpass** (JSON, appel direct depuis le navigateur) | ✅ (couverture bonne en France, issue du cadastre) |
| Recherche d'une ville / adresse | Géocodage **Géoplateforme IGN** (ex-API Adresse / BAN), sans clé | ✅ (voir point d'attention n°2) |
| Sauvegarde sans base de données | **IndexedDB** (ou `localStorage`) + **export/import JSON** | ✅ |
| Statistiques | Calculs en JS + graphiques en SVG/Canvas simples | ✅ |
| Lancement facile | Dossier statique : double-clic sur un script de lancement, ou page GitHub Pages | ✅ |

### Points d'attention (à connaître avant de commencer)

1. **Tuiles OpenStreetMap et `file://`** – La politique d'OSM exige un en-tête *Referer* ; une page ouverte en double-clic (`file://`) n'en envoie pas et peut voir ses tuiles bloquées ([politique d'utilisation des tuiles](https://operations.osmfoundation.org/policies/tiles/), [page Referer](https://wiki.openstreetmap.org/wiki/Referer)). Solution : lancer l'app via un mini-serveur local (`http://localhost:8000`, qui envoie un Referer) avec un script `lancer.bat` / `lancer.sh` d'un clic, et/ou publier sur GitHub Pages. Prévoir aussi un fond alternatif (IGN Plan/Orthophoto via la Géoplateforme, à vérifier en phase 1) et ne **jamais** télécharger les tuiles en masse.
2. **API d'adresses** – L'ancienne API Adresse (`api-adresse.data.gouv.fr`) a été transférée à l'IGN et intégrée à la Géoplateforme ; l'ancien domaine devait être décommissionné début 2026 ([annonce data.gouv.fr](https://www.data.gouv.fr/fr/posts/lapi-adresse-de-la-base-adresse-nationale-est-transferee-a-lign-10/)). Claude Code doit donc **tester l'endpoint réel** de géocodage de la Géoplateforme au moment du développement plutôt que de supposer l'URL. Prévoir Nominatim (OSM) en secours.
3. **Overpass** – Le serveur public a des limites par IP et un temps d'exécution maximal ; je n'ai pas pu confirmer les chiffres exacts. Donc : requêtes bornées (rectangle ou polygone dessiné, pas « toute la France »), **mise en cache locale** des bâtiments déjà téléchargés, gestion des erreurs 429/504 avec nouvel essai et serveur miroir. (Le CORS d'Overpass est à vérifier en phase 2 par un test réel.)
4. **Qualité des données OSM** – Un bâtiment OSM n'a pas toujours d'adresse, et un immeuble collectif = 1 emprise pour plusieurs logements. Prévoir : adresse affichée par géocodage inverse **à la demande** (au clic), possibilité d'ajouter un point manuel (maison manquante) et un champ « nb de logements » pour les immeubles.
5. **Perte de données** – Les données du navigateur peuvent être effacées (nettoyage, autre navigateur). Donc : sauvegarde auto + **export JSON** régulier (rappel dans l'app) ; optionnel : fichier lié via l'API *File System Access* (Chrome/Edge).
6. **RGPD** – Si l'on note des noms / coordonnées d'habitants, ce sont des données personnelles : tout reste en local sur l'ordinateur (aucun serveur), à dire dans l'app. Ne pas publier le dépôt GitHub avec des vraies données de prospection (le `.gitignore` doit exclure les exports).

---

## 2. Choix techniques

- **Stack** : HTML + CSS + JavaScript « vanille », **sans build, sans npm, sans module ES** (les `<script type="module">` sont bloqués en `file://`, on utilise donc des scripts classiques ou un objet global `App`).
- **Dépendances** : uniquement Leaflet (et éventuellement `leaflet.markercluster`, `Leaflet.draw` ou équivalent), copiées dans `vendor/`.
- **Arborescence cible**
  ```
  index.html
  css/style.css
  js/app.js        (initialisation)
  js/map.js        (carte, couches, rendu des bâtiments)
  js/data.js       (Overpass, géocodage, cache)
  js/store.js      (IndexedDB, export/import)
  js/stats.js      (statistiques, graphiques)
  vendor/          (Leaflet…)
  lancer.bat / lancer.sh
  README.md
  ```
- **Modèle de données** (clé = id OSM du bâtiment, ex. `way/123456`) :
  ```json
  { "id": "way/123456", "statut": "contact|prospectus|absent|refus|rappeler|aucun",
    "date": "2026-11-04T10:30", "note": "…", "adresse": "…", "logements": 1 }
  ```
  Plus : secteurs (polygones nommés), préférences, version du schéma.
- **Statuts par défaut** : *Non fait* (gris), *Prospectus déposé* (bleu), *Contact personnel* (vert), *Absent / à repasser* (orange), *Refus / Stop pub* (rouge), *À rappeler* (violet). Les couleurs ne doivent pas reposer que sur la teinte (accessibilité : icône/motif en plus).

---

## 3. Plan de développement en 7 phases

Méthode : une phase = une session / un prompt dans Claude Code Cloud → vous testez → vous commitez/mergez → phase suivante. Dites toujours à Claude de **lancer l'app et de la tester** (Playwright est préinstallé dans l'environnement cloud) avant de conclure.

> Astuce : mettez le **Prompt 0** dans un fichier `CLAUDE.md` à la racine du dépôt pour que toutes les sessions suivantes respectent les mêmes règles.

### Prompt 0 – Règles du projet (à placer dans `CLAUDE.md`)

```
Projet SecteurImmo : application web de suivi de prospection immobilière
terrain (cocher les maisons où j'ai prospecté sur une carte).

Contraintes impératives :
- 100 % HTML/CSS/JavaScript vanille. Aucun backend, aucune base de données,
  aucun npm/bundler/build. Pas de modules ES (<script type="module">) : l'app
  doit marcher en servant simplement le dossier en statique.
- Bibliothèques tierces uniquement copiées dans vendor/ (pas de CDN au runtime,
  sauf les tuiles de carte et les API de données).
- Persistance locale (IndexedDB), avec export/import JSON.
- Interface en français, utilisable sur un grand écran d'ordinateur ET sur
  téléphone (prospection en rue).
- Code simple, commenté en français, un fichier par responsabilité.
- Respecter les politiques d'usage d'OSM (Referer, pas de téléchargement en
  masse de tuiles) et d'Overpass (requêtes bornées, cache, gestion 429/504).
- Avant de conclure toute tâche : lancer l'app, la tester dans le navigateur
  (Playwright), et décrire ce qui a été vérifié.
- Ne jamais committer de données de prospection réelles.
```

### Phase 1 – Squelette, carte et lancement facile

**Objectif** : une page avec une carte plein écran, recherche de ville, et un script de lancement en un clic.

```
Lis CLAUDE.md. Crée le squelette de l'application SecteurImmo :
1. index.html + css/style.css + js/app.js + js/map.js, avec Leaflet copié dans
   vendor/ (télécharge la version stable la plus récente, vérifie sa licence).
2. Une carte plein écran centrée sur la France, fond OpenStreetMap, avec
   un sélecteur de fond : OSM / vue aérienne IGN (Géoplateforme). Vérifie par un
   vrai appel que les tuiles IGN fonctionnent sans clé ; sinon retire l'option
   et dis-le moi.
3. Une barre de recherche (ville ou adresse) utilisant le service de géocodage
   de la Géoplateforme IGN. Teste l'endpoint réel avant de l'utiliser (l'ancien
   api-adresse.data.gouv.fr a été transféré à l'IGN). Prévois Nominatim en secours.
   Recentre la carte sur le résultat.
4. Les scripts lancer.bat (Windows) et lancer.sh (Mac/Linux) qui démarrent
   `python -m http.server 8000` dans le dossier et ouvrent
   http://localhost:8000 dans le navigateur. Explique dans README.md comment
   les utiliser (et ce qu'il faut installer : Python, ou alternative sans Python).
5. Un .gitignore qui exclut les exports de données (*.json d'export).
Teste avec Playwright (capture d'écran) puis commit sur la branche courante.
```

**Critère de réussite** : double-clic sur `lancer.bat` → la carte s'affiche, je cherche « Nantes » et la carte s'y déplace.

### Phase 2 – Charger les maisons (bâtiments) d'un secteur

**Objectif** : afficher les bâtiments d'une zone sous forme de polygones cliquables.

```
Lis CLAUDE.md. Ajoute le chargement des bâtiments autour de la zone visible :
1. js/data.js : fonction qui interroge l'API Overpass (way["building"] + relations
   multipolygones si simple) pour la zone visible (bbox), renvoie du GeoJSON avec
   id OSM stable (ex. "way/123"), tags utiles (addr:housenumber, addr:street,
   building=house/apartments/...).
2. Bouton « Charger les bâtiments de cette zone », désactivé si le zoom est trop
   faible (< 16) pour éviter les requêtes énormes. Indicateur de chargement,
   gestion des erreurs 429/504 avec nouvel essai espacé et serveur Overpass miroir.
3. Affichage des bâtiments en polygones Leaflet (gris = non fait). Au survol :
   adresse si disponible dans les tags.
4. Cache en mémoire pour ne pas retélécharger deux fois la même zone ;
   la persistance viendra à la phase 4.
5. Vérifie par un vrai test que l'appel depuis le navigateur fonctionne (CORS)
   et note dans le README les limites constatées.
Teste sur une zone résidentielle réelle (ex. un quartier pavillonnaire) et
joins une capture d'écran.
```

**Critère** : sur un quartier, je vois toutes les maisons en gris, cliquables.

### Phase 3 – Cocher les maisons (statuts)

```
Lis CLAUDE.md. Ajoute la prise de statut sur les bâtiments :
1. Au clic sur un bâtiment : panneau (fenêtre flottante ou volet latéral, adapté
   au téléphone) avec adresse (géocodage inverse Géoplateforme à la demande),
   boutons de statut en un clic : Prospectus déposé (bleu), Contact personnel
   (vert), Absent / à repasser (orange), Refus / Stop pub (rouge), À rappeler
   (violet), Non fait (gris), + note libre, nombre de logements, date/heure
   automatiques modifiables.
2. Mode « tournée rapide » : un bouton permet de choisir un statut actif, puis
   chaque clic sur un bâtiment lui applique directement ce statut (annuler avec
   Ctrl+Z / bouton Annuler).
3. Mode « sélection multiple » : rectangle ou lasso pour appliquer un statut à
   plusieurs maisons d'un coup (ex. une rue entière de prospectus).
4. Couleurs + icône/motif pour l'accessibilité, légende cliquable qui permet
   de filtrer/masquer par statut.
5. Possibilité d'ajouter manuellement une maison manquante (point sur la carte).
Teste chaque interaction avec Playwright.
```

**Critère** : je colore une rue entière en deux clics, et je peux annuler.

### Phase 4 – Sauvegarde locale, export / import

```
Lis CLAUDE.md. Ajoute js/store.js :
1. Persistance automatique dans IndexedDB de : statuts, notes, bâtiments
   chargés (cache géométrique par zone), préférences de carte, avec numéro de
   version de schéma et migration.
2. Au rechargement de la page, tout est restauré (position de carte, fond,
   statuts).
3. Boutons Exporter (fichier JSON daté, téléchargé) et Importer (fusion ou
   remplacement, avec aperçu du nombre d'éléments) + export CSV
   (id, adresse, statut, date, note, latitude, longitude).
4. Bandeau de rappel si le dernier export date de plus de 7 jours.
5. Si le navigateur le permet, option « fichier de sauvegarde lié » via
   l'API File System Access ; sinon masquée.
6. Affiche dans l'app une mention RGPD courte : données conservées uniquement
   sur cet ordinateur.
Teste : colorer des maisons, recharger, vérifier la restauration ; exporter,
vider IndexedDB, réimporter.
```

**Critère** : je ferme le navigateur, je rouvre, tout est là ; l'export/import fonctionne.

### Phase 5 – Secteurs et suivi de couverture

**Objectif** : « voir si j'ai balayé mon secteur correctement ».

```
Lis CLAUDE.md. Ajoute la notion de secteur :
1. Je dessine un polygone sur la carte (outil de dessin simple, avec vendor/ si
   nécessaire) et je le nomme ; liste des secteurs avec renommer/supprimer/zoom.
2. Pour chaque secteur : nombre de bâtiments, nombre faits, % de couverture,
   répartition par statut. Barre de progression affichée dans la liste.
3. Détection des « trous » : bouton qui met en évidence (clignotement ou
   couleur) les bâtiments non faits du secteur sélectionné et propose
   « Aller au suivant non fait » (le plus proche de ma position/vue).
4. Option : couleur de remplissage du secteur selon son % d'avancement.
5. Tout est persisté via store.js et inclus dans l'export/import.
Teste avec un secteur de 50+ bâtiments.
```

### Phase 6 – Statistiques et tableau de bord

```
Lis CLAUDE.md. Ajoute js/stats.js et un onglet « Statistiques » :
1. Chiffres clés : maisons faites au total, par statut, taux de contact
   (contacts / portes visitées), prospectus déposés, à rappeler.
2. Évolution dans le temps : maisons faites par jour/semaine (graphique en
   barres en SVG ou Canvas, sans librairie lourde), avec sélecteur de période.
3. Classement par rue (rue extraite de l'adresse) : avancement par rue, avec
   la liste des rues non terminées.
4. Liste filtrable/triable de tous les contacts (statut, secteur, période,
   recherche texte dans les notes) avec clic → zoom sur la carte, et export CSV
   de la sélection (pour le suivi / relances).
5. Vue « À rappeler » : liste des maisons à rappeler, triées par date.
Utilise des couleurs accessibles et vérifie le rendu clair/sombre. Teste avec
des données de démonstration générées par un bouton « Charger des données de
test » (sans toucher aux vraies données).
```

### Phase 7 – Confort terrain, finitions et publication

```
Lis CLAUDE.md. Finalise l'application :
1. Mode mobile : gros boutons, panneau en bas d'écran, géolocalisation
   (bouton « Ma position » + point bleu suivi en direct).
2. PWA légère : manifest.json + service worker qui met en cache l'application
   (pas les tuiles en masse, respect de la politique OSM) pour qu'elle
   s'installe sur téléphone et démarre hors ligne avec les données locales.
3. Performance : si > 3000 bâtiments, rendu Canvas (preferCanvas) ou
   simplification ; vérifier la fluidité du déplacement.
4. Accessibilité (contrastes, navigation clavier, libellés), thème clair/sombre.
5. README.md complet : installation, lancement, sauvegarde, limites des données
   OSM, FAQ. Page d'aide intégrée dans l'app.
6. Workflow GitHub Pages (.github/workflows) qui publie le dossier statique,
   avec un avertissement : ne jamais committer de vraies données.
Fais une passe de test complète de bout en bout et liste ce qui reste à faire.
```

---

## 4. Comment travailler avec Claude Code Cloud sur ce dépôt

1. Créez `CLAUDE.md` avec le Prompt 0, committez-le.
2. Lancez **une session par phase**, en collant le prompt de la phase. Demandez à Claude de travailler sur une branche dédiée et d'ouvrir une *pull request* ; relisez les captures d'écran qu'il fournit.
3. Testez en local : récupérez la branche (`git pull`), double-clic sur `lancer.bat` / `lancer.sh`, essayez dans votre vraie ville.
4. Mergez, puis passez à la phase suivante. Si un bug apparaît, décrivez-le avec une capture d'écran dans une nouvelle session (« Lis CLAUDE.md. Bug : … Reproduis-le d'abord avec Playwright, puis corrige »).
5. Gardez un export JSON de vos données hors du dépôt (cloud personnel, clé USB).

## 5. Idées pour plus tard (hors périmètre initial)

- Parcelles cadastrales (données ouvertes du cadastre) à la place des bâtiments OSM pour avoir une unité plus « propriétaire ».
- Couche DVF (ventes récentes) pour repérer les rues actives – à étudier côté licence et volume de données.
- Optimisation d'itinéraire de tournée.
- Synchronisation entre ordinateur et téléphone (nécessiterait un petit service ; contraire à « tout en local », donc à n'envisager que par échange de fichiers export/import).

## Sources consultées

- [Politique d'utilisation des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/)
- [OSM Wiki – Referer](https://wiki.openstreetmap.org/wiki/Referer)
- [Transfert de l'API Adresse à l'IGN (data.gouv.fr)](https://www.data.gouv.fr/fr/posts/lapi-adresse-de-la-base-adresse-nationale-est-transferee-a-lign-10/)
