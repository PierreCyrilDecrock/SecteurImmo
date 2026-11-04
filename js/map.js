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
  var selection = {};       // id -> true
  var surClic = null;       // fonction(id) appelée au clic sur un bâtiment

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
      if (deja) return;
      deja = true;
      alerter('Le fond « ' + nom + ' » ne se charge pas (réseau ou service indisponible).');
    });
  }

  function init(alerter) {
    map = L.map('map', { zoomControl: true, maxZoom: 19, preferCanvas: true }).setView([46.6, 2.5], 6); // France

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
    surveillerErreurs(ignOrtho, 'Vue aérienne IGN', alerter);

    osm.addTo(map);
    L.control.layers({ 'Plan OpenStreetMap': osm, 'Plan IGN': ignPlan, 'Vue aérienne IGN': ignOrtho },
      null, { position: 'topright', collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);

    groupe = L.layerGroup().addTo(map);
    groupeIcones = L.layerGroup();
    map.on('zoomend', majIcones);

    // Tout changement de statut met à jour l'affichage des bâtiments concernés
    Statuts.surChangement(function (ids) { ids.forEach(appliquer); });
    return map;
  }

  // ---------- Style d'un bâtiment ----------

  function styleDe(id) {
    var st = Statuts.parId(Statuts.statutDe(id));
    if (selection[id]) return { color: '#ffd600', weight: 4, dashArray: null, fillColor: st.couleur, fillOpacity: 0.8, opacity: 1 };
    return {
      color: st.contour, weight: st.id === 'aucun' ? 1 : 2.5, dashArray: st.tirets,
      fillColor: st.couleur, fillOpacity: st.id === 'aucun' ? 0.45 : 0.7, opacity: 1
    };
  }

  function libelle(id, el) {
    var f = el.manuel ? null : DataImmo.batiment(id);
    var type = el.manuel ? 'Point ajouté' : DataImmo.typeBatiment(f.properties);
    var adr = el.manuel ? '' : DataImmo.adresse(f.properties);
    adr = adr || Statuts.adresseDe(id);
    return type + ' – ' + (adr || 'adresse inconnue') + ' – ' + Statuts.parId(Statuts.statutDe(id)).label;
  }

  // Met à jour couleur, infobulle, visibilité (filtre) et icône d'un bâtiment
  function appliquer(id) {
    var el = elements[id];
    if (!el) return;
    var statut = Statuts.statutDe(id);
    var visible = !masques[statut];
    el.couche.setStyle(styleDe(id));
    if (el.couche.setTooltipContent) el.couche.setTooltipContent(libelle(id, el));
    if (visible && !el.visible) { groupe.addLayer(el.couche); }
    if (!visible && el.visible) { groupe.removeLayer(el.couche); }
    el.visible = visible;

    var st = Statuts.parId(statut);
    if (el.icone) { groupeIcones.removeLayer(el.icone); el.icone = null; }
    if (visible && st.icone) {
      el.icone = L.marker(el.centre, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'icone-statut', html: st.icone, iconSize: [22, 22] })
      });
      groupeIcones.addLayer(el.icone);
    }
  }

  function majIcones() {
    if (map.getZoom() >= ZOOM_ICONES) { if (!map.hasLayer(groupeIcones)) map.addLayer(groupeIcones); }
    else if (map.hasLayer(groupeIcones)) map.removeLayer(groupeIcones);
  }

  function enregistrer(id, couche, centre, manuel) {
    elements[id] = { couche: couche, centre: centre, icone: null, manuel: !!manuel, visible: false };
    couche.bindTooltip('', { sticky: true });
    couche.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      if (surClic) surClic(id);
    });
    appliquer(id);
    majIcones();
  }

  // ---------- Ajout de bâtiments ----------

  // Ajoute des bâtiments (Features GeoJSON) sur la carte, sans doublon
  function afficherBatiments(features) {
    features.forEach(function (f) {
      if (elements[f.id]) return;
      var couche = L.geoJSON(f);
      var c = couche.getBounds().getCenter();
      enregistrer(f.id, couche, [c.lat, c.lng], false);
    });
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
    delete elements[id]; delete selection[id];
  }

  // ---------- Interaction ----------

  function definirSurClic(fn) { surClic = fn; }

  // Masque/affiche tous les bâtiments d'un statut (légende)
  function filtrer(statutId, visible) {
    if (visible) delete masques[statutId]; else masques[statutId] = true;
    Object.keys(elements).forEach(function (id) { if (Statuts.statutDe(id) === statutId) appliquer(id); });
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

  // Recentre la carte sur un résultat de recherche et pose un repère
  function aller(resultat) {
    map.setView([resultat.lat, resultat.lon], resultat.zoom || 16);
    if (marqueurRecherche) map.removeLayer(marqueurRecherche);
    marqueurRecherche = L.marker([resultat.lat, resultat.lon], { title: resultat.label }).addTo(map);
  }

  return {
    init: init, aller: aller, getMap: function () { return map; },
    afficherBatiments: afficherBatiments, afficherManuel: afficherManuel, retirer: retirer,
    definirSurClic: definirSurClic, filtrer: filtrer, centre: centre, total: total,
    idsDans: idsDans, surligner: surligner, rafraichir: appliquer
  };
})();
