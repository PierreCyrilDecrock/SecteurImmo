/*
 * sw.js – Service worker : permet d'installer l'application et de la lancer hors ligne.
 *
 * Il ne met en cache QUE les fichiers de l'application (même origine). Les tuiles de carte et les
 * API (OpenStreetMap, IGN, Overpass) ne sont jamais interceptées : pas de téléchargement en masse
 * de tuiles, conformément à la politique d'OpenStreetMap.
 * Code de l'application : « réseau d'abord » (4 s max) puis cache : on a toujours la dernière version quand
 * on est en ligne, et l'application démarre quand même sans réseau. Bibliothèques (vendor/) et icônes :
 * « cache d'abord » (elles ne changent qu'avec VERSION).
 * Les données de prospection ne passent jamais par ici (elles sont dans IndexedDB).
 */
'use strict';

var VERSION = 'secteurimmo-v3';   // à changer si des fichiers sont supprimés/renommés
var FICHIERS = [
  './',
  'index.html',
  'manifest.json',
  'css/tokens.css',
  'css/composants.css',
  'css/coquille.css',
  'css/carte.css',
  'css/panneaux.css',
  'css/tableau.css',
  'vendor/leaflet/leaflet.js',
  'js/pwa.js',
  'js/theme.js',
  'js/ui.js',
  'js/notifications.js',
  'js/geocode.js',
  'js/data.js',
  'js/statuts.js',
  'js/etiquettes.js',
  'js/map.js',
  'js/coquille.js',
  'js/carte-ui.js',
  'js/etiquettes-ui.js',
  'js/panneau.js',
  'js/position.js',
  'js/secteurs.js',
  'js/secteurs-ui.js',
  'js/rappels-ui.js',
  'js/stats.js',
  'js/stats-ui.js',
  'js/outils.js',
  'js/palette.js',
  'js/store.js',
  'js/echange.js',
  'js/aide.js',
  'js/app.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'vendor/inter/LICENSE',
  'vendor/inter/inter-latin-wght-normal.woff2',
  'vendor/leaflet/LICENSE',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/leaflet/leaflet.css',
  'vendor/lucide/LICENSE',
  'vendor/lucide/icons.svg'
];
var DELAI_RESEAU_MS = 4000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FICHIERS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (noms) {
      return Promise.all(noms.filter(function (n) { return n.indexOf('secteurimmo-') === 0 && n !== VERSION; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function reseauAvecDelai(req) {
  return new Promise(function (ok, ko) {
    var fini = false;
    var t = setTimeout(function () { if (!fini) { fini = true; ko(new Error('délai dépassé')); } }, DELAI_RESEAU_MS);
    fetch(req, { cache: 'no-cache' }).then(function (r) { if (!fini) { fini = true; clearTimeout(t); ok(r); } },
      function (e) { if (!fini) { fini = true; clearTimeout(t); ko(e); } });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // tuiles et API : jamais interceptées
  // Bibliothèques, police, icônes : cache d'abord (elles ne changent qu'avec VERSION) → démarrage plus rapide
  if (/\/(vendor|icons)\//.test(url.pathname)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) {
      return r || fetch(req).then(function (res) {
        if (res && res.ok) { var c = res.clone(); caches.open(VERSION).then(function (cache) { cache.put(req, c); }); }
        return res;
      });
    }));
    return;
  }
  e.respondWith(
    reseauAvecDelai(req).then(function (res) {
      if (res && res.ok) { var copie = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copie); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) {
        return r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
      });
    })
  );
});
