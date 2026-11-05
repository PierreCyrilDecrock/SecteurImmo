/*
 * secteurs.js – Secteurs de prospection : polygones dessinés et nommés, statistiques de
 * couverture, mise en évidence des maisons restant à faire, chargement des bâtiments
 * d'un secteur (par morceaux, pour respecter les limites d'Overpass).
 * Expose l'objet global Secteurs.
 */
var Secteurs = (function () {
  'use strict';

  var PALETTE = ['#d81b60', '#00897b', '#5e35b1', '#f4511e', '#039be5', '#7cb342', '#8d6e63', '#546e7a'];
  var TAILLE_CELLULE_KM = 1.2;   // un secteur est chargé par cases de ~1,2 km de côté
  var CELLULES_MAX = 12;         // au-delà, le secteur est refusé (trop grand pour Overpass)
  var PAUSE_ENTRE_CELLULES_MS = 1000;

  var map, alerter = function () {};
  var liste = [];                 // { id, nom, points: [[lat, lon], …], couleur }
  var options = { colorer: false };
  var couches = {};               // id -> { poly, etiquette }
  var membres = {};               // id -> [ids des bâtiments dans le secteur]
  var groupe;
  var ecouteurs = [], ecouteursStructure = [];
  var dessin = null;              // { points, couche } pendant le tracé
  var trouActif = null;           // id du secteur dont on met les maisons à faire en évidence
  var dernierSuivant = null;
  var chargement = null;          // { id, fait, total } pendant un chargement
  var timerMaj = null;

  function surMaj(cb) { ecouteurs.push(cb); }
  function surStructure(cb) { ecouteursStructure.push(cb); } // création, nom, suppression, option : à sauvegarder
  function structureChangee() { ecouteursStructure.forEach(function (cb) { cb(); }); }
  function signaler() { ecouteurs.forEach(function (cb) { cb(); }); }
  function parId(id) { return liste.filter(function (s) { return s.id === id; })[0]; }

  // ---------- Données ----------

  function exporter() {
    return { secteurs: JSON.parse(JSON.stringify(liste)), options: { colorer: !!options.colorer } };
  }

  // Valide des secteurs venant d'un fichier : renvoie { donnees, ignores }
  function nettoyer(d) {
    var res = { donnees: { secteurs: [], options: { colorer: false } }, ignores: 0 };
    if (!d || typeof d !== 'object') return res;
    res.donnees.options.colorer = !!(d.options && d.options.colorer);
    (d.secteurs || []).forEach(function (s) {
      var pts = Array.isArray(s && s.points) ? s.points.filter(function (p) {
        return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
      }).map(function (p) { return [+p[0], +p[1]]; }) : [];
      if (!s || typeof s.id !== 'string' || pts.length < 3) { res.ignores++; return; }
      res.donnees.secteurs.push({
        id: s.id.slice(0, 40), nom: String(s.nom || 'Secteur').slice(0, 80), points: pts,
        couleur: /^#[0-9a-f]{6}$/i.test(s.couleur) ? s.couleur : PALETTE[0]
      });
    });
    return res;
  }

  // Charge des secteurs : 'remplacer' ou 'fusionner' (les ids déjà présents sont conservés)
  function charger(d, mode) {
    if (mode === 'remplacer') { liste = []; trouActif = null; }
    options.colorer = (d.options && d.options.colorer) || options.colorer;
    (d.secteurs || []).forEach(function (s) { if (!parId(s.id)) liste.push(JSON.parse(JSON.stringify(s))); });
    reconstruire(); structureChangee();
  }

  // ---------- Géométrie ----------

  function limites(points) {
    return L.latLngBounds(points.map(function (p) { return L.latLng(p[0], p[1]); }));
  }

  // Recalcule quels bâtiments sont dans quel secteur
  function recalculerMembres() {
    var centres = CarteImmo.tousCentres();
    var ids = Object.keys(centres);
    membres = {};
    liste.forEach(function (s) {
      var b = limites(s.points);
      membres[s.id] = ids.filter(function (id) {
        var c = centres[id];
        return b.contains(L.latLng(c[0], c[1])) && CarteImmo.dansPolygone(c[0], c[1], s.points);
      });
    });
  }

  function stats(id) {
    var m = membres[id] || [], par = {};
    Statuts.LISTE.forEach(function (st) { par[st.id] = 0; });
    m.forEach(function (b) { par[Statuts.statutDe(b)]++; });
    var total = m.length, faits = total - par.aucun;
    return { total: total, faits: faits, aFaire: par.aucun, pct: total ? Math.round(100 * faits / total) : null, parStatut: par };
  }

  function nonFaits(id) {
    return (membres[id] || []).filter(function (b) { return Statuts.statutDe(b) === 'aucun'; });
  }

  // ---------- Affichage sur la carte ----------

  function styleSecteur(s, st) {
    if (options.colorer && st.pct !== null) {
      // Échelle séquentielle : clair (peu avancé) -> foncé (terminé)
      return { color: s.couleur, weight: 2, dashArray: '8 6', fillColor: 'hsl(210,75%,' + Math.round(88 - 55 * st.pct / 100) + '%)', fillOpacity: 0.35, interactive: false };
    }
    return { color: s.couleur, weight: 2, dashArray: '8 6', fillColor: s.couleur, fillOpacity: 0.06, interactive: false };
  }

  function dessinerCouches() {
    liste.forEach(function (s) {
      var st = stats(s.id);
      var c = couches[s.id];
      var texte = s.nom + (st.pct !== null ? ' · ' + st.pct + ' %' : '');
      if (!c) {
        c = couches[s.id] = {
          poly: L.polygon(s.points, styleSecteur(s, st)).addTo(groupe),
          etiquette: L.marker(limites(s.points).getCenter(), {
            interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'secteur-etiquette', html: '<span></span>', iconSize: null })
          }).addTo(groupe)
        };
      }
      c.poly.setStyle(styleSecteur(s, st));
      var el = c.etiquette.getElement();
      var span = el && el.firstChild;
      if (span) { span.textContent = texte; span.style.setProperty('--c', s.couleur); }
    });
    Object.keys(couches).forEach(function (id) {
      if (!parId(id)) { groupe.removeLayer(couches[id].poly); groupe.removeLayer(couches[id].etiquette); delete couches[id]; }
    });
  }

  function majTrou() {
    if (trouActif && parId(trouActif)) CarteImmo.mettreEnEvidence(nonFaits(trouActif));
    else { trouActif = null; CarteImmo.mettreEnEvidence([]); }
  }

  // Tout recalculer (après chargement de bâtiments, ajout/suppression de secteur, import…)
  function reconstruire() {
    recalculerMembres(); dessinerCouches(); majTrou(); signaler();
  }

  // Mise à jour allégée (les statuts ont changé) : on garde l'appartenance, on recompte
  function planifierMaj() {
    clearTimeout(timerMaj);
    timerMaj = setTimeout(function () { dessinerCouches(); majTrou(); signaler(); }, 120);
  }

  // ---------- Création / modification ----------

  function creer(points) {
    var n = liste.length + 1, id = 's' + Date.now().toString(36);
    var s = { id: id, nom: 'Secteur ' + n, points: points, couleur: PALETTE[liste.length % PALETTE.length] };
    liste.push(s);
    reconstruire(); structureChangee();
    return s;
  }
  function renommer(id, nom) {
    var s = parId(id); if (!s) return;
    s.nom = (nom || '').trim().slice(0, 80) || s.nom;
    reconstruire(); structureChangee();
  }
  function supprimer(id) {
    liste = liste.filter(function (s) { return s.id !== id; });
    if (trouActif === id) trouActif = null;
    reconstruire(); structureChangee();
  }
  function definirOption(cle, v) { options[cle] = v; reconstruire(); structureChangee(); }

  // ---------- Navigation ----------

  function voir(id) {
    var s = parId(id); if (!s) return;
    map.fitBounds(limites(s.points), { padding: [40, 40] });
  }

  // Active / désactive la mise en évidence des maisons à faire
  function basculerTrous(id) {
    trouActif = (trouActif === id) ? null : id;
    if (trouActif) voir(id);
    majTrou(); signaler();
    return trouActif === id;
  }
  function trousActifs() { return trouActif; }

  // Maison à faire la plus proche de ma position (ou du centre de la vue) (en évitant de reproposer la même)
  // depuisId (facultatif) : maison actuelle ; on part d'elle et on ne la repropose pas
  function suivant(id, depuisId) {
    var centres = CarteImmo.tousCentres();
    // Point de départ : la maison actuelle, sinon ma position si le suivi est actif, sinon le centre de la vue
    var pos = (window.Position && Position.courante()) || null;
    var c0 = depuisId && centres[depuisId] ? L.latLng(centres[depuisId][0], centres[depuisId][1]) : (pos ? L.latLng(pos[0], pos[1]) : map.getCenter());
    var k = Math.cos(c0.lat * Math.PI / 180);
    var exclu = depuisId || dernierSuivant;
    var meilleur = null, dMin = Infinity;
    nonFaits(id).forEach(function (b) {
      if (b === exclu) return;
      var c = centres[b], dy = c[0] - c0.lat, dx = (c[1] - c0.lng) * k, d = dx * dx + dy * dy;
      if (d < dMin) { dMin = d; meilleur = b; }
    });
    if (!meilleur && nonFaits(id).length && nonFaits(id)[0] !== depuisId) meilleur = nonFaits(id)[0];
    dernierSuivant = meilleur;
    if (!meilleur) return null;
    var cc = centres[meilleur];
    if (Ui.reduitMouvement()) map.setView(cc, Math.max(map.getZoom(), 18)); else map.flyTo(cc, Math.max(map.getZoom(), 18), { duration: 0.6 });
    return meilleur;
  }

  // ---------- Chargement des bâtiments d'un secteur ----------

  function cellules(points) {
    var b = limites(points), latMoy = b.getCenter().lat * Math.PI / 180;
    var largeurKm = (b.getEast() - b.getWest()) * 111.32 * Math.cos(latMoy);
    var hauteurKm = (b.getNorth() - b.getSouth()) * 111.32;
    var nx = Math.max(1, Math.ceil(largeurKm / TAILLE_CELLULE_KM)), ny = Math.max(1, Math.ceil(hauteurKm / TAILLE_CELLULE_KM));
    if (nx * ny > CELLULES_MAX) return null;
    var res = [], dLat = (b.getNorth() - b.getSouth()) / ny, dLon = (b.getEast() - b.getWest()) / nx;
    for (var i = 0; i < ny; i++) for (var j = 0; j < nx; j++) {
      res.push(L.latLngBounds([b.getSouth() + i * dLat, b.getWest() + j * dLon], [b.getSouth() + (i + 1) * dLat, b.getWest() + (j + 1) * dLon]));
    }
    return res;
  }

  function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  function chargerBatiments(id) {
    var s = parId(id);
    if (!s) return Promise.reject(new Error('Secteur introuvable.'));
    if (chargement) return Promise.reject(new Error('Un chargement est déjà en cours.'));
    var cases = cellules(s.points);
    if (!cases) return Promise.reject(new Error('Secteur trop grand pour être chargé d\'un coup : dessinez-le en plusieurs secteurs plus petits.'));
    chargement = { id: id, fait: 0, total: cases.length };
    signaler();
    var nouveaux = 0;
    // Séquentiel et espacé : une seule requête Overpass à la fois
    return cases.reduce(function (p, cellule, i) {
      return p.then(function () {
        return DataImmo.charger(cellule, DataImmo.config.zoomMin, function (n, max, delai) {
          alerter('Serveur occupé, nouvel essai ' + n + '/' + max + ' dans ' + Math.round(delai / 1000) + ' s…');
        }).then(function (res) {
          CarteImmo.afficherBatiments(res.nouveaux);
          if (!res.dejaCharge) { Store.enregistrerBatiments(res.nouveaux); Store.enregistrerZones(DataImmo.zones()); }
          nouveaux += res.nouveaux.length;
          chargement.fait = i + 1; signaler();
          return (res.dejaCharge || i === cases.length - 1) ? null : attendre(PAUSE_ENTRE_CELLULES_MS);
        });
      });
    }, Promise.resolve()).then(function () { return nouveaux; }).finally(function () {
      chargement = null; reconstruire();
    });
  }
  function etatChargement() { return chargement; }

  // ---------- Tracé d'un nouveau secteur (clic sur la carte pour chaque sommet) ----------

  function demarrerDessin() {
    abandonnerDessin();
    dessin = { points: [], couche: L.layerGroup().addTo(map) };
    Outils.setMode('secteur');
  }

  function redessinerTrace() {
    dessin.couche.clearLayers();
    var pts = dessin.points;
    if (pts.length >= 2) L.polyline(pts.concat(pts.length >= 3 ? [pts[0]] : []), { color: '#d81b60', weight: 3, dashArray: '6 4', interactive: false }).addTo(dessin.couche);
    pts.forEach(function (p, i) {
      L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: '#d81b60', fillColor: '#fff', fillOpacity: 1, weight: 3, interactive: false }).addTo(dessin.couche);
    });
  }

  function ajouterPoint(ll) {
    if (!dessin) return;
    dessin.points.push([ll.lat, ll.lng]);
    redessinerTrace();
    Outils.rafraichirContexte();
  }

  function retirerDernierPoint() {
    if (!dessin) return;
    dessin.points.pop(); redessinerTrace(); Outils.rafraichirContexte();
  }

  function abandonnerDessin() {
    if (dessin) { map.removeLayer(dessin.couche); dessin = null; }
  }

  function terminerDessin() {
    if (!dessin || dessin.points.length < 3) { alerter('Un secteur demande au moins 3 points.'); return null; }
    var pts = dessin.points.slice();
    abandonnerDessin();
    Outils.setMode('consulter');
    return creer(pts);
  }

  function nbPointsDessin() { return dessin ? dessin.points.length : 0; }

  // ---------- Initialisation ----------

  function init(carte, fnAlerter) {
    map = carte; alerter = fnAlerter || alerter;
    groupe = L.layerGroup().addTo(map);
    // Les statuts changent souvent : simple recomptage. Les bâtiments changent plus rarement : recalcul complet.
    Statuts.surChangement(function () { planifierMaj(); });
    CarteImmo.surElements(function () { clearTimeout(timerMaj); timerMaj = setTimeout(reconstruire, 200); });
  }

  return {
    init: init, surMaj: surMaj, surStructure: surStructure, liste: function () { return liste; }, options: function () { return options; },
    membresDe: function (id) { return membres[id] || []; },
    exporter: exporter, nettoyer: nettoyer, charger: charger, stats: stats, nonFaits: nonFaits,
    creer: creer, renommer: renommer, supprimer: supprimer, definirOption: definirOption,
    voir: voir, basculerTrous: basculerTrous, trousActifs: trousActifs, suivant: suivant,
    chargerBatiments: chargerBatiments, etatChargement: etatChargement,
    demarrerDessin: demarrerDessin, ajouterPoint: ajouterPoint, retirerDernierPoint: retirerDernierPoint,
    abandonnerDessin: abandonnerDessin, terminerDessin: terminerDessin, nbPointsDessin: nbPointsDessin,
    reconstruire: reconstruire
  };
})();
