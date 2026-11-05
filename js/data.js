/*
 * data.js – Récupération des bâtiments (maisons) via l'API Overpass d'OpenStreetMap.
 *
 * Règles d'usage respectées :
 *  - requêtes bornées (zone visible uniquement, zoom minimum, surface maximale) ;
 *  - une seule requête à la fois ;
 *  - cache : on ne retélécharge jamais une zone déjà chargée ni un bâtiment déjà connu ;
 *  - erreurs 429 / 504 / réseau : nouvel essai espacé, en alternant entre serveurs miroirs.
 * Expose l'objet global DataImmo.
 */
var DataImmo = (function () {
  'use strict';

  var config = {
    serveurs: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ],
    zoomMin: 16,            // en dessous, la zone est trop grande
    surfaceMaxKm2: 6,       // garde-fou sur la taille de la zone demandée
    tentativesMax: 4,
    delaiRetryMs: 2000,     // délai de base, doublé à chaque nouvel essai
    delaiMaxRequeteMs: 45000
  };

  var batiments = {};   // cache mémoire : id ("way/123") -> Feature GeoJSON
  var zones = [];       // zones déjà chargées : { b: [sud, ouest, nord, est], t: date en ms }
  var VALIDITE_ZONE_MS = 30 * 24 * 3600 * 1000; // au-delà, on retélécharge (OSM évolue)
  var enCours = false;
  var ecouteursActivite = [];   // informés du début / de la fin des téléchargements (barre de progression)
  function activite(v) { ecouteursActivite.forEach(function (cb) { cb(v); }); }

  // ---------- Zones ----------

  // Convertit des bornes Leaflet en [sud, ouest, nord, est]
  function boite(bounds) {
    return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
  }

  // Surface approximative d'une boîte en km²
  function surfaceKm2(b) {
    var latMoy = (b[0] + b[2]) / 2 * Math.PI / 180;
    var h = (b[2] - b[0]) * 111.32;
    var l = (b[3] - b[1]) * 111.32 * Math.cos(latMoy);
    return h * l;
  }

  // Vrai si la boîte a est entièrement contenue dans la boîte b
  function contenue(a, b) {
    return a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
  }

  function dejaCharge(b) {
    var limite = Date.now() - VALIDITE_ZONE_MS;
    return zones.some(function (z) { return z.t >= limite && contenue(b, z.b); });
  }

  // ---------- Conversion Overpass -> GeoJSON ----------

  function anneau(geometrie) {
    if (!geometrie || geometrie.length < 4) return null;
    var pts = geometrie.map(function (p) { return [p.lon, p.lat]; });
    var a = pts[0], z = pts[pts.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) return null; // contour non fermé : ignoré
    return pts;
  }

  function enFeature(el) {
    var geom = null;
    if (el.type === 'way') {
      var r = anneau(el.geometry);
      if (r) geom = { type: 'Polygon', coordinates: [r] };
    } else if (el.type === 'relation') {
      // Cas simples : contours extérieurs déjà fermés (pas de recollage de segments)
      var ext = [], int = [];
      (el.members || []).forEach(function (m) {
        if (m.type !== 'way') return;
        var a = anneau(m.geometry);
        if (!a) return;
        if (m.role === 'outer') ext.push(a); else if (m.role === 'inner') int.push(a);
      });
      if (ext.length === 1) geom = { type: 'Polygon', coordinates: [ext[0]].concat(int) };
      else if (ext.length > 1) geom = { type: 'MultiPolygon', coordinates: ext.map(function (e) { return [e]; }) };
    }
    if (!geom) return null;
    return { type: 'Feature', id: el.type + '/' + el.id, properties: el.tags || {}, geometry: geom };
  }

  // ---------- Requête Overpass ----------

  function requete(b) {
    var bbox = b.map(function (v) { return v.toFixed(6); }).join(',');
    return '[out:json][timeout:30];(' +
      'way["building"](' + bbox + ');' +
      'relation["building"]["type"="multipolygon"](' + bbox + ');' +
      ');out tags geom;';
  }

  function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  // Une tentative sur un serveur. Rejette avec { reessayer: bool, message }.
  function tenter(url, texte) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, config.delaiMaxRequeteMs);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(texte),
      signal: ctrl.signal
    }).then(function (r) {
      if (r.status === 429 || r.status === 504 || r.status === 502 || r.status === 503) {
        throw { reessayer: true, message: 'Serveur de données occupé (HTTP ' + r.status + ')' };
      }
      if (!r.ok) throw { reessayer: false, message: 'Erreur du serveur de données (HTTP ' + r.status + ')' };
      return r.json();
    }, function () {
      throw { reessayer: true, message: 'Serveur de données injoignable' };
    }).then(function (json) {
      // Overpass peut répondre 200 avec un "remark" quand il a manqué de temps/mémoire
      if (json && json.remark && /timed out|out of memory/i.test(json.remark)) {
        throw { reessayer: true, message: 'Zone trop chargée pour le serveur de données' };
      }
      return json;
    }).finally(function () { clearTimeout(timer); });
  }

  function telecharger(b, surEssai) {
    var texte = requete(b);
    var n = 0;
    function essai() {
      var url = config.serveurs[n % config.serveurs.length];
      return tenter(url, texte).catch(function (err) {
        n++;
        if (!err || !err.reessayer || n >= config.tentativesMax) throw new Error(err && err.message || 'Erreur inconnue');
        var delai = config.delaiRetryMs * Math.pow(2, n - 1);
        if (surEssai) surEssai(n, config.tentativesMax - 1, delai);
        return attendre(delai).then(essai);
      });
    }
    return essai();
  }

  /*
   * Charge les bâtiments de la zone (Leaflet LatLngBounds).
   * Résout avec { nouveaux: [Feature…], total, dejaCharge: bool }.
   * surEssai(numero, max, delaiMs) est appelé avant chaque nouvel essai.
   */
  function charger(bounds, zoom, surEssai) {
    if (zoom < config.zoomMin) return Promise.reject(new Error('Zoomez davantage (niveau ' + config.zoomMin + ' minimum).'));
    if (enCours) return Promise.reject(new Error('Un chargement est déjà en cours.'));
    var b = boite(bounds);
    if (surfaceKm2(b) > config.surfaceMaxKm2) return Promise.reject(new Error('Zone trop grande : zoomez davantage.'));
    if (dejaCharge(b)) return Promise.resolve({ nouveaux: [], total: Object.keys(batiments).length, dejaCharge: true });

    enCours = true; activite(true);
    return telecharger(b, surEssai).then(function (json) {
      var nouveaux = [];
      (json.elements || []).forEach(function (el) {
        var f = enFeature(el);
        if (f && !batiments[f.id]) { batiments[f.id] = f; nouveaux.push(f); }
      });
      zones.push({ b: b, t: Date.now() });
      return { nouveaux: nouveaux, total: Object.keys(batiments).length, dejaCharge: false };
    }).finally(function () { enCours = false; activite(false); });
  }

  // ---------- Libellés ----------

  var TYPES = {
    house: 'Maison', detached: 'Maison individuelle', semidetached_house: 'Maison mitoyenne',
    terrace: 'Maison de ville', residential: 'Bâtiment résidentiel', apartments: 'Immeuble',
    garage: 'Garage', garages: 'Garages', shed: 'Abri', yes: 'Bâtiment', commercial: 'Commerce',
    retail: 'Commerce', industrial: 'Industriel', school: 'École', church: 'Église'
  };

  function adresse(props) {
    var rue = props['addr:street'];
    var num = props['addr:housenumber'];
    if (!rue && !num) return '';
    return [num, rue].filter(Boolean).join(' ');
  }

  function typeBatiment(props) { return TYPES[props.building] || 'Bâtiment'; }

  return {
    config: config,
    charger: charger,
    adresse: adresse,
    typeBatiment: typeBatiment,
    // Pour les tests / phases suivantes
    // Restaure le cache depuis la base locale / un import
    // Vrai si la zone (LatLngBounds) est entièrement couverte par des zones déjà chargées et récentes
    estCharge: function (bounds) { return dejaCharge(boite(bounds)); },
    surActivite: function (cb) { ecouteursActivite.push(cb); },
    enCours: function () { return enCours; },
    restaurer: function (features, zonesSauvees) {
      (features || []).forEach(function (f) { batiments[f.id] = f; });
      if (zonesSauvees) zones = zonesSauvees;
    },
    ajouter: function (features) { features.forEach(function (f) { if (!batiments[f.id]) batiments[f.id] = f; }); },
    zones: function () { return zones; },
    batiment: function (id) { return batiments[id] || null; },
    _batiments: function () { return batiments; }
  };
})();
