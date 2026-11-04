# SecteurImmo

Application web (HTML/CSS/JS, sans serveur ni base de données) pour suivre sa prospection immobilière sur une carte. Voir `PLAN.md` pour la feuille de route.

## Lancer l'application

Un petit serveur local est nécessaire : OpenStreetMap bloque les pages ouvertes par double-clic sur `index.html` (adresse `file://`, sans en-tête *Referer*).

- **Windows** : double-clic sur `lancer.bat`
- **Mac / Linux** : `./lancer.sh` (ou double-clic selon votre gestionnaire de fichiers)

Le script démarre `python -m http.server` sur `http://localhost:8000` et ouvre le navigateur. Il faut **Python 3** ([python.org](https://www.python.org/downloads/)). Pour arrêter : fermez la fenêtre (ou Ctrl+C).

Sans Python : l'extension « Live Server » de VS Code, ou toute commande qui sert le dossier en statique, convient aussi.

## Fonctions actuelles (phases 1 à 4)

- Carte plein écran (France), fonds : plan OpenStreetMap, plan IGN, vue aérienne IGN (menu en haut à droite).
- Recherche de ville ou d'adresse avec suggestions (géocodage Géoplateforme IGN, secours Nominatim).
- Bouton **« Charger les bâtiments de cette zone »** (actif à partir du zoom 16) : télécharge les bâtiments OpenStreetMap de la zone visible via l'API Overpass et les affiche en gris (« non fait »). Survol : type de bâtiment et adresse si OSM la connaît.

### Prospection (phase 3)

Barre d'outils sous la recherche :
- 👆 **Consulter** : un clic sur un bâtiment ouvre sa fiche (adresse, statut en un clic, date/heure modifiable, nombre de logements, note). Si OpenStreetMap n'a pas l'adresse, elle est cherchée par géocodage inverse (une fois, à l'ouverture de la fiche).
- ⚡ **Tournée** : on choisit un statut, puis chaque clic sur une maison le lui applique.
- ⬚ **Sélection** : glisser un **rectangle** ou un **lasso** sur la carte (souris ou doigt), puis appliquer un statut à toutes les maisons entourées. La carte ne se déplace pas pendant ce mode (revenir en Consulter pour la déplacer).
- ➕ **Ajouter** : un clic sur la carte crée un point pour une maison absente d'OpenStreetMap (supprimable depuis sa fiche).
- ↶ **Annuler** (ou Ctrl/Cmd+Z) : annule les changements de statut, note, logements, date. `Échap` revient au mode Consulter.
- 🎨 **Légende** : compteurs par statut, et cases pour masquer/afficher chaque statut.

Statuts : Non fait (gris), Prospectus déposé (bleu, contour tireté), Contact personnel (vert), Absent / à repasser (orange), Refus / Stop pub (rouge), À rappeler (violet). Chaque statut a aussi un style de contour et une icône (visible à fort zoom) pour rester lisible sans distinguer les couleurs.

La suppression d'un point manuel n'est pas annulable.

### Sauvegarde, export, import (phase 4)

- **Sauvegarde automatique** dans le navigateur (IndexedDB) : statuts, notes, points ajoutés, adresses trouvées, contours des bâtiments téléchargés, zones déjà chargées (valables 30 jours, pour éviter de retélécharger), position de la carte et fond choisi. Tout est restauré au rechargement de la page. Les données sont propres au navigateur **et** à l'adresse (`localhost:8000`) : changer de navigateur ou de port repart de zéro (utilisez l'export/import pour déplacer vos données).
- **Bouton 💾 (en haut à droite)** :
  - *Exporter (JSON)* : sauvegarde complète (`secteurimmo-AAAA-MM-JJ.json`) ; seuls les contours des bâtiments cochés sont inclus.
  - *Exporter (CSV)* : `id ; adresse ; statut ; date ; note ; logements ; latitude ; longitude`, séparateur `;`, UTF-8 avec BOM (s'ouvre directement dans Excel français). Les cellules de texte commençant par `= + - @` sont préfixées d'une apostrophe (protection contre l'injection de formules).
  - *Importer* : aperçu du contenu puis **Fusionner** (en cas de conflit sur un bâtiment, l'entrée la plus récente est gardée) ou **Remplacer** (avec, par défaut, téléchargement préalable d'une sauvegarde de vos données actuelles). Le fichier est validé et nettoyé avant d'être pris en compte.
  - *Lier un fichier de sauvegarde* (Chrome / Edge uniquement) : l'application réécrit ce fichier automatiquement quelques secondes après chaque modification. Après un redémarrage du navigateur, il faut cliquer sur « Reconnecter le fichier lié » (autorisation à redonner).
  - *Effacer toutes mes données*.
- **Rappel** : un bandeau apparaît si aucun export n'a été fait depuis plus de 7 jours (« Plus tard » le repousse de 24 h).
- Si le navigateur n'autorise pas IndexedDB (navigation privée…), l'application fonctionne mais sans sauvegarde automatique : un message l'indique, exportez régulièrement.
- Le format de sauvegarde porte un numéro de schéma (actuellement 1) pour pouvoir évoluer.
- **Non vérifié en conditions réelles** : le fichier lié avec la vraie API *File System Access* (testé avec une simulation) ; testez-le sous Chrome ou Edge.

### Règles et limites du chargement (Overpass)

- Requêtes bornées : zoom ≥ 16 et zone ≤ 6 km² ; une seule requête à la fois.
- Cache en mémoire : une zone (ou un bâtiment) déjà chargé n'est jamais retéléchargé. Le cache est conservé dans la sauvegarde locale (voir ci-dessus).
- Erreurs 429 / 502 / 503 / 504 ou réseau : jusqu'à 4 essais espacés (2 s, 4 s, 8 s), en alternant entre `overpass-api.de` et le miroir `overpass.kumi.systems`.
- Les relations multipolygones sont gérées dans les cas simples (contours extérieurs déjà fermés) ; les contours non fermés sont ignorés.
- Beaucoup de bâtiments OSM n'ont pas d'adresse (affichée « adresse inconnue ») ; le géocodage inverse (IGN, secours Nominatim) la complète à l'ouverture de la fiche ; le champ `distance` de sa réponse n'a pas pu être vérifié (adresse approximative marquée « ≈ » si présent).
- **Non vérifié en conditions réelles** : le développement s'est fait dans un environnement dont le réseau bloquait Overpass ; le comportement (CORS, limites exactes) a été testé avec des réponses simulées. À confirmer chez vous (voir la console du navigateur en cas d'erreur).

## Bibliothèques

- [Leaflet](https://leafletjs.com/) 1.9.4 (BSD-2), copiée dans `vendor/leaflet/`.

## Données et vie privée

Aucune donnée n'est envoyée à un serveur du projet : tout reste dans votre navigateur. Les notes peuvent contenir des données personnelles, protégez vos exports. Ne committez jamais d'exports de prospection (le `.gitignore` en exclut les noms usuels).
