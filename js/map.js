/*
 * map.js – Carte Leaflet : fonds, bâtiments colorés selon leur statut,
 * points manuels, filtre par statut, surbrillance de la sélection.
 * Expose l'objet global CarteImmo.
 */
var CarteImmo = (function () {
  'use strict';

  var map, marqueurRecherche, groupe, groupeIcones;
  var ZOOM_ICONES = 18;     // les icônes de statut n'apparaissent qu'à fort zoom
  var elements = {};        // id -> { couche, centre: [lat, lon], icone, manuel, visible }
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

    groupe = L.layerGroup().addTo(map);
    groupeIcones = L.layerGroup().addTo(map);
    map.on('moveend', majIcones);

    // Tout changement de statut met à jour l'affichage des bâtiments concernés
    Statuts.surChangement(function (ids) { ids.forEach(appliquer); });
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

  function styleDe(id) {
    var st = Statuts.parId(Statuts.statutDe(id));
    if (selection[id]) return { color: document.documentElement.getAttribute('data-theme') === 'sombre' ? '#f8fafc' : '#0f172a', weight: 4, dashArray: null, fillColor: st.couleur, fillOpacity: 0.85, opacity: 1 };
    if (evidence[id]) return { color: '#db2777', weight: 3.5, dashArray: null, fillColor: st.couleur, fillOpacity: st.id === 'aucun' ? 0.5 : 0.8, opacity: 1 };
    if (st.id === 'aucun') return { color: '#64748b', weight: 1, dashArray: null, fillColor: '#94a3b8', fillOpacity: 0.32, opacity: 0.9 };
    return { color: st.contour, weight: 2, dashArray: st.tirets, fillColor: st.couleur, fillOpacity: 0.82, opacity: 1 };
  }

  // Contenu de l'infobulle, calculé à l'ouverture (texte inséré sans HTML)
  function infobulle(id) {
    var el = elements[id];
    if (!el) return '';
    var f = el.manuel ? null : DataImmo.batiment(id);
    var rec = Statuts.get(id) || {};
    var adr = (f && DataImmo.adresse(f.properties)) || Statuts.adresseDe(id);
    var d = document.createElement('div');
    d.textContent = rec.nom || adr || (el.manuel ? 'Maison ajoutée' : DataImmo.typeBatiment(f.properties));
    var sm = document.createElement('small');
    sm.textContent = Statuts.parId(Statuts.statutDe(id)).label + (rec.nom && adr ? ' · ' + adr : '');
    d.appendChild(sm);
    return d;
  }

  // Met à jour couleur, infobulle, visibilité (filtre) et icône d'un bâtiment
  function appliquer(id) {
    var el = elements[id];
    if (!el) return;
    var statut = Statuts.statutDe(id);
    var visible = !masques[statut] && (!filtreMaison || filtreMaison(id));
    el.couche.setStyle(styleDe(id));
    if (el.couche.isTooltipOpen && el.couche.isTooltipOpen()) el.couche.getTooltip().update();
    if (visible && !el.visible) { groupe.addLayer(el.couche); }
    if (!visible && el.visible) { groupe.removeLayer(el.couche); }
    el.visible = visible;

    // L'icône n'existe que si le statut en a une, qu'on est assez zoomé et que la maison est dans la vue
    // (des milliers d'éléments DOM d'icône rendraient la carte lente).
    el.iconeSt = visible ? Statuts.parId(statut) : null;
    if (el.iconeSt && el.iconeSt.id === 'aucun') el.iconeSt = null;   // pas d'icône pour les maisons non faites
    if (el.icone) { groupeIcones.removeLayer(el.icone); el.icone = null; }
    majIconeEl(el, true);
  }

  var zoneIcones = null;   // zone visible (agrandie) pour laquelle on crée les icônes
  var ICONES_MAX = 350;    // au-delà (quartier très dense), pas d'icônes : la carte resterait lente et illisible
  // anime : petite animation d'apparition (seulement quand le statut vient de changer, pas en déplaçant la carte)
  function majIconeEl(el, anime) {
    var voulue = !!el.iconeSt && zoneIcones && map.getZoom() >= ZOOM_ICONES && zoneIcones.contains(L.latLng(el.centre[0], el.centre[1]));
    if (voulue && !el.icone) {
      el.icone = L.marker(el.centre, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'badge-statut', iconSize: [24, 24], html: '<span class="' + (anime ? 'pop' : '') + '" style="--c:var(--st-' + el.iconeSt.id + ')">' + Ui.htmlIcone(el.iconeSt.icone) + '</span>' })
      });
      groupeIcones.addLayer(el.icone);
    } else if (!voulue && el.icone) {
      groupeIcones.removeLayer(el.icone); el.icone = null;
    }
  }

  // Appelée après chaque déplacement / zoom
  function majIcones() {
    var zone = map.getZoom() >= ZOOM_ICONES ? map.getBounds().pad(0.25) : null;
    if (zone) {
      var n = 0;
      Object.keys(elements).some(function (id) {
        var el = elements[id];
        if (el.iconeSt && zone.contains(L.latLng(el.centre[0], el.centre[1]))) n++;
        return n > ICONES_MAX;
      });
      if (n > ICONES_MAX) zone = null;
    }
    zoneIcones = zone;
    Object.keys(elements).forEach(function (id) { majIconeEl(elements[id]); });
  }

  function enregistrer(id, couche, centre, manuel) {
    elements[id] = { couche: couche, centre: centre, icone: null, manuel: !!manuel, visible: false };
    couche.bindTooltip(function () { return infobulle(id); }, { sticky: true, className: 'info-maison', direction: 'top', offset: [0, -8] });
    couche.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      if (surClic) surClic(id, e.latlng);
    });
    appliquer(id);
    signalerElements();
  }

  function signalerElements() { if (!enLot) ecouteursElements.forEach(function (cb) { cb(); }); }
  function surElements(cb) { ecouteursElements.push(cb); }

  // ---------- Ajout de bâtiments ----------

  // Ajoute des bâtiments (Features GeoJSON) sur la carte, sans doublon
  // (polygone Leaflet direct, plus léger qu'une couche GeoJSON par maison ; un seul signal pour tout le lot)
  var enLot = false;
  function afficherBatiments(features) {
    enLot = true;
    var n = 0;
    try {
      features.forEach(function (f) {
        if (elements[f.id] || !f.geometry) return;
        var g = f.geometry;
        var couche = L.polygon(L.GeoJSON.coordsToLatLngs(g.coordinates, g.type === 'Polygon' ? 1 : 2));
        var c = couche.getBounds().getCenter();
        enregistrer(f.id, couche, [c.lat, c.lng], false);
        n++;
      });
    } finally { enLot = false; }
    if (n) signalerElements();
  }

  function afficherManuel(id, m) {
    if (elements[id]) return;
    enregistrer(id, L.circleMarker([m.lat, m.lon], { radius: 10 }), [m.lat, m.lon], true);
  }

  function retirer(id) {
    var el = elements[id];
    if (!el) return;
    groupe.removeLayer(el.couche);
    if (el.icone) groupeIcones.removeLayer(el.icone);
    delete elements[id]; delete selection[id]; delete evidence[id];
    signalerElements();
  }

  // ---------- Interaction ----------

  function definirSurClic(fn) { surClic = fn; }

  // Masque/affiche tous les bâtiments d'un statut (légende)
  function filtrer(statutId, visible) {
    if (visible) delete masques[statutId]; else masques[statutId] = true;
    Object.keys(elements).forEach(function (id) { if (Statuts.statutDe(id) === statutId) appliquer(id); });
  }

  // Aligne les points manuels affichés sur ceux du modèle (après restauration / import)
  function synchroniserManuels(manuels) {
    Object.keys(elements).forEach(function (id) { if (elements[id].manuel && !manuels[id]) retirer(id); });
    Object.keys(manuels).forEach(function (id) { afficherManuel(id, manuels[id]); });
  }

  // Filtre supplémentaire (null = aucun) ; réapplique l'affichage de toutes les maisons
  function definirFiltre(fn) {
    filtreMaison = fn;
    Object.keys(elements).forEach(appliquer);
  }

  function centre(id) { return elements[id] ? elements[id].centre : null; }
  function total() { return Object.keys(elements).length; }

  // ---------- Sélection (rectangle / lasso) ----------

  function dansPolygone(lat, lon, poly) { // lancer de rayon ; poly = [[lat, lon], …]
    var dedans = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dedans = !dedans;
    }
    return dedans;
  }

  // Ids des bâtiments visibles dont le centre est dans la forme (rectangle LatLngBounds ou polygone [[lat,lon]…])
  function idsDans(forme) {
    return Object.keys(elements).filter(function (id) {
      var el = elements[id];
      if (!el.visible) return false;
      return Array.isArray(forme) ? dansPolygone(el.centre[0], el.centre[1], forme)
                                  : forme.contains(L.latLng(el.centre[0], el.centre[1]));
    });
  }

  function surligner(ids) {
    var avant = Object.keys(selection);
    selection = {};
    ids.forEach(function (id) { selection[id] = true; });
    avant.concat(ids).forEach(appliquer);
  }

  // Met en évidence (contour rouge) des bâtiments, ex. les maisons restant à faire dans un secteur
  function mettreEnEvidence(ids) {
    var avant = Object.keys(evidence);
    evidence = {};
    ids.forEach(function (id) { evidence[id] = true; });
    avant.concat(ids).forEach(appliquer);
  }

  // Centres de tous les bâtiments connus : { id: [lat, lon] }
  function tousCentres() {
    var r = {};
    Object.keys(elements).forEach(function (id) { r[id] = elements[id].centre; });
    return r;
  }

  // Onde colorée à l'endroit d'une maison (retour visuel quand on lui donne un statut)
  function onde(id, statutId) {
    var el = elements[id];
    if (!el || Ui.reduitMouvement()) return;
    var p = map.latLngToContainerPoint(el.centre);
    var o = document.createElement('span');
    o.className = 'onde';
    o.style.left = p.x + 'px'; o.style.top = p.y + 'px';
    o.style.setProperty('--c', 'var(--st-' + (statutId || Statuts.statutDe(id)) + ')');
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
    afficherBatiments: afficherBatiments, afficherManuel: afficherManuel, retirer: retirer,
    definirSurClic: definirSurClic, filtrer: filtrer, centre: centre, total: total,
    definirFiltre: definirFiltre, definirSurPrefs: definirSurPrefs, appliquerPrefs: appliquerPrefs, synchroniserManuels: synchroniserManuels,
    idsDans: idsDans, dansPolygone: dansPolygone, mettreEnEvidence: mettreEnEvidence, tousCentres: tousCentres, surElements: surElements, surligner: surligner, rafraichir: appliquer
  };
})();
