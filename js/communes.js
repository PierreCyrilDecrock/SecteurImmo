/*
 * communes.js – Communes téléchargées en entier : recherche (API géographique de l'État,
 * geo.api.gouv.fr), contour officiel, lancement du téléchargement de tous les bâtiments et adresses,
 * contour affiché sur la carte, secteur créé à partir de la commune, retrait.
 * Expose l'objet global Communes.
 */
var Communes = (function () {
  'use strict';

  var API = 'https://geo.api.gouv.fr/communes';
  var liste = [];        // { code, nom, cp, population, departement, contour: [[lat, lon]…], b, ajoute }
  var map, groupe, ecouteurs = [];

  function signaler() { ecouteurs.forEach(function (cb) { cb(); }); }
  function sauver() { Store.kvSet('communes', liste); }
  function parCode(code) { return liste.filter(function (c) { return c.code === code; })[0] || null; }

  function lireJson(url) {
    var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, 15000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) {
      if (!r.ok) throw new Error('Service des communes indisponible (HTTP ' + r.status + ')');
      return r.json();
    }, function () { throw new Error('Service des communes injoignable : vérifiez votre connexion.'); }).finally(function () { clearTimeout(t); });
  }

  // Recherche par nom ou code postal : [{ code, nom, cp, population, departement }]
  function rechercher(texte) {
    var q = (texte || '').trim();
    if (q.length < 2) return Promise.resolve([]);
    var champs = '&fields=nom,code,codesPostaux,population,departement&limit=6';
    var url = /^\d{5}$/.test(q) ? API + '?codePostal=' + q + champs : API + '?nom=' + encodeURIComponent(q) + '&boost=population' + champs;
    return lireJson(url).then(function (rs) {
      return (Array.isArray(rs) ? rs : []).map(function (c) {
        return { code: c.code, nom: c.nom, cp: (c.codesPostaux || [])[0] || '', population: c.population || 0, departement: c.departement ? c.departement.nom : '' };
      });
    });
  }

  // Plus grand contour extérieur (une commune est presque toujours d'un seul tenant) en [[lat, lon]…]
  function contourDe(g) {
    if (!g) return null;
    var polys = g.type === 'MultiPolygon' ? g.coordinates : (g.type === 'Polygon' ? [g.coordinates] : []);
    var meilleur = null;
    polys.forEach(function (p) { if (!meilleur || p[0].length > meilleur.length) meilleur = p[0]; });
    return meilleur ? meilleur.map(function (x) { return [x[1], x[0]]; }) : null;
  }

  /*
   * Ajoute la commune (contour officiel) et lance le téléchargement de ses bâtiments.
   * Résout dès que la commune est ajoutée et la tâche créée : { commune, tache: Promise }.
   */
  function telecharger(c) {
    return lireJson(API + '/' + encodeURIComponent(c.code) + '?fields=nom,code,codesPostaux,population,departement,contour&format=json&geometry=contour').then(function (d) {
      var contour = contourDe(d.contour);
      if (!contour || contour.length < 4) throw new Error('Contour de la commune introuvable.');
      var entree = parCode(d.code) || { code: d.code };
      entree.nom = d.nom; entree.cp = (d.codesPostaux || [])[0] || c.cp || ''; entree.population = d.population || 0;
      entree.departement = d.departement ? d.departement.nom : (c.departement || '');
      entree.contour = DataImmo.simplifier(contour, 500).map(function (p) { return [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]; });
      entree.b = DataImmo.boiteDe(entree.contour);
      entree.ajoute = entree.ajoute || Date.now();
      if (liste.indexOf(entree) < 0) liste.push(entree);
      sauver(); dessiner(); signaler();
      var tache = Telechargements.contour('commune', entree.nom, entree.code, entree.contour, entree.code);
      tache.then(function () { entree.maj = Date.now(); sauver(); signaler(); }, function () { signaler(); });
      return { commune: entree, tache: tache };
    });
  }

  // Bâtiments connus dont le centre est dans la commune
  function membres(code) {
    var c = parCode(code); if (!c) return [];
    var centres = CarteImmo.tousCentres(true), b = c.b;
    return Object.keys(centres).filter(function (id) {
      var p = centres[id];
      return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && DataImmo.dansPolygone(p[0], p[1], c.contour);
    });
  }
  // { total, aProspecter } dans la commune
  function compter(code) {
    var ids = membres(code), n = 0;
    ids.forEach(function (id) { if (TypesBati.aProspecter(id)) n++; });
    return { total: ids.length, aProspecter: n };
  }

  function voir(code) {
    var c = parCode(code); if (!c || !map) return;
    map.fitBounds([[c.b[0], c.b[1]], [c.b[2], c.b[3]]], { padding: [30, 30] });
  }

  // Crée un secteur qui suit le contour de la commune
  function creerSecteur(code) {
    var c = parCode(code); if (!c) return null;
    return Secteurs.creer(DataImmo.simplifier(c.contour, 250), c.nom);
  }

  /*
   * Retire la commune ; si `oublier`, retire aussi de l'appareil ses bâtiments sans aucune information
   * (ceux qui ont un statut, une note, un contact… sont toujours gardés). Renvoie le nombre retiré.
   */
  function retirer(code, oublier) {
    var c = parCode(code); if (!c) return 0;
    var n = 0;
    if (oublier) {
      var ids = membres(code).filter(function (id) { return !Statuts.get(id) && !Statuts.aDesLogements(id); });
      ids.forEach(function (id) { CarteImmo.retirer(id); });
      DataImmo.retirer(ids); Store.supprimerBatiments(ids);
      n = ids.length;
      // La zone n'est plus « déjà chargée »
      var z = DataImmo.zones().filter(function (x) { return !(x.poly && x.b[0] === c.b[0] && x.b[3] === c.b[3]); });
      DataImmo.zones().length = 0; z.forEach(function (x) { DataImmo.zones().push(x); });
      Store.enregistrerZones(DataImmo.zones());
    }
    var t = Telechargements.parRef('commune', code);
    if (t && t.etat !== 'fini') Telechargements.annuler(t.id);
    liste = liste.filter(function (x) { return x !== c; });
    sauver(); dessiner(); signaler();
    return n;
  }

  // ---------- Carte : contours des communes ----------

  function dessiner() {
    if (!groupe) return;
    groupe.clearLayers();
    liste.forEach(function (c) {
      L.polygon(c.contour, { color: '#475569', weight: 2, dashArray: '2 6', fill: false, interactive: false, opacity: 0.75, className: 'contour-commune' }).addTo(groupe);
    });
  }

  function charger(d) {
    liste = (Array.isArray(d) ? d : []).filter(function (c) { return c && c.code && Array.isArray(c.contour) && c.contour.length >= 4; });
    liste.forEach(function (c) { if (!c.b) c.b = DataImmo.boiteDe(c.contour); });
    dessiner(); signaler();
  }

  function init(carte) {
    map = carte;
    groupe = L.layerGroup().addTo(map);
  }

  return {
    init: init, charger: charger, liste: function () { return liste; }, parCode: parCode, rechercher: rechercher, telecharger: telecharger,
    membres: membres, compter: compter, voir: voir, creerSecteur: creerSecteur, retirer: retirer,
    exporter: function () { return liste.map(function (c) { return Object.assign({}, c); }); },
    surChangement: function (cb) { ecouteurs.push(cb); }
  };
})();
