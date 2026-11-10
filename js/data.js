/*
 * data.js – Bâtiments et adresses : sources de données, conversion, cache mémoire.
 *
 * Source principale : IGN (Géoplateforme, service WFS, licence ouverte) :
 *   - BD TOPO « batiment » : contour, usage, nombre de logements et d'étages, construction légère ;
 *   - BAN-PLUS « adresse » et « lien_adresse_bati » : adresses officielles rattachées à chaque bâtiment.
 * Secours : API Overpass d'OpenStreetMap (petites zones seulement), si l'IGN ne répond pas.
 *
 * Ce module ne fait que préparer les requêtes, les envoyer (une tentative) et convertir les réponses ;
 * l'enchaînement, les nouveaux essais et la reprise sont gérés par telechargements.js.
 * Expose l'objet global DataImmo.
 */
var DataImmo = (function () {
  'use strict';

  var config = {
    wfs: 'https://data.geopf.fr/wfs/ows',
    page: 5000,              // objets par requête (maximum du service)
    pageReduite: 2000,       // après une expiration : pages plus petites
    delaiMaxRequeteMs: 60000,
    serveursOsm: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ],
    zoomMin: 15,             // pastille « Charger les maisons de cette zone » à partir de ce zoom
    surfaceMaxKm2: 25,       // taille maximale d'une zone à l'écran (au-delà : commune ou secteur)
    surfaceMaxOsmKm2: 6      // secours OpenStreetMap : zones plus petites (service plus fragile)
  };

  var batiments = {};   // id ("bdt/302931011", "way/123") -> Feature GeoJSON compacte
  var zones = [];       // zones déjà chargées : { b: [sud, ouest, nord, est], t, src: 'ign' | 'osm', poly?: [[lat, lon]…] }
  var VALIDITE_ZONE_MS = 30 * 24 * 3600 * 1000; // au-delà, la zone est proposée de nouveau (les données évoluent)

  // ---------- Géométrie ----------

  function boite(bounds) { return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()]; }
  function surfaceKm2(b) {
    var latMoy = (b[0] + b[2]) / 2 * Math.PI / 180;
    return (b[2] - b[0]) * 111.32 * (b[3] - b[1]) * 111.32 * Math.cos(latMoy);
  }
  function contenue(a, b) { return a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3]; }
  function dansPolygone(lat, lon, poly) { // lancer de rayon ; poly = [[lat, lon], …]
    var dedans = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dedans = !dedans;
    }
    return dedans;
  }
  function boiteDe(poly) {
    var b = [90, 180, -90, -180];
    poly.forEach(function (p) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    return b;
  }

  // Simplification d'un contour (Douglas-Peucker) jusqu'à `max` points au plus ; poly = [[lat, lon]…]
  function simplifier(poly, max) {
    if (poly.length <= max) return poly.slice();
    function distance(p, a, b) {
      var dx = b[1] - a[1], dy = b[0] - a[0], l = dx * dx + dy * dy;
      if (!l) return Math.hypot(p[1] - a[1], p[0] - a[0]);
      var t = Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / l));
      return Math.hypot(p[1] - (a[1] + t * dx), p[0] - (a[0] + t * dy));
    }
    function dp(pts, tol) {
      var garde = new Array(pts.length); garde[0] = garde[pts.length - 1] = true;
      var pile = [[0, pts.length - 1]];
      while (pile.length) {
        var s = pile.pop(), dMax = 0, k = -1;
        for (var i = s[0] + 1; i < s[1]; i++) { var d = distance(pts[i], pts[s[0]], pts[s[1]]); if (d > dMax) { dMax = d; k = i; } }
        if (dMax > tol) { garde[k] = true; pile.push([s[0], k], [k, s[1]]); }
      }
      return pts.filter(function (p, i) { return garde[i]; });
    }
    var tol = 0.00002, r = poly;
    while (r.length > max && tol < 1) { r = dp(poly, tol); tol *= 1.6; }
    return r;
  }

  // ---------- Zones déjà chargées ----------

  function dejaCharge(b) {
    var limite = Date.now() - VALIDITE_ZONE_MS;
    return zones.some(function (z) {
      // Seules les zones téléchargées depuis l'IGN comptent (une zone OpenStreetMap peut être complétée)
      if (z.src !== 'ign' || z.t < limite || !contenue(b, z.b)) return false;
      if (!z.poly) return true;
      // Zone chargée en suivant un contour (commune, secteur) : les 4 coins de la vue doivent y être
      return [[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]].every(function (c) { return dansPolygone(c[0], c[1], z.poly); });
    });
  }
  function ajouterZone(z) { zones.push({ b: z.b, t: Date.now(), src: z.src || 'ign', poly: z.poly || undefined }); }

  // ---------- Requêtes IGN (WFS) ----------

  var COUCHES = {
    bat: { nom: 'BDTOPO_V3:batiment', geo: 'geometrie', tri: 'cleabs',
      champs: 'cleabs,usage_1,usage_2,nombre_de_logements,nombre_d_etages,construction_legere,etat_de_l_objet,geometrie' },
    adr: { nom: 'BAN-PLUS:adresse', geo: 'geom', tri: 'id', champs: 'id_adr,numero,rep,nom_voie' },
    lien: { nom: 'BAN-PLUS:lien_adresse_bati', geo: 'geom', tri: 'id_adr', champs: 'id_adr,id_bat' }
  };

  function wkt(poly) {   // [[lat, lon]…] -> POLYGON((lon lat, …)) fermé
    var p = poly.map(function (x) { return x[1].toFixed(5) + ' ' + x[0].toFixed(5); });
    if (p[0] !== p[p.length - 1]) p.push(p[0]);
    return 'SRID=4326;POLYGON((' + p.join(',') + '))';
  }

  /*
   * URL d'une page de résultats. zone = { b: [s, o, n, e], poly?: [[lat, lon]…] (≤ 150 points), insee? }
   * Bâtiments : filtrés par le contour s'il y en a un ; adresses : par commune (code INSEE) ou contour ;
   * liens adresse-bâtiment : par l'emprise (filtrage géométrique trop lent sur cette couche).
   */
  function urlIgn(couche, zone, debut, nb) {
    var c = COUCHES[couche];
    var q = ['SERVICE=WFS', 'VERSION=2.0.0', 'REQUEST=GetFeature', 'OUTPUTFORMAT=application/json',
      'TYPENAMES=' + c.nom, 'PROPERTYNAME=' + c.champs, 'SORTBY=' + c.tri, 'COUNT=' + nb, 'STARTINDEX=' + debut];
    var cql = null;
    if (couche === 'adr' && zone.insee) cql = 'insee_com=\'' + zone.insee + '\'';
    else if (couche !== 'lien' && zone.poly) cql = 'INTERSECTS(' + c.geo + ',' + wkt(zone.poly) + ')';
    if (cql) q.push('CQL_FILTER=' + encodeURIComponent(cql));
    else q.push('BBOX=' + zone.b.map(function (v) { return v.toFixed(6); }).join(',') + ',urn:ogc:def:crs:EPSG::4326');
    return config.wfs + '?' + q.join('&');
  }

  /*
   * Une tentative (GET ou POST). Résout avec le JSON ; rejette avec { reessayer, message, attenteMs? }.
   */
  function tenter(url, corps) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, config.delaiMaxRequeteMs);
    var opts = { signal: ctrl.signal };
    if (corps) { opts.method = 'POST'; opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }; opts.body = corps; }
    return fetch(url, opts).then(function (r) {
      if (r.status === 429) {
        var ra = parseInt(r.headers.get('Retry-After'), 10);
        throw { reessayer: true, message: 'Trop de demandes : le serveur demande de patienter', attenteMs: ra > 0 ? ra * 1000 : 0 };
      }
      if (r.status === 502 || r.status === 503 || r.status === 504) throw { reessayer: true, message: 'Serveur occupé (HTTP ' + r.status + ')' };
      if (!r.ok) throw { reessayer: r.status >= 500, message: 'Erreur du serveur (HTTP ' + r.status + ')' };
      return r.json().catch(function () { throw { reessayer: true, message: 'Réponse incomplète du serveur' }; });
    }, function () {
      throw { reessayer: true, expire: ctrl.signal.aborted, message: ctrl.signal.aborted ? 'Le serveur met trop de temps à répondre' : 'Serveur injoignable (réseau)' };
    }).then(function (json) {
      if (json && json.remark && /timed out|out of memory/i.test(json.remark)) throw { reessayer: true, expire: true, message: 'Zone trop chargée pour le serveur' };
      return json;
    }).finally(function () { clearTimeout(timer); });
  }

  // ---------- Conversion ----------

  // Premier contour extérieur, sans altitude, arrondi au dix-millionième de degré (~1 cm)
  function anneauGeoJson(coords) {
    return coords.map(function (p) { return [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]; });
  }
  function idIgn(cleabs) { return 'bdt/' + String(parseInt(String(cleabs).replace(/\D/g, ''), 10)); }

  function enFeatureIgn(f) {
    var p = f.properties || {}, g = f.geometry;
    if (!g || !p.cleabs) return null;
    if (p.etat_de_l_objet && p.etat_de_l_objet !== 'En service' && p.etat_de_l_objet !== 'En construction') return null;
    var polys = g.type === 'MultiPolygon' ? g.coordinates : (g.type === 'Polygon' ? [g.coordinates] : []);
    if (!polys.length || !polys[0][0] || polys[0][0].length < 4) return null;
    var geom = polys.length === 1 ? { type: 'Polygon', coordinates: [anneauGeoJson(polys[0][0])] }
      : { type: 'MultiPolygon', coordinates: polys.map(function (pl) { return [anneauGeoJson(pl[0])]; }) };
    var props = { src: 'bdtopo' };
    if (p.usage_1) props.u1 = p.usage_1;
    if (p.usage_2) props.u2 = p.usage_2;
    if (p.construction_legere) props.leg = true;
    if (p.nombre_de_logements > 0) props.lgt = p.nombre_de_logements;
    if (p.nombre_d_etages > 0) props.etg = p.nombre_d_etages;
    props._t = TypesBati.classer(props);
    return { type: 'Feature', id: idIgn(p.cleabs), properties: props, geometry: geom };
  }

  function anneauOsm(geometrie) {
    if (!geometrie || geometrie.length < 4) return null;
    var pts = geometrie.map(function (p) { return [p.lon, p.lat]; });
    var a = pts[0], z = pts[pts.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) return null; // contour non fermé : ignoré
    return pts;
  }
  function enFeatureOsm(el) {
    var geom = null;
    if (el.type === 'way') {
      var r = anneauOsm(el.geometry);
      if (r) geom = { type: 'Polygon', coordinates: [r] };
    } else if (el.type === 'relation') {
      var ext = [];
      (el.members || []).forEach(function (m) { if (m.type === 'way' && m.role === 'outer') { var a = anneauOsm(m.geometry); if (a) ext.push(a); } });
      if (ext.length === 1) geom = { type: 'Polygon', coordinates: [ext[0]] };
      else if (ext.length > 1) geom = { type: 'MultiPolygon', coordinates: ext.map(function (e) { return [e]; }) };
    }
    if (!geom) return null;
    var props = Object.assign({}, el.tags || {});
    props._t = TypesBati.classer(props);
    return { type: 'Feature', id: el.type + '/' + el.id, properties: props, geometry: geom };
  }

  // Ajoute des bâtiments au cache ; renvoie ceux qui étaient inconnus
  function integrer(features) {
    var nouveaux = [];
    features.forEach(function (f) { if (f && !batiments[f.id]) { batiments[f.id] = f; nouveaux.push(f); } });
    return nouveaux;
  }

  // Page de bâtiments IGN -> { nouveaux, recus }
  function integrerIgn(json) {
    var fs = (json.features || []).map(enFeatureIgn).filter(Boolean);
    return { nouveaux: integrer(fs), recus: (json.features || []).length };
  }

  // Libellé d'une adresse BAN : « 11 bis Rue Galilée »
  function libelleAdresse(p) {
    var rep = p.rep ? ' ' + String(p.rep).toLowerCase() : '';
    return ((p.numero ? p.numero + rep + ' ' : '') + (p.nom_voie || '')).trim();
  }
  // Page d'adresses -> { id_adr: { n: '11 bis', v: 'Rue Galilée' } } (ajoutées à `table`)
  function lireAdresses(json, table) {
    (json.features || []).forEach(function (f) {
      var p = f.properties || {};
      if (!p.id_adr || !p.nom_voie) return;
      table[p.id_adr] = { n: p.numero ? p.numero + (p.rep ? ' ' + String(p.rep).toLowerCase() : '') : '', v: p.nom_voie };
    });
  }
  // Page de liens adresse -> bâtiment : complète les bâtiments connus ; renvoie ceux qui ont changé
  function lierAdresses(json, table) {
    var modifies = {};
    (json.features || []).forEach(function (f) {
      var p = f.properties || {}, a = table[p.id_adr];
      if (!a || !p.id_bat) return;
      var b = batiments[idIgn(p.id_bat)];
      if (!b) return;
      var pr = b.properties, lib = (a.n ? a.n + ' ' : '') + a.v;
      pr.adr = pr.adr || [];
      if (pr.adr.indexOf(lib) >= 0) return;
      pr.adr.push(lib);
      if (pr.adr.length === 1) { pr['addr:street'] = a.v; if (a.n) pr['addr:housenumber'] = a.n; }
      modifies[b.id] = b;
    });
    return Object.keys(modifies).map(function (k) { return modifies[k]; });
  }

  // ---------- Secours OpenStreetMap (Overpass) ----------

  function requeteOsm(b) {
    var bbox = b.map(function (v) { return v.toFixed(6); }).join(',');
    return '[out:json][timeout:30];(way["building"](' + bbox + ');relation["building"]["type"="multipolygon"](' + bbox + '););out tags geom;';
  }
  function urlOsm(n) { return config.serveursOsm[n % config.serveursOsm.length]; }
  function corpsOsm(b) { return 'data=' + encodeURIComponent(requeteOsm(b)); }
  function integrerOsm(json) {
    var fs = (json.elements || []).map(enFeatureOsm).filter(Boolean);
    // Un bâtiment déjà connu par l'IGN au même endroit n'est pas ajouté en double
    var index = indexIgn(Object.keys(batiments).filter(estIgn).map(function (k) { return batiments[k]; }));
    fs = fs.filter(function (f) { var c = centreDe(f); return !trouverDans(index, c[0], c[1]); });
    return { nouveaux: integrer(fs), recus: (json.elements || []).length };
  }

  // ---------- Migration : bâtiments OpenStreetMap remplacés par les bâtiments IGN ----------

  function estIgn(id) { return id.indexOf('bdt/') === 0; }
  function estOsm(id) { return id.indexOf('way/') === 0 || id.indexOf('relation/') === 0; }
  function centreDe(f) {
    var g = f.geometry, r = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
    var s = 0, x = 0, y = 0;
    for (var i = 0; i < r.length - 1; i++) { x += r[i][0]; y += r[i][1]; s++; }
    return [y / s, x / s];   // [lat, lon]
  }
  // Index en grille des contours (cases de ~100 m) pour trouver vite le bâtiment qui contient un point
  var PAS = 0.001;
  function indexIgn(features) {
    var grille = {};
    features.forEach(function (f) {
      var g = f.geometry, rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(function (p) { return p[0]; });
      rings.forEach(function (r) {
        var poly = r.map(function (p) { return [p[1], p[0]]; }), b = boiteDe(poly);
        for (var i = Math.floor(b[0] / PAS); i <= Math.floor(b[2] / PAS); i++) for (var j = Math.floor(b[1] / PAS); j <= Math.floor(b[3] / PAS); j++) {
          (grille[i + ':' + j] = grille[i + ':' + j] || []).push({ id: f.id, poly: poly, b: b });
        }
      });
    });
    return grille;
  }
  function trouverDans(grille, lat, lon) {
    var l = grille[Math.floor(lat / PAS) + ':' + Math.floor(lon / PAS)] || [];
    for (var k = 0; k < l.length; k++) {
      var e = l[k];
      if (lat >= e.b[0] && lat <= e.b[2] && lon >= e.b[1] && lon <= e.b[3] && dansPolygone(lat, lon, e.poly)) return e.id;
    }
    return null;
  }
  // Pour chaque bâtiment OSM dont le centre tombe dans un nouveau bâtiment IGN : { osmId: bdtId }
  function correspondancesOsm(nouveauxIgn) {
    var osm = Object.keys(batiments).filter(estOsm);
    if (!osm.length || !nouveauxIgn.length) return {};
    var index = indexIgn(nouveauxIgn), res = {};
    osm.forEach(function (id) { var c = centreDe(batiments[id]), t = trouverDans(index, c[0], c[1]); if (t) res[id] = t; });
    return res;
  }

  // ---------- Libellés ----------

  function adresse(props) {
    if (props.adr && props.adr.length) return props.adr[0] + (props.adr.length > 1 ? ' (+' + (props.adr.length - 1) + ')' : '');
    var rue = props['addr:street'], num = props['addr:housenumber'];
    if (!rue && !num) return '';
    return [num, rue].filter(Boolean).join(' ');
  }
  function typeBatiment(props) { return TypesBati.parId(props._t || TypesBati.classer(props)).court; }

  return {
    config: config, surfaceKm2: surfaceKm2, boite: boite, boiteDe: boiteDe, simplifier: simplifier, dansPolygone: dansPolygone,
    urlIgn: urlIgn, tenter: tenter, integrerIgn: integrerIgn, lireAdresses: lireAdresses, lierAdresses: lierAdresses,
    urlOsm: urlOsm, corpsOsm: corpsOsm, integrerOsm: integrerOsm,
    correspondancesOsm: correspondancesOsm, estIgn: estIgn, estOsm: estOsm, centreDe: centreDe,
    adresse: adresse, typeBatiment: typeBatiment,
    estCharge: function (bounds) { return dejaCharge(boite(bounds)); },
    ajouterZone: ajouterZone,
    restaurer: function (features, zonesSauvees) {
      (features || []).forEach(function (f) { if (f && f.id && f.properties) { if (!f.properties._t) f.properties._t = TypesBati.classer(f.properties); batiments[f.id] = f; } });
      if (zonesSauvees) zones = zonesSauvees;
    },
    ajouter: function (features) { return integrer(features); },
    retirer: function (ids) { ids.forEach(function (id) { delete batiments[id]; }); },
    zones: function () { return zones; },
    batiment: function (id) { return batiments[id] || null; },
    _batiments: function () { return batiments; }
  };
})();
