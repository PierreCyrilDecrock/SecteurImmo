/*
 * map.js – Carte Leaflet, fonds de carte, déplacement.
 * Expose l'objet global CarteImmo.
 */
var CarteImmo = (function () {
  'use strict';

  var map, marqueurRecherche, couchesBatiments = {}, groupeBatiments;

  var STYLE_NON_FAIT = { color: '#5f6b76', weight: 1, fillColor: '#9aa5b1', fillOpacity: 0.55 };

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

    var fonds = {
      'Plan OpenStreetMap': osm,
      'Plan IGN': ignPlan,
      'Vue aérienne IGN': ignOrtho
    };
    osm.addTo(map);
    L.control.layers(fonds, null, { position: 'topright', collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    groupeBatiments = L.layerGroup().addTo(map);
    return map;
  }

  // Ajoute des bâtiments (Features GeoJSON) sur la carte, sans doublon
  function afficherBatiments(features) {
    features.forEach(function (f) {
      if (couchesBatiments[f.id]) return;
      var couche = L.geoJSON(f, { style: function () { return STYLE_NON_FAIT; } });
      var adr = DataImmo.adresse(f.properties);
      couche.bindTooltip(DataImmo.typeBatiment(f.properties) + (adr ? ' – ' + adr : ' – adresse inconnue'), { sticky: true });
      couche.addTo(groupeBatiments);
      couchesBatiments[f.id] = couche;
    });
  }

  function getMap() { return map; }

  // Recentre la carte sur un résultat de recherche et pose un repère
  function aller(resultat) {
    map.setView([resultat.lat, resultat.lon], resultat.zoom || 16);
    if (marqueurRecherche) map.removeLayer(marqueurRecherche);
    marqueurRecherche = L.marker([resultat.lat, resultat.lon], { title: resultat.label }).addTo(map);
  }

  return { init: init, aller: aller, afficherBatiments: afficherBatiments, getMap: getMap };
})();
