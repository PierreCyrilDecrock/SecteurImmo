/*
 * map.js – Carte Leaflet : fonds, bâtiments colorés selon leur statut et leur type,
 * points manuels, filtres, surbrillance de la sélection.
 * À l'échelle d'une ville (des dizaines de milliers de bâtiments), seuls les bâtiments de la zone
 * visible sont dessinés (index en grille) ; vue éloignée : carte d'avancement par carreaux.
 * Expose l'objet global CarteImmo.
 */
var CarteImmo = (function () {
  'use strict';

  var map, marqueurRecherche, groupe, groupeIcones, groupeApercu;
  var ZOOM_ICONES = 18;     // les icônes de statut n'apparaissent qu'à fort zoom
  var ZOOM_LOGEMENTS = 17;  // pastille « logements faits / logements » des immeubles
  var ZOOM_POLYGONES = 15;  // en dessous : carte d'avancement par carreaux
  var DESSINES_MAX = 6000;  // au-delà dans la vue : carte d'avancement (la carte resterait lente)
  var elements = {};        // id -> { centre: [lat, lon], b: [s, o, n, e], f (Feature) | manuel, couche (si dessiné), icone }
  var dessines = {};        // id -> true : bâtiments ayant un polygone Leaflet (zone visible)
  var grille = {};          // index : case -> [ids]
  var PAS = 0.004;          // taille d'une case de l'index (~400 m)
  var modeApercu = false;
  var masques = {};         // statutId -> true si masqué par la légende
  var filtreMaison = null;  // fonction(id) -> vrai si la maison reste affichée (filtre de la légende : étiquette, potentiel…)
  var selection = {};       // id -> true
  var evidence = {};        // id -> true : maisons à faire mises en évidence (secteurs)
  var ecouteursElements = []; // appelés quand des bâtiments sont ajoutés / retirés
  var surClic = null;       // fonction(id) appelée au clic sur un bâtiment
  var fonds = {}, fondActif = 'epure', surPrefs = null, ecouteursFond = [];
  // Fonds proposés : « épuré » = plan OSM désaturé (les statuts ressortent), plan OSM, plan IGN, photo aérienne IGN
  var FONDS = [
    { id: 'epure', nom: 'Épuré', couche: 'osm' }, { id: 'plan', nom: 'Plan', couche: 'osm' },
    { id: 'ign', nom: 'Plan IGN', couche: 'ign' }, { id: 'photo', nom: 'Satellite', couche: 'photo' }
  ];
  var ANCIENS_NOMS = { 'Plan OpenStreetMap': 'plan', 'Plan IGN': 'ign', 'Vue aérienne IGN': 'photo' }; // préférences d'avant la refonte

  // ---------- Fonds de carte ----------

  // Tuiles de la Géoplateforme IGN (WMTS, projection Web Mercator "PM")
  function urlIgn(couche, format) {
    return 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
      '&LAYER=' + couche + '&STYLE=normal&FORMAT=' + format +
      '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
  }

  // Message d'erreur affiché au plus une fois par fond de carte
  function surveillerErreurs(couche, nom, alerter) {
    var deja = false;
    couche.on('tileerror', function () {
      if (deja || !navigator.onLine) return;   // hors ligne : message dédié (pwa.js)
      deja = true;
      alerter('Le fond « ' + nom + ' » ne se charge pas (réseau ou service indisponible).');
    });
  }

  function init(alerter) {
    map = L.map('map', {
      zoomControl: false, maxZoom: 19, zoomSnap: 0.5,
      // Rendu Canvas (rapide avec des milliers de bâtiments) ; zone de clic élargie au doigt
      renderer: L.canvas({ tolerance: L.Browser.touch ? 10 : 3 })
    }).setView([46.6, 2.5], 6); // France
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" title="Bibliothèque de cartes">Leaflet</a>');

    var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>'
    });
    var ignPlan = L.tileLayer(urlIgn('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), {
      maxZoom: 19, attribution: '© <a href="https://geoservices.ign.fr/">IGN</a>'
    });
    var ignOrtho = L.tileLayer(urlIgn('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), {
      maxZoom: 19, attribution: '© <a href="https://geoservices.ign.fr/">IGN</a> – Orthophotographies'
    });
    surveillerErreurs(osm, 'OpenStreetMap', alerter);
    surveillerErreurs(ignPlan, 'Plan IGN', alerter);
    surveillerErreurs(ignOrtho, 'Satellite IGN', alerter);

    fonds = { osm: osm, ign: ignPlan, photo: ignOrtho };
    osm.addTo(map);
    map.on('moveend', prefsChangees);

    groupeApercu = L.layerGroup().addTo(map);
    groupe = L.layerGroup().addTo(map);
    groupeIcones = L.layerGroup().addTo(map);
    map.on('moveend', majVue);

    // Tout changement de statut met à jour l'affichage des bâtiments concernés (un logement : son immeuble)
    Statuts.surChangement(function (ids) {
      var vus = {};
      ids.forEach(function (id) { var p = Statuts.parent(id); if (!vus[p]) { vus[p] = 1; appliquer(p); } });
      planifierApercu();
    });
    TypesBati.surChangement(function () { majVue(true); signalerElements(); });
    return map;
  }

  // ---------- Préférences de vue (restaurées au rechargement) ----------
  function prefsChangees() {
    if (!surPrefs) return;
    var c = map.getCenter();
    surPrefs({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), fond: fondActif });
  }
  function definirSurPrefs(fn) { surPrefs = fn; }
  function infoFond(id) { return FONDS.filter(function (f) { return f.id === id; })[0]; }
  function setFond(id) {
    id = ANCIENS_NOMS[id] || id;
    var nouveau = infoFond(id), ancien = infoFond(fondActif);
    if (!nouveau) return;
    if (ancien.couche !== nouveau.couche) { map.removeLayer(fonds[ancien.couche]); fonds[nouveau.couche].addTo(map); }
    fondActif = id;
    var c = map.getContainer();
    c.classList.toggle('fond-epure', id === 'epure');
    c.classList.toggle('fond-photo', id === 'photo');
    ecouteursFond.forEach(function (cb) { cb(id); });
    prefsChangees();
  }
  function appliquerPrefs(p) {
    if (!p) return;
    if (p.fond) setFond(p.fond);
    if (typeof p.lat === 'number' && typeof p.lon === 'number' && p.zoom) map.setView([p.lat, p.lon], p.zoom, { animate: false });
  }

  // ---------- Style d'un bâtiment ----------

  // Non fait : gris, plus soutenu pour un immeuble, pointillé pour ce qui n'est pas de l'habitation
  var HABITAT = { maison: 1, immeuble: 1, mixte: 1 };
  function styleDe(id) {
    var st = Statuts.parId(Statuts.statutAffiche(id)), el = elements[id];
    var type = el && !el.manuel ? TypesBati.typeDe(id) : 'maison';
    if (selection[id]) return { color: document.documentElement.getAttribute('data-theme') === 'sombre' ? '#f8fafc' : '#0f172a', weight: 4, dashArray: null, fillColor: st.couleur, fillOpacity: 0.85, opacity: 1 };
    if (evidence[id]) return { color: '#db2777', weight: 3.5, dashArray: null, fillColor: st.couleur, fillOpacity: st.id === 'aucun' ? 0.5 : 0.8, opacity: 1 };
    if (st.id === 'aucun') {
      if (type === 'immeuble' || type === 'mixte') return { color: '#475569', weight: 1.6, dashArray: null, fillColor: '#64748b', fillOpacity: 0.42, opacity: 0.95 };
      if (!HABITAT[type]) return { color: '#64748b', weight: 1.2, dashArray: '3 3', fillColor: '#cbd5e1', fillOpacity: 0.28, opacity: 0.9 };
      return { color: '#64748b', weight: 1, dashArray: null, fillColor: '#94a3b8', fillOpacity: 0.32, opacity: 0.9 };
    }
    return { color: st.contour, weight: 2, dashArray: st.tirets, fillColor: st.couleur, fillOpacity: 0.82, opacity: 1 };
  }

  // Contenu de l'infobulle, calculé à l'ouverture (texte inséré sans HTML)
  function infobulle(id) {
    var el = elements[id];
    if (!el) return '';
    var rec = Statuts.get(id) || {};
    var adr = (el.f && DataImmo.adresse(el.f.properties)) || Statuts.adresseDe(id);
    var type = el.manuel ? 'Ajoutée à la main' : TypesBati.parId(TypesBati.typeDe(id)).court;
    var d = document.createElement('div');
    d.textContent = rec.nom || adr || type;
    var sm = document.createElement('small'), av = Statuts.avancement(id);
    var details = [Statuts.parId(Statuts.statutAffiche(id)).label];
    if (av.total > 1) details.push(av.faits + '/' + av.total + ' logements');
    if (rec.nom && adr) details.push(adr);
    if (!el.manuel && (rec.nom || adr)) details.push(type);
    sm.textContent = details.join(' · ');
    d.appendChild(sm);
    return d;
  }

  // ---------- Visibilité ----------

  // Affiché : type à prospecter, ou bâtiment qui a déjà une fiche (statut, note, logements…)
  function affichable(id) {
    var el = elements[id];
    if (!el) return false;
    return el.manuel || TypesBati.aProspecter(id) || Statuts.aUneFiche(id);
  }
  function visibleLogique(id) {
    return affichable(id) && !masques[Statuts.statutAffiche(id)] && (!filtreMaison || filtreMaison(id));
  }

  // ---------- Index en grille ----------
  function cle(lat, lon) { return Math.floor(lat / PAS) + ':' + Math.floor(lon / PAS); }
  function indexer(id) { var c = elements[id].centre, k = cle(c[0], c[1]); elements[id].k = k; (grille[k] = grille[k] || []).push(id); }
  function desindexer(id) { var k = elements[id].k, l = grille[k]; if (l) { var i = l.indexOf(id); if (i >= 0) l.splice(i, 1); } }
  // Ids dont l'emprise touche la boîte LatLngBounds
  function idsDansBoite(bounds) {
    var s = bounds.getSouth(), o = bounds.getWest(), n = bounds.getNorth(), e = bounds.getEast(), res = [];
    var marge = 0.002;   // un grand bâtiment dont le centre est juste hors de la boîte
    for (var i = Math.floor((s - marge) / PAS); i <= Math.floor((n + marge) / PAS); i++) {
      for (var j = Math.floor((o - marge) / PAS); j <= Math.floor((e + marge) / PAS); j++) {
        var l = grille[i + ':' + j]; if (!l) continue;
        for (var k = 0; k < l.length; k++) {
          var b = elements[l[k]].b;
          if (b[2] >= s && b[0] <= n && b[3] >= o && b[1] <= e) res.push(l[k]);
        }
      }
    }
    return res;
  }

  // ---------- Dessin ----------

  function creerCouche(id) {
    var el = elements[id];
    if (el.couche) return;
    if (el.manuel) el.couche = L.circleMarker(el.centre, { radius: 10 });
    else { var g = el.f.geometry; el.couche = L.polygon(L.GeoJSON.coordsToLatLngs(g.coordinates, g.type === 'Polygon' ? 1 : 2)); }
    el.couche.setStyle(styleDe(id));
    el.couche.bindTooltip(function () { return infobulle(id); }, { sticky: true, className: 'info-maison', direction: 'top', offset: [0, -8] });
    el.couche.on('click', function (e) { L.DomEvent.stopPropagation(e); if (surClic) surClic(id, e.latlng); });
    groupe.addLayer(el.couche);
    dessines[id] = true;
  }
  function detruireCouche(id) {
    var el = elements[id];
    if (!el) { delete dessines[id]; return; }
    if (el.couche) { groupe.removeLayer(el.couche); el.couche = null; }
    if (el.icone) { groupeIcones.removeLayer(el.icone); el.icone = null; }
    delete dessines[id];
  }

  /*
   * Après un déplacement, un zoom ou un changement de filtre : dessine les bâtiments de la zone visible
   * (avec une marge) et efface les autres ; vue éloignée ou trop dense : carte d'avancement.
   */
  function majVue(forcerStyle) {
    if (!map) return;
    var ids = null;
    if (map.getZoom() >= ZOOM_POLYGONES) {
      ids = idsDansBoite(map.getBounds().pad(0.25)).filter(visibleLogique);
      if (ids.length > DESSINES_MAX) ids = null;
    }
    basculerApercu(!ids && Object.keys(elements).length > 0);
    var voulu = {};
    (ids || []).forEach(function (id) { voulu[id] = true; });
    Object.keys(dessines).forEach(function (id) { if (!voulu[id]) detruireCouche(id); });
    (ids || []).forEach(function (id) {
      if (!dessines[id]) creerCouche(id);
      else if (forcerStyle === true) elements[id].couche.setStyle(styleDe(id));
    });
    majIcones();
  }
  var timerVue = null;
  function planifierVue() { clearTimeout(timerVue); timerVue = setTimeout(majVue, 40); }

  // Met à jour couleur, infobulle, visibilité et icône d'un bâtiment
  function appliquer(id) {
    var el = elements[id];
    if (!el) return;
    if (!visibleLogique(id)) { if (el.couche) detruireCouche(id); return; }
    if (!el.couche) {
      if (!modeApercu && map.getZoom() >= ZOOM_POLYGONES && map.getBounds().pad(0.25).contains(el.centre)) creerCouche(id);
      else return;
    } else el.couche.setStyle(styleDe(id));
    if (el.couche.isTooltipOpen && el.couche.isTooltipOpen()) el.couche.getTooltip().update();
    if (el.icone) { groupeIcones.removeLayer(el.icone); el.icone = null; }
    majIconeEl(id, true);
  }

  // ---------- Icônes : statut (maison) ou logements faits (immeuble), à fort zoom seulement ----------

  var zoneIcones = null;   // zone visible (agrandie) pour laquelle on crée les icônes
  var ICONES_MAX = 350;    // au-delà (quartier très dense), pas d'icônes : la carte resterait lente et illisible
  function contenuIcone(id) {
    var av = Statuts.avancement(id), z = map.getZoom();
    if (av.total > 1 && z >= ZOOM_LOGEMENTS) {
      var st = Statuts.statutAffiche(id);
      return { cls: 'badge-logements' + (av.faits >= av.total ? ' complet' : ''), taille: [52, 22], html: '<span style="--c:var(--st-' + st + ')">' + Ui.htmlIcone('building-2') + av.faits + '/' + av.total + '</span>' };
    }
    var s = Statuts.statutAffiche(id);
    if (s === 'aucun' || z < ZOOM_ICONES) return null;
    return { cls: 'badge-statut', taille: [24, 24], html: '<span style="--c:var(--st-' + s + ')">' + Ui.htmlIcone(Statuts.parId(s).icone) + '</span>' };
  }
  // anime : petite animation d'apparition (seulement quand le statut vient de changer, pas en déplaçant la carte)
  function majIconeEl(id, anime) {
    var el = elements[id];
    var c = el.couche && zoneIcones && zoneIcones.contains(L.latLng(el.centre[0], el.centre[1])) ? contenuIcone(id) : null;
    var sig = c ? c.cls + c.html : null;
    if (el.icone && el.sigIcone === sig) return;
    if (el.icone) { groupeIcones.removeLayer(el.icone); el.icone = null; }
    if (!c) return;
    el.sigIcone = sig;
    el.icone = L.marker(el.centre, { interactive: false, keyboard: false,
      icon: L.divIcon({ className: c.cls, iconSize: c.taille, html: anime ? c.html.replace('<span ', '<span class="pop" ') : c.html }) });
    groupeIcones.addLayer(el.icone);
  }
  function majIcones() {
    var zone = map.getZoom() >= ZOOM_LOGEMENTS ? map.getBounds().pad(0.25) : null;
    if (zone) {
      var n = 0;
      // Ne comptent que les bâtiments qui auraient une icône (immeuble, ou statut posé à fort zoom)
      var fort = map.getZoom() >= ZOOM_ICONES;
      Object.keys(dessines).some(function (id) {
        if (zone.contains(elements[id].centre) && (Statuts.avancement(id).total > 1 || (fort && Statuts.statutAffiche(id) !== 'aucun'))) n++;
        return n > ICONES_MAX;
      });
      if (n > ICONES_MAX) zone = null;
    }
    zoneIcones = zone;
    Object.keys(dessines).forEach(function (id) { majIconeEl(id); });
  }

  // ---------- Carte d'avancement (vue éloignée) : carreaux de ~250 m colorés selon les logements faits ----------

  var PAS_APERCU = 0.0025, timerApercu = null;
  function basculerApercu(v) {
    if (v === modeApercu) return;
    modeApercu = v;
    if (v) dessinerApercu(); else groupeApercu.clearLayers();
  }
  function planifierApercu() { if (!modeApercu) return; clearTimeout(timerApercu); timerApercu = setTimeout(dessinerApercu, 400); }
  function dessinerApercu() {
    groupeApercu.clearLayers();
    if (!modeApercu) return;
    var cases = {};
    Object.keys(elements).forEach(function (id) {
      if (!affichable(id)) return;
      var c = elements[id].centre, k = Math.floor(c[0] / PAS_APERCU) + ':' + Math.floor(c[1] / PAS_APERCU);
      var a = Statuts.avancement(id), x = cases[k] || (cases[k] = { t: 0, f: 0 });
      x.t += a.total; x.f += a.faits;
    });
    Object.keys(cases).forEach(function (k) {
      var x = cases[k], p = k.split(':'), i = +p[0], j = +p[1], pct = x.t ? x.f / x.t : 0;
      L.rectangle([[i * PAS_APERCU, j * PAS_APERCU], [(i + 1) * PAS_APERCU, (j + 1) * PAS_APERCU]], {
        interactive: false, stroke: true, weight: 0.5, color: '#ffffff', opacity: 0.6,
        fillColor: pct > 0 ? '#1baf7a' : '#94a3b8', fillOpacity: pct > 0 ? 0.2 + 0.6 * pct : 0.28
      }).addTo(groupeApercu);
    });
  }

  // ---------- Ajout et retrait de bâtiments ----------

  function signalerElements() { if (!enLot) ecouteursElements.forEach(function (cb) { cb(); }); }
  function surElements(cb) { ecouteursElements.push(cb); }
  var timerSignal = null;
  function signalerPlusTard() { clearTimeout(timerSignal); timerSignal = setTimeout(signalerElements, 120); }

  // Emprise et centre d'une Feature, sans passer par Leaflet (rapide pour des milliers de bâtiments)
  function emprise(g) {
    var rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(function (p) { return p[0]; });
    var b = [90, 180, -90, -180], sx = 0, sy = 0, n = 0;
    rings.forEach(function (r) {
      for (var i = 0; i < r.length; i++) {
        var lon = r[i][0], lat = r[i][1];
        if (lat < b[0]) b[0] = lat; if (lat > b[2]) b[2] = lat; if (lon < b[1]) b[1] = lon; if (lon > b[3]) b[3] = lon;
        if (i < r.length - 1) { sx += lon; sy += lat; n++; }
      }
    });
    return { b: b, centre: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] };
  }

  // Ajoute des bâtiments (Features GeoJSON), sans doublon ; un seul signal pour tout le lot
  var enLot = false;
  function afficherBatiments(features) {
    var n = 0;
    (features || []).forEach(function (f) {
      if (!f || elements[f.id] || !f.geometry) return;
      var e = emprise(f.geometry);
      elements[f.id] = { f: f, centre: e.centre, b: e.b, couche: null, icone: null, manuel: false };
      indexer(f.id);
      n++;
    });
    if (n) { planifierVue(); planifierApercu(); signalerPlusTard(); }
  }

  function afficherManuel(id, m) {
    if (elements[id]) return;
    elements[id] = { centre: [m.lat, m.lon], b: [m.lat, m.lon, m.lat, m.lon], couche: null, icone: null, manuel: true };
    indexer(id);
    appliquer(id);
    signalerPlusTard();
  }

  function retirer(id) {
    var el = elements[id];
    if (!el) return;
    detruireCouche(id);
    desindexer(id);
    delete elements[id]; delete selection[id]; delete evidence[id];
    planifierApercu();
    signalerPlusTard();
  }

  // Des bâtiments ont changé (adresse reçue…) : infobulles et vues dépendantes
  function signalerModifies(ids) {
    ids.forEach(function (id) { var el = elements[id]; if (el) { el.f = DataImmo.batiment(id) || el.f; if (el.couche && el.couche.isTooltipOpen()) el.couche.getTooltip().update(); } });
    signalerPlusTard();
  }

  // ---------- Interaction ----------

  function definirSurClic(fn) { surClic = fn; }

  // Masque/affiche tous les bâtiments d'un statut (légende)
  function filtrer(statutId, visible) {
    if (visible) delete masques[statutId]; else masques[statutId] = true;
    majVue();
  }

  // Aligne les points manuels affichés sur ceux du modèle (après restauration / import)
  function synchroniserManuels(manuels) {
    Object.keys(elements).forEach(function (id) { if (elements[id].manuel && !manuels[id]) retirer(id); });
    Object.keys(manuels).forEach(function (id) { afficherManuel(id, manuels[id]); });
  }

  // Filtre supplémentaire (null = aucun) ; réapplique l'affichage de toutes les maisons
  function definirFiltre(fn) { filtreMaison = fn; majVue(true); }

  function centre(id) { var el = elements[id] || elements[Statuts.parent(id)]; return el ? el.centre : null; }
  // Nombre de bâtiments affichés (types à prospecter, ou ayant une fiche)
  function total() { var n = 0; Object.keys(elements).forEach(function (id) { if (affichable(id)) n++; }); return n; }
  function ids(tous) { return Object.keys(elements).filter(function (id) { return tous || affichable(id); }); }

  // ---------- Sélection (rectangle / lasso) ----------

  var dansPolygone = DataImmo.dansPolygone;

  // Ids des bâtiments affichés dont le centre est dans la forme (rectangle LatLngBounds ou polygone [[lat,lon]…])
  function idsDans(forme) {
    var boite = Array.isArray(forme) ? L.latLngBounds(forme) : forme;
    return idsDansBoite(boite).filter(function (id) {
      if (!visibleLogique(id)) return false;
      var c = elements[id].centre;
      return Array.isArray(forme) ? dansPolygone(c[0], c[1], forme) : forme.contains(L.latLng(c[0], c[1]));
    });
  }

  function parents(ids) { var r = {}; ids.forEach(function (id) { r[Statuts.parent(id)] = true; }); return Object.keys(r); }
  function surligner(ids) {
    var avant = Object.keys(selection);
    selection = {};
    parents(ids).forEach(function (id) { selection[id] = true; });
    avant.concat(Object.keys(selection)).forEach(appliquer);
  }

  // Met en évidence (contour rose) des bâtiments, ex. les maisons restant à faire dans un secteur
  function mettreEnEvidence(ids) {
    var avant = Object.keys(evidence);
    evidence = {};
    parents(ids).forEach(function (id) { evidence[id] = true; });
    avant.concat(Object.keys(evidence)).forEach(appliquer);
  }

  // Centres des bâtiments : { id: [lat, lon] } (affichés seulement, ou tous)
  function tousCentres(tous) {
    var r = {};
    Object.keys(elements).forEach(function (id) { if (tous || affichable(id)) r[id] = elements[id].centre; });
    return r;
  }

  // Onde colorée à l'endroit d'une maison (retour visuel quand on lui donne un statut)
  function onde(id, statutId) {
    var c = centre(id);
    if (!c || Ui.reduitMouvement()) return;
    var p = map.latLngToContainerPoint(c);
    var o = document.createElement('span');
    o.className = 'onde';
    o.style.left = p.x + 'px'; o.style.top = p.y + 'px';
    o.style.setProperty('--c', 'var(--st-' + (statutId || Statuts.statutAffiche(Statuts.parent(id))) + ')');
    map.getContainer().appendChild(o);
    setTimeout(function () { o.remove(); }, 700);
  }

  // Recentre la carte sur un résultat de recherche et pose un repère
  function aller(resultat) {
    var z = resultat.zoom || 16;
    if (Ui.reduitMouvement()) map.setView([resultat.lat, resultat.lon], z); else map.flyTo([resultat.lat, resultat.lon], z, { duration: 1.1 });
    if (marqueurRecherche) map.removeLayer(marqueurRecherche);
    marqueurRecherche = L.marker([resultat.lat, resultat.lon], {
      title: resultat.label, keyboard: false, interactive: false,
      icon: L.divIcon({ className: 'repere-recherche', iconSize: [36, 44], iconAnchor: [18, 42], html: '<span>' + Ui.htmlIcone('map-pin') + '</span>' })
    }).addTo(map);
  }

  return {
    init: init, aller: aller, getMap: function () { return map; }, onde: onde,
    fonds: function () { return FONDS; }, fond: function () { return fondActif; }, setFond: setFond, surFond: function (cb) { ecouteursFond.push(cb); },
    afficherBatiments: afficherBatiments, afficherManuel: afficherManuel, retirer: retirer, signalerModifies: signalerModifies,
    definirSurClic: definirSurClic, filtrer: filtrer, centre: centre, total: total, ids: ids, affichable: affichable,
    definirFiltre: definirFiltre, definirSurPrefs: definirSurPrefs, appliquerPrefs: appliquerPrefs, synchroniserManuels: synchroniserManuels,
    idsDans: idsDans, dansPolygone: dansPolygone, mettreEnEvidence: mettreEnEvidence, tousCentres: tousCentres, surElements: surElements, surligner: surligner,
    rafraichir: function (id) { appliquer(Statuts.parent(id)); }, majVue: majVue, nbDessines: function () { return Object.keys(dessines).length; }, modeApercu: function () { return modeApercu; }
  };
})();
