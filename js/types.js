/*
 * types.js – Types de bâtiments (maison, immeuble, commerce, annexe…), déduits des données
 * IGN (BD TOPO : usage, nombre de logements, construction légère) ou OpenStreetMap (étiquette building),
 * corrigeables à la main dans la fiche. Nombre de logements d'un bâtiment.
 * Préférence : types « à prospecter » (affichés sur la carte et comptés dans l'avancement).
 * Expose l'objet global TypesBati.
 */
var TypesBati = (function () {
  'use strict';

  var LISTE = [
    { id: 'maison',      label: 'Maison',                        court: 'Maison',     icone: 'house',       defaut: true },
    { id: 'immeuble',    label: 'Immeuble (plusieurs logements)', court: 'Immeuble',   icone: 'building-2',  defaut: true },
    { id: 'mixte',       label: 'Habitation avec commerce',      court: 'Mixte',      icone: 'store',       defaut: true },
    { id: 'commerce',    label: 'Commerce / entreprise',         court: 'Entreprise', icone: 'briefcase',   defaut: false },
    { id: 'activite',    label: 'Industriel / agricole',         court: 'Activité',   icone: 'factory',     defaut: false },
    { id: 'equipement',  label: 'Équipement (école, culte, sport)', court: 'Équipement', icone: 'landmark', defaut: false },
    { id: 'indetermine', label: 'Usage inconnu',                 court: 'Inconnu',    icone: 'circle-help', defaut: false },
    { id: 'annexe',      label: 'Annexe (garage, abri, dépendance)', court: 'Annexe', icone: 'warehouse',   defaut: false }
  ];
  var parId = {};
  LISTE.forEach(function (t) { parId[t.id] = t; });

  var actifs = {};   // types à prospecter
  function defauts() { actifs = {}; LISTE.forEach(function (t) { if (t.defaut) actifs[t.id] = true; }); }
  defauts();
  var ecouteurs = [];

  // ---------- Classement ----------

  var RESIDENTIEL = 'Résidentiel', COMMERCE = 'Commercial et services';
  // BD TOPO : usage_1 / usage_2, nombre de logements, construction légère
  function classerIgn(p) {
    var u = [p.u1 || '', p.u2 || ''], n = p.lgt || 0;
    var resid = u.indexOf(RESIDENTIEL) >= 0, com = u.indexOf(COMMERCE) >= 0;
    if (n >= 2) return 'immeuble';
    if (n === 1 || resid) {
      if (p.leg && !n) return 'annexe';
      return com ? 'mixte' : 'maison';
    }
    if (p.leg) return 'annexe';
    switch (p.u1) {
      case COMMERCE: return 'commerce';
      case 'Industriel': case 'Agricole': return 'activite';
      case 'Religieux': case 'Sportif': return 'equipement';
      case 'Annexe': return 'annexe';
      default: return 'indetermine';
    }
  }

  // OpenStreetMap : étiquette building (et building:flats)
  var OSM = {
    maison: ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'cabin', 'villa', 'static_caravan', 'houseboat'],
    immeuble: ['apartments', 'residential', 'dormitory'],
    commerce: ['commercial', 'retail', 'office', 'supermarket', 'kiosk', 'hotel'],
    activite: ['industrial', 'warehouse', 'farm_auxiliary', 'barn', 'agricultural', 'greenhouse', 'cowshed', 'stable', 'manufacture'],
    equipement: ['school', 'church', 'chapel', 'public', 'civic', 'hospital', 'kindergarten', 'university', 'college', 'sports_hall', 'government', 'townhall', 'religious', 'train_station', 'cathedral', 'mosque', 'temple', 'synagogue', 'sports_centre', 'fire_station'],
    annexe: ['garage', 'garages', 'shed', 'carport', 'hut', 'roof', 'service', 'storage_tank', 'toilets', 'allotment_house', 'container', 'outbuilding', 'gazebo', 'ruins']
  };
  var osmVersType = {};
  Object.keys(OSM).forEach(function (t) { OSM[t].forEach(function (b) { osmVersType[b] = t; }); });
  function classerOsm(p) {
    var t = osmVersType[p.building] || 'indetermine';
    var flats = parseInt(p['building:flats'], 10);
    if (flats >= 2 && (t === 'maison' || t === 'indetermine')) return 'immeuble';
    if (t === 'immeuble' && flats === 1) return 'maison';
    return t;
  }

  function classer(props) { return props && props.src === 'bdtopo' ? classerIgn(props) : classerOsm(props || {}); }

  // ---------- Pour un bâtiment donné ----------

  // Type : correction manuelle (fiche) sinon type déduit des données ; maison ajoutée à la main : maison
  function typeDe(id) {
    var r = Statuts.get(id);
    if (r && r.type && parId[r.type]) return r.type;
    var f = DataImmo.batiment(id);
    if (!f) return 'maison';
    if (!f.properties._t) f.properties._t = classer(f.properties);
    return f.properties._t;
  }
  // Nombre de logements connu par les données (0 si inconnu)
  function logementsDonnees(id) {
    var f = DataImmo.batiment(id);
    if (!f) return 0;
    var p = f.properties;
    return p.lgt || parseInt(p['building:flats'], 10) || 0;
  }
  // Nombre de logements retenu : saisie de la fiche, sinon données, sinon 2 pour un immeuble, 1 sinon
  function logementsDe(id) {
    var r = Statuts.get(id);
    if (r && r.logements > 0) return r.logements;
    var n = logementsDonnees(id);
    if (n > 0) return n;
    return typeDe(id) === 'immeuble' ? 2 : 1;
  }
  function etagesDe(id) { var f = DataImmo.batiment(id); return f && f.properties.etg || 0; }

  // À prospecter : type coché dans les préférences
  function estActif(type) { return !!actifs[type]; }
  function aProspecter(id) { return !!actifs[typeDe(id)]; }

  // ---------- Préférences ----------
  function definirActifs(liste) {
    actifs = {};
    (liste || []).forEach(function (t) { if (parId[t]) actifs[t] = true; });
    ecouteurs.forEach(function (cb) { cb(); });
  }
  function basculer(type, v) {
    if (v) actifs[type] = true; else delete actifs[type];
    ecouteurs.forEach(function (cb) { cb(); });
  }
  function exporter() { return { actifs: Object.keys(actifs) }; }
  function charger(d) {
    if (d && Array.isArray(d.actifs)) { actifs = {}; d.actifs.forEach(function (t) { if (parId[t]) actifs[t] = true; }); }
    else defauts();
  }

  return {
    LISTE: LISTE, parId: function (id) { return parId[id] || parId.indetermine; }, classer: classer,
    typeDe: typeDe, logementsDe: logementsDe, logementsDonnees: logementsDonnees, etagesDe: etagesDe,
    estActif: estActif, aProspecter: aProspecter, actifs: function () { return Object.keys(actifs); },
    definirActifs: definirActifs, basculer: basculer, surChangement: function (cb) { ecouteurs.push(cb); },
    exporter: exporter, charger: charger
  };
})();
