/*
 * geocode.js – Recherche de villes / adresses.
 *
 * Service principal : géocodage de la Géoplateforme IGN (successeur de l'API
 * Adresse de la BAN), sans clé. Secours : Nominatim (OpenStreetMap).
 * Expose l'objet global Geocode.
 */
var Geocode = (function () {
  'use strict';

  var URL_IGN = 'https://data.geopf.fr/geocodage/search';
  var URL_NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  var URL_IGN_INVERSE = 'https://data.geopf.fr/geocodage/reverse';
  var URL_NOMINATIM_INVERSE = 'https://nominatim.openstreetmap.org/reverse';

  // fetch avec délai maximum, pour ne pas bloquer l'interface
  function fetchJson(url, delaiMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, delaiMs || 8000);
    return fetch(url, { signal: ctrl.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  // Résultat normalisé : { label, detail, lat, lon, zoom }
  function depuisIgn(json) {
    return (json.features || []).map(function (f) {
      var p = f.properties || {};
      var c = f.geometry.coordinates; // [lon, lat]
      var type = p.type; // housenumber | street | locality | municipality
      return {
        label: p.label || p.name || '',
        detail: [p.postcode, p.city].filter(Boolean).join(' '),
        lat: c[1], lon: c[0],
        zoom: type === 'municipality' ? 14 : (type === 'housenumber' ? 19 : 17)
      };
    });
  }

  function depuisNominatim(json) {
    return (json || []).map(function (r) {
      return { label: r.display_name, detail: '', lat: parseFloat(r.lat), lon: parseFloat(r.lon), zoom: 16 };
    });
  }

  // Cherche avec l'IGN ; en cas d'échec réseau/HTTP, bascule sur Nominatim.
  function chercher(texte, limite) {
    limite = limite || 5;
    var q = encodeURIComponent(texte);
    return fetchJson(URL_IGN + '?q=' + q + '&limit=' + limite)
      .then(depuisIgn)
      .catch(function () {
        return fetchJson(URL_NOMINATIM + '?format=jsonv2&countrycodes=fr&limit=' + limite + '&q=' + q)
          .then(depuisNominatim);
      });
  }

  // Géocodage inverse : adresse la plus proche d'un point (à la demande, jamais en masse).
  // Renvoie '' si rien n'est trouvé ; préfixe « ≈ » si le service signale une adresse éloignée.
  function inverse(lat, lon) {
    return fetchJson(URL_IGN_INVERSE + '?lon=' + lon + '&lat=' + lat + '&limit=1')
      .then(function (json) {
        var f = (json.features || [])[0];
        if (!f) return '';
        var p = f.properties || {};
        var approx = typeof p.distance === 'number' && p.distance > 50;
        return (approx ? '≈ ' : '') + (p.label || '');
      })
      .catch(function () {
        return fetchJson(URL_NOMINATIM_INVERSE + '?format=jsonv2&lat=' + lat + '&lon=' + lon)
          .then(function (r) { return (r && r.display_name) || ''; });
      });
  }

  return { chercher: chercher, inverse: inverse };
})();
