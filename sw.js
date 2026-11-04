/*
 * sw.js – Service worker : permet d'installer l'application et de la lancer hors ligne.
 *
 * Il ne met en cache QUE les fichiers de l'application (même origine). Les tuiles de carte et les
 * API (OpenStreetMap, IGN, Overpass) ne sont jamais interceptées : pas de téléchargement en masse
 * de tuiles, conformément à la politique d'OpenStreetMap.
 * Stratégie « réseau d'abord » (4 s max) puis cache : on a toujours la dernière version quand on
 * est en ligne, et l'application démarre quand même sans réseau.
 * Les données de prospection ne passent jamais par ici (elles sont dans IndexedDB).
 */
'use strict';

var VERSION = 'secteurimmo-v1';   // à changer si des fichiers sont supprimés/renommés
var FICHIERS = [
  './', 'index.html', 'manifest.json',
  'css/style.css',
  'js/pwa.js', 'js/geocode.js', 'js/data.js', 'js/statuts.js', 'js/ui.js', 'js/map.js', 'js/panneau.js',
  'js/position.js', 'js/secteurs.js', 'js/secteurs-ui.js', 'js/stats.js', 'js/stats-ui.js', 'js/outils.js',
  'js/store.js', 'js/echange.js', 'js/aide.js', 'js/app.js',
  'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/LICENSE',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
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
