# SecteurImmo

Projet SecteurImmo : application web de suivi de prospection immobilière
terrain (cocher les maisons où j'ai prospecté sur une carte).

## Contraintes impératives

- 100 % HTML/CSS/JavaScript vanille. Aucun backend, aucune base de données,
  aucun npm/bundler/build. Pas de modules ES (`<script type="module">`) : l'app
  doit marcher en servant simplement le dossier en statique.
- Bibliothèques tierces uniquement copiées dans `vendor/` (pas de CDN au runtime,
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
