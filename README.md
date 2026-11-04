# SecteurImmo

Application web (HTML/CSS/JS, sans serveur ni base de données) pour suivre sa prospection immobilière sur une carte. Voir `PLAN.md` pour la feuille de route.

## Lancer l'application

Un petit serveur local est nécessaire : OpenStreetMap bloque les pages ouvertes par double-clic sur `index.html` (adresse `file://`, sans en-tête *Referer*).

- **Windows** : double-clic sur `lancer.bat`
- **Mac / Linux** : `./lancer.sh` (ou double-clic selon votre gestionnaire de fichiers)

Le script démarre `python -m http.server` sur `http://localhost:8000` et ouvre le navigateur. Il faut **Python 3** ([python.org](https://www.python.org/downloads/)). Pour arrêter : fermez la fenêtre (ou Ctrl+C).

Sans Python : l'extension « Live Server » de VS Code, ou toute commande qui sert le dossier en statique, convient aussi.

## Fonctions actuelles (phase 1)

- Carte plein écran (France), fonds : plan OpenStreetMap, plan IGN, vue aérienne IGN (menu en haut à droite).
- Recherche de ville ou d'adresse avec suggestions (géocodage Géoplateforme IGN, secours Nominatim).

## Bibliothèques

- [Leaflet](https://leafletjs.com/) 1.9.4 (BSD-2), copiée dans `vendor/leaflet/`.

## Données et vie privée

Aucune donnée n'est envoyée à un serveur du projet. Ne committez jamais d'exports de prospection (le `.gitignore` en exclut les noms usuels).
