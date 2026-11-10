/*
 * tournees.js – Tournées de prospection : une session chronométrée (avec pauses) pendant laquelle
 * chaque maison pointée est enregistrée, ainsi que la distance parcourue (si « Ma position » est actif).
 * Tournée : { id, debut, fin, pauses: [[debut, fin]], secteur, objectif, passages: [{ id, statut, t, n? }] (n = logements concernés, 1 par défaut),
 *             distance (m), trace: [[lat, lon]] } (dates en millisecondes).
 * Expose l'objet global Tournees.
 */
var Tournees = (function () {
  'use strict';

  var liste = [];          // tournées terminées, la plus récente en dernier
  var active = null;       // tournée en cours (fin = null)
  var ecouteurs = [];
  var dernierPoint = null;
  var TRACE_MAX = 3000;

  function signaler(type) { ecouteurs.forEach(function (cb) { cb(type); }); }
  function surChangement(cb) { ecouteurs.push(cb); }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- Cycle de vie ----------
  function demarrer(options) {
    if (active) return active;
    options = options || {};
    active = { id: 't' + Date.now().toString(36), debut: Date.now(), fin: null, pauses: [], pauseDebut: null,
      secteur: options.secteur || null, objectif: options.objectif || null, passages: [], distance: 0, trace: [] };
    dernierPoint = null;
    signaler('demarrage');
    return active;
  }
  function enPause() { return !!(active && active.pauseDebut); }
  function pause() { if (active && !active.pauseDebut) { active.pauseDebut = Date.now(); dernierPoint = null; signaler('pause'); } }
  function reprendre() {
    if (active && active.pauseDebut) { active.pauses.push([active.pauseDebut, Date.now()]); active.pauseDebut = null; signaler('reprise'); }
  }
  // fin facultative (ex. tournée oubliée : on la clôt à la dernière maison pointée)
  function terminer(fin) {
    if (!active) return null;
    if (active.pauseDebut) { active.pauses.push([active.pauseDebut, fin || Date.now()]); active.pauseDebut = null; }
    active.fin = fin || Date.now();
    var t = active; active = null;
    liste.push(t);
    signaler('fin');
    return t;
  }
  function abandonner() { if (active) { active = null; signaler('abandon'); } }
  function supprimer(id) { liste = liste.filter(function (t) { return t.id !== id; }); signaler('suppression'); }
  function renommer(id, nom) { var t = parId(id); if (t) { t.nom = (nom || '').trim().slice(0, 60) || undefined; signaler('modification'); } }
  function parId(id) { return liste.filter(function (t) { return t.id === id; })[0] || (active && active.id === id ? active : null); }

  // Fin de la dernière activité (dernière maison pointée, sinon début)
  function derniereActivite(t) { return t.passages.length ? t.passages[t.passages.length - 1].t : t.debut; }

  // ---------- Enregistrement des passages ----------
  function surPassages(passages, annulation) {
    if (!active) return;
    if (annulation) {
      passages.forEach(function (p) {
        for (var i = active.passages.length - 1; i >= 0; i--) {
          if (active.passages[i].id === p.id && active.passages[i].t === p.t) { active.passages.splice(i, 1); break; }
        }
      });
    } else {
      if (active.pauseDebut) reprendre();     // pointer une maison relance une tournée en pause
      passages.forEach(function (p) { if (p.t >= active.debut) active.passages.push(p.n > 1 ? { id: p.id, statut: p.statut, t: p.t, n: p.n } : { id: p.id, statut: p.statut, t: p.t }); });
    }
    signaler('passage');
  }

  // Distance parcourue : positions précises seulement, en ignorant les petits sauts du GPS à l'arrêt
  function distanceM(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function surPosition(pos, precision) {
    if (!active || active.pauseDebut || precision > 40) return;
    if (!dernierPoint) { dernierPoint = pos; if (active.trace.length < TRACE_MAX) active.trace.push([+pos[0].toFixed(6), +pos[1].toFixed(6)]); return; }
    var d = distanceM(dernierPoint, pos);
    if (d < 8 || d > 500) { if (d > 500) dernierPoint = pos; return; }   // bruit GPS ou saut aberrant
    active.distance += d; dernierPoint = pos;
    if (active.trace.length < TRACE_MAX) active.trace.push([+pos[0].toFixed(6), +pos[1].toFixed(6)]);
    signaler('position');
  }

  // ---------- Statistiques d'une tournée ----------
  function dureeMs(t, maintenant) {
    var fin = t.fin || maintenant || Date.now();
    var pauses = t.pauses.reduce(function (s, p) { return s + (p[1] - p[0]); }, 0) + (t.pauseDebut ? fin - t.pauseDebut : 0);
    return Math.max(0, fin - t.debut - pauses);
  }
  var PORTE = ['prospectus', 'contact', 'absent', 'refus', 'rappeler'];
  function stats(t, maintenant) {
    // Une porte = un logement : un immeuble pointé en une fois compte pour ses n logements
    var dernier = {}, contacts = {}, par = {}, rues = {}, poids = {}, porte = {};
    t.passages.forEach(function (p) {
      dernier[p.id] = p.statut;
      poids[p.id] = Math.max(poids[p.id] || 1, p.n || 1);
      if (PORTE.indexOf(p.statut) >= 0) porte[p.id] = true;
      if (Statuts.CONTACTS.indexOf(p.statut) >= 0) contacts[p.id] = true;
    });
    var ids = Object.keys(dernier);
    ids.forEach(function (id) {
      par[dernier[id]] = (par[dernier[id]] || 0) + poids[id];
      var f = DataImmo.batiment(Statuts.parent(id)), rue = f && f.properties['addr:street'];
      if (rue) rues[rue] = 1;
    });
    var portes = ids.reduce(function (s, id) { return s + (porte[id] ? poids[id] : 0); }, 0);
    var duree = dureeMs(t, maintenant), heures = duree / 3600000;
    var nContacts = Object.keys(contacts).length;
    return {
      duree: duree, maisons: ids.length, portes: portes, contacts: nContacts,
      estimations: ids.filter(function (id) { return t.passages.some(function (p) { return p.id === id && p.statut === 'estimation'; }); }).length,
      mandats: ids.filter(function (id) { return t.passages.some(function (p) { return p.id === id && p.statut === 'mandat'; }); }).length,
      prospectus: par.prospectus || 0, par: par,
      tauxContact: portes ? Math.round(1000 * nContacts / portes) / 10 : null,
      rythme: heures >= 1 / 6 ? Math.round(portes / heures) : null,     // portes par heure (au moins 10 min)
      distance: Math.round(t.distance || 0), rues: Object.keys(rues).length,
      ids: ids
    };
  }

  // Bâtiments OpenStreetMap remplacés par les bâtiments IGN : les passages suivent ({ ancien: nouveau })
  function remplacerIds(corr) {
    var touche = false;
    liste.concat(active ? [active] : []).forEach(function (t) {
      t.passages.forEach(function (p) { var b = Statuts.parent(p.id); if (corr[b]) { p.id = corr[b] + p.id.slice(b.length); touche = true; } });
    });
    if (touche) signaler('modification');
  }

  // ---------- Persistance ----------
  function exporter() { return { liste: copie(liste), active: active ? copie(active) : null }; }
  function nettoyerUne(t) {
    if (!t || typeof t.id !== 'string' || !isFinite(t.debut)) return null;
    return {
      id: t.id.slice(0, 40), nom: typeof t.nom === 'string' ? t.nom.slice(0, 60) : undefined, debut: +t.debut, fin: t.fin ? +t.fin : null,
      pauses: (Array.isArray(t.pauses) ? t.pauses : []).filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); }).slice(0, 200),
      pauseDebut: t.pauseDebut && isFinite(t.pauseDebut) ? +t.pauseDebut : null,
      secteur: typeof t.secteur === 'string' ? t.secteur : null, objectif: Number.isInteger(t.objectif) ? t.objectif : null,
      passages: (Array.isArray(t.passages) ? t.passages : []).filter(function (p) { return p && typeof p.id === 'string' && typeof p.statut === 'string' && isFinite(p.t); })
        .slice(0, 20000).map(function (p) { var o = { id: p.id, statut: p.statut, t: +p.t }; if (Number.isInteger(p.n) && p.n > 1 && p.n < 10000) o.n = p.n; return o; }),
      distance: isFinite(t.distance) ? +t.distance : 0,
      trace: (Array.isArray(t.trace) ? t.trace : []).filter(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]); }).slice(0, TRACE_MAX)
    };
  }
  function nettoyer(d) {
    if (!d || typeof d !== 'object') return { liste: [], active: null };
    return { liste: (Array.isArray(d.liste) ? d.liste : []).map(nettoyerUne).filter(function (t) { return t && t.fin; }), active: d.active ? nettoyerUne(d.active) : null };
  }
  // mode 'remplacer' (restauration) | 'fusionner' (import : ajoute les tournées inconnues)
  function charger(d, mode) {
    d = nettoyer(d);
    if (mode === 'remplacer') { liste = d.liste; active = d.active; }
    else d.liste.forEach(function (t) { if (!parId(t.id)) liste.push(t); });
    liste.sort(function (a, b) { return a.debut - b.debut; });
    signaler('chargement');
  }

  function init() {
    Statuts.surPassages(surPassages);
    if (window.Position) Position.surFix(surPosition);
  }

  return {
    init: init, surChangement: surChangement, demarrer: demarrer, pause: pause, reprendre: reprendre, enPause: enPause,
    terminer: terminer, abandonner: abandonner, supprimer: supprimer, renommer: renommer, parId: parId, remplacerIds: remplacerIds,
    active: function () { return active; }, liste: function () { return liste; },
    stats: stats, dureeMs: dureeMs, derniereActivite: derniereActivite,
    exporter: exporter, nettoyer: nettoyer, charger: charger
  };
})();
