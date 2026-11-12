/*
 * secteurs.js – Secteurs de prospection : polygones dessinés et nommés, statistiques de
 * couverture (en logements : un immeuble de 30 logements compte pour 30 portes), mise en évidence des
 * bâtiments restant à faire, téléchargement des bâtiments d'un secteur (gestionnaire de téléchargement).
 * Expose l'objet global Secteurs.
 */
var Secteurs = (function () {
  'use strict';

  var PALETTE = ['#d81b60', '#00897b', '#5e35b1', '#f4511e', '#039be5', '#7cb342', '#8d6e63', '#546e7a'];

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
  var timerMaj = null, timerSignal = null;

  function surMaj(cb) { ecouteurs.push(cb); }
  function surStructure(cb) { ecouteursStructure.push(cb); } // création, nom, suppression, option : à sauvegarder
  function structureChangee() { ecouteursStructure.forEach(function (cb) { cb(); }); }
  function signaler() { ecouteurs.forEach(function (cb) { cb(); }); }
  function parId(id) { return liste.filter(function (s) { return s.id === id; })[0]; }

  // ---------- Données ----------

  var supprimes = {};   // id -> date de suppression (synchronisation entre appareils)
  function exporter() {
    return { secteurs: JSON.parse(JSON.stringify(liste)), options: { colorer: !!options.colorer }, supprimes: Object.assign({}, supprimes) };
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
        couleur: /^#[0-9a-f]{6}$/i.test(s.couleur) ? s.couleur : PALETTE[0], maj: +s.maj || undefined
      });
    });
    return res;
  }

  // Charge des secteurs : 'remplacer' ou 'fusionner' (les ids déjà présents sont conservés)
  function charger(d, mode) {
    if (mode === 'remplacer') { liste = []; trouActif = null; }
    options.colorer = (d.options && d.options.colorer) || options.colorer;
    (d.secteurs || []).forEach(function (s) { if (!parId(s.id)) liste.push(JSON.parse(JSON.stringify(s))); });
    if (d.supprimes && typeof d.supprimes === 'object') Object.keys(d.supprimes).forEach(function (id) { supprimes[id] = Math.max(supprimes[id] || 0, +d.supprimes[id] || 0); });
    reconstruire(); structureChangee();
  }

  // Synchronisation : la version la plus récente de chaque secteur gagne, une suppression plus récente l'efface
  function fusionner(d) {
    var n = 0;
    (d.secteurs || []).forEach(function (s) {
      var local = parId(s.id), m = +s.maj || 0;
      if (local) { if (m > (+local.maj || 0)) { liste[liste.indexOf(local)] = JSON.parse(JSON.stringify(s)); n++; } }
      else if (!(supprimes[s.id] >= m)) { liste.push(JSON.parse(JSON.stringify(s))); n++; }
    });
    Object.keys(d.supprimes || {}).forEach(function (id) {
      var t = +d.supprimes[id] || 0, local = parId(id);
      if (local && (+local.maj || 0) < t) { liste = liste.filter(function (x) { return x !== local; }); n++; }
      supprimes[id] = Math.max(supprimes[id] || 0, t);
    });
    reconstruire(); structureChangee();
    return n;
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

  // Avancement en logements (portes) : { total, faits, aFaire, pct, parStatut, batiments, batimentsAFaire }
  function stats(id) {
    var m = membres[id] || [], c = Statuts.compterLogements(m), par = {};
    Statuts.LISTE.forEach(function (st) { par[st.id] = c[st.id]; });
    var total = c.total, faits = total - par.aucun;
    return { total: total, faits: faits, aFaire: par.aucun, pct: total ? Math.round(100 * faits / total) : null, parStatut: par,
      batiments: m.length, batimentsAFaire: nonFaits(id).length };
  }

  // Bâtiments dont au moins un logement reste à faire
  function nonFaits(id) {
    return (membres[id] || []).filter(function (b) { var a = Statuts.avancement(b); return a.faits < a.total; });
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

  var evidencePosee = false;   // n'efface la mise en évidence que si c'est nous qui l'avons posée
  function majTrou() {
    if (trouActif && parId(trouActif)) { CarteImmo.mettreEnEvidence(nonFaits(trouActif)); evidencePosee = true; }
    else { trouActif = null; if (evidencePosee) { CarteImmo.mettreEnEvidence([]); evidencePosee = false; } }
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

  function creer(points, nom) {
    var n = liste.length + 1, id = 's' + Date.now().toString(36);
    var s = { id: id, nom: (nom || '').slice(0, 80) || 'Secteur ' + n, points: points, couleur: PALETTE[liste.length % PALETTE.length], maj: Date.now() };
    liste.push(s);
    reconstruire(); structureChangee();
    return s;
  }
  function renommer(id, nom) {
    var s = parId(id); if (!s) return;
    s.nom = (nom || '').trim().slice(0, 80) || s.nom; s.maj = Date.now();
    reconstruire(); structureChangee();
  }
  function supprimer(id) {
    liste = liste.filter(function (s) { return s.id !== id; });
    supprimes[id] = Date.now();
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

  // ---------- Téléchargement des bâtiments d'un secteur ----------

  // Lance (ou relance) le téléchargement des bâtiments et adresses qui suivent le contour du secteur.
  // Résout avec le résumé de la tâche (nouveaux bâtiments…) une fois terminé.
  function chargerBatiments(id) {
    var s = parId(id);
    if (!s) return Promise.reject(new Error('Secteur introuvable.'));
    var p = Telechargements.contour('secteur', s.nom, s.id, s.points);
    signaler();
    return p.finally(function () { reconstruire(); });
  }
  // Téléchargement en cours pour ce secteur : { id, pct } ou null
  function etatChargement(id) {
    var t = Telechargements.parRef('secteur', id);
    return t && t.etat !== 'fini' ? { id: id, pct: Math.round(100 * Telechargements.progression(t).pct), etat: t.etat } : null;
  }

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
    Telechargements.surChangement(function () { clearTimeout(timerSignal); timerSignal = setTimeout(signaler, 300); });
  }

  return {
    init: init, surMaj: surMaj, surStructure: surStructure, liste: function () { return liste; }, options: function () { return options; },
    membresDe: function (id) { return membres[id] || []; },
    exporter: exporter, nettoyer: nettoyer, charger: charger, fusionner: fusionner, stats: stats, nonFaits: nonFaits,
    creer: creer, renommer: renommer, supprimer: supprimer, definirOption: definirOption,
    voir: voir, basculerTrous: basculerTrous, trousActifs: trousActifs, suivant: suivant,
    chargerBatiments: chargerBatiments, etatChargement: etatChargement,
    demarrerDessin: demarrerDessin, ajouterPoint: ajouterPoint, retirerDernierPoint: retirerDernierPoint,
    abandonnerDessin: abandonnerDessin, terminerDessin: terminerDessin, nbPointsDessin: nbPointsDessin,
    reconstruire: reconstruire
  };
})();
