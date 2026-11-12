/*
 * telechargements.js – Gestionnaire de téléchargement des bâtiments et adresses.
 *
 * Chaque demande (zone à l'écran, secteur, commune entière) devient une « tâche » découpée en pages :
 *   1. bâtiments (BD TOPO), affichés au fur et à mesure ;
 *   2. adresses (BAN-PLUS) ;
 *   3. liens adresse -> bâtiment, qui donnent son adresse à chaque bâtiment.
 * Règles : une seule requête à la fois, courte pause entre deux ; nouvel essai espacé en cas d'erreur
 * (le délai demandé par le serveur est respecté) ; pages plus petites si le serveur peine ; attente du
 * réseau hors ligne. La progression est enregistrée après chaque page : après un rechargement ou une
 * coupure, la tâche reprend là où elle s'était arrêtée.
 * Si l'IGN ne répond pas pour une petite zone à l'écran, OpenStreetMap (Overpass) prend le relais.
 * Expose l'objet global Telechargements.
 */
var Telechargements = (function () {
  'use strict';

  var config = {
    pauseMs: 500,              // entre deux requêtes
    essaisMax: 6,              // par page
    delaiBaseMs: 2000          // doublé à chaque nouvel essai (30 s au plus)
  };
  var POIDS = { bat: 0.4, adr: 0.1, lien: 0.2, dpe: 0.15, dvf: 0.15 };   // part de chaque étape dans la progression
  var index = {};              // id de tâche -> index des bâtiments (DPE, DVF), reconstruit au début de l'étape
  var HISTORIQUE_MAX = 12;

  var taches = [];             // toutes les tâches (les terminées en dernier, quelques-unes gardées)
  var actif = null;            // tâche en cours d'exécution
  var promesses = {};          // id -> { ok, ko } (tâches lancées pendant la session)
  var ecouteurs = [], ecouteursFin = [];
  var timerReprise = null;

  function signaler() { ecouteurs.forEach(function (cb) { cb(); }); }
  function sauver() { Store.kvSet('telechargements', taches.map(function (t) { return t; })); }
  function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function parId(id) { return taches.filter(function (t) { return t.id === id; })[0] || null; }
  function enCours() { return taches.some(function (t) { return t.etat === 'attente' || t.etat === 'en-cours'; }); }
  function visibles() { return taches.filter(function (t) { return t.etat !== 'fini'; }); }

  // ---------- Création ----------

  function creer(type, nom, zone, ref) {
    // Une tâche identique non terminée existe déjà : on la relance plutôt que d'en créer une autre
    var deja = taches.filter(function (t) { return t.etat !== 'fini' && t.type === type && t.ref === ref && ref; })[0];
    if (deja) { if (deja.etat !== 'en-cours') { deja.etat = 'attente'; deja.erreur = null; deja.essais = 0; } sauver(); signaler(); lancer(); return attente(deja); }
    var t = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type: type, nom: nom, ref: ref || null, zone: zone,
      etapes: [{ couche: 'bat', debut: 0, total: null, fini: false }, { couche: 'adr', debut: 0, total: null, fini: false }, { couche: 'lien', debut: 0, total: null, fini: false },
        { couche: 'dpe', debut: 0, total: null, fini: false }, { couche: 'dvf', debut: 0, total: null, fini: false }],
      etat: 'attente', erreur: null, message: null, avertissement: null, essais: 0, page: DataImmo.config.page,
      recus: { bat: 0, nouveaux: 0, adresses: 0, lies: 0, rattaches: 0, dpe: 0, ventes: 0 }, adresses: {}, liens: {}, cree: Date.now(), source: 'ign'
    };
    taches.push(t);
    sauver(); signaler(); lancer();
    return attente(t);
  }
  function attente(t) { return new Promise(function (ok, ko) { promesses[t.id] = { ok: ok, ko: ko }; }); }

  // Zone affichée à l'écran (LatLngBounds)
  function zone(bounds) {
    var b = DataImmo.boite(bounds);
    if (DataImmo.surfaceKm2(b) > DataImmo.config.surfaceMaxKm2) return Promise.reject(new Error('Zone trop grande : zoomez, ou téléchargez la commune entière.'));
    if (DataImmo.estCharge(bounds)) return Promise.resolve({ dejaCharge: true, nouveaux: 0 });
    return creer('zone', 'Zone affichée', { b: b }, null);
  }
  // Secteur ou commune : contour [[lat, lon]…] (simplifié pour la requête), code INSEE facultatif
  function contour(type, nom, ref, poly, insee) {
    var b = DataImmo.boiteDe(poly);
    return creer(type, nom, { b: b, poly: DataImmo.simplifier(poly, 140), insee: insee || null }, ref);
  }

  // ---------- Exécution ----------

  function lancer() {
    if (actif) return;
    var t = taches.filter(function (x) { return x.etat === 'attente'; })[0];
    if (!t) return;
    if (!navigator.onLine) { t.message = 'En attente du réseau…'; signaler(); return; }
    actif = t; t.etat = 'en-cours'; t.message = null; t.debutT = t.debutT || Date.now();
    signaler();
    pageSuivante(t);
  }

  function liberer(t) {
    if (actif === t) actif = null;
    sauver(); signaler();
    setTimeout(lancer, 50);
  }

  function pageSuivante(t) {
    if (actif !== t) return;
    if (t.etat !== 'en-cours') { liberer(t); return; }   // mise en pause ou annulée
    var e = t.etapes.filter(function (x) { return !x.fini; })[0];
    if (!e) { terminer(t); return; }
    var url;
    if (e.couche === 'dpe') url = e.suivant || Enrichissement.urlDpe(t.zone);
    else if (e.couche === 'dvf') {
      if (!e.sections) { e.sections = Enrichissement.sections(t.zone); e.total = e.sections.length; }
      if (e.debut >= e.sections.length) { e.fini = true; sauver(); pageSuivante(t); return; }
      url = Enrichissement.urlDvf(e.sections[e.debut]);
    } else url = DataImmo.urlIgn(e.couche, t.zone, e.debut, t.page);
    DataImmo.tenter(url).then(function (json) {
      if (actif !== t) return;
      avancer(t, e, json);
      t.essais = 0; t.message = null;
      sauver(); signaler();
      setTimeout(function () { pageSuivante(t); }, config.pauseMs);
    }, function (err) {
      if (actif !== t) return;
      err = err || {};
      t.essais++;
      if (err.expire && t.page > DataImmo.config.pageReduite) t.page = DataImmo.config.pageReduite;
      if (!navigator.onLine) { t.etat = 'attente'; t.message = 'En attente du réseau…'; actif = null; sauver(); signaler(); return; }
      // Section cadastrale sans vente connue du service : on passe à la suivante
      if (e.couche === 'dvf' && err.statut === 404) { t.essais = 0; e.debut++; sauver(); setTimeout(function () { pageSuivante(t); }, config.pauseMs); return; }
      if (err.reessayer && t.essais < config.essaisMax) {
        var d = err.attenteMs || Math.min(30000, config.delaiBaseMs * Math.pow(2, t.essais - 1));
        t.message = (err.message || 'Erreur') + ' : nouvel essai ' + t.essais + '/' + (config.essaisMax - 1) + ' dans ' + Math.round(d / 1000) + ' s';
        t.prochainEssai = Date.now() + d;
        signaler();
        setTimeout(function () { pageSuivante(t); }, d);
        return;
      }
      echec(t, err.message || 'Erreur inconnue', e.couche);
    });
  }

  // Une page reçue : traitement et avancement de l'étape
  function avancer(t, e, json) {
    if (e.couche === 'dpe') {
      if (!index[t.id] || !e.debut) index[t.id] = Enrichissement.index();
      var n = (json.results || []).length;
      if (e.total === null) e.total = typeof json.total === 'number' ? json.total : n;
      var r = Enrichissement.traiterDpe(json, index[t.id]);
      t.recus.dpe += r.rattaches;
      enregistrer(r.modifies);
      e.debut += n; e.suivant = json.next || null;
      if (!n || !json.next) e.fini = true;
      return;
    }
    if (e.couche === 'dvf') {
      if (!index[t.id] || !e.debut || !index[t.id].parc) index[t.id] = Enrichissement.index();
      var v = Enrichissement.traiterDvf(json, index[t.id]);
      t.recus.ventes += v.rattachees;
      enregistrer(v.modifies);
      e.debut++;
      if (e.debut >= e.total) e.fini = true;
      return;
    }
    var nb = (json.features || []).length;
    if (e.total === null) e.total = typeof json.numberMatched === 'number' ? json.numberMatched : e.debut + nb;
    traiter(t, e.couche, json);
    e.debut += nb;
    if (!nb || e.debut >= e.total) e.fini = true;
  }
  function enregistrer(fs) { if (fs.length) { Store.enregistrerBatiments(fs); CarteImmo.signalerModifies(fs.map(function (f) { return f.id; })); } }

  // Une page de la BD TOPO ou de BAN-PLUS
  function traiter(t, couche, json) {
    if (couche === 'bat') {
      var res = DataImmo.integrerIgn(json);
      t.recus.bat += res.recus; t.recus.nouveaux += res.nouveaux.length;
      t.recus.rattaches += remplacerOsm(res.nouveaux);
      if (res.nouveaux.length) { CarteImmo.afficherBatiments(res.nouveaux); Store.enregistrerBatiments(res.nouveaux); }
    } else if (couche === 'adr') {
      var avant = Object.keys(t.adresses).length;
      DataImmo.lireAdresses(json, t.adresses);
      t.recus.adresses += Object.keys(t.adresses).length - avant;
    } else {
      t.liens = t.liens || {};
      var mod = DataImmo.lierAdresses(json, t.adresses, t.liens);
      t.recus.lies = Object.keys(t.liens).length;
      if (mod.length) { Store.enregistrerBatiments(mod); CarteImmo.signalerModifies(mod.map(function (f) { return f.id; })); }
    }
  }

  /*
   * Les bâtiments OpenStreetMap (anciennes versions, secours) qui correspondent à un bâtiment IGN
   * sont remplacés : leurs fiches (statut, contact, notes…) passent au bâtiment IGN.
   * Renvoie le nombre de fiches rattachées.
   */
  function remplacerOsm(nouveaux) {
    var corr = DataImmo.correspondancesOsm(nouveaux), ids = Object.keys(corr);
    if (!ids.length) return 0;
    var n = Statuts.renommer(corr);
    if (window.Tournees) Tournees.remplacerIds(corr);
    ids.forEach(function (id) { CarteImmo.retirer(id); });
    DataImmo.retirer(ids);
    Store.supprimerBatiments(ids);
    return n;
  }

  function terminer(t) {
    t.etat = 'fini'; t.finT = Date.now(); t.message = null;
    delete t.adresses; delete t.liens; delete index[t.id];
    DataImmo.ajouterZone({ b: t.zone.b, poly: t.zone.poly, src: t.source });
    Store.enregistrerZones(DataImmo.zones());
    elaguer();
    var p = promesses[t.id]; delete promesses[t.id];
    liberer(t);
    ecouteursFin.forEach(function (cb) { cb(t); });
    if (p) p.ok(resume(t));
  }
  function resume(t) { return { dejaCharge: false, nouveaux: t.recus.nouveaux, recus: t.recus.bat, adresses: t.recus.lies, rattaches: t.recus.rattaches, dpe: t.recus.dpe || 0, ventes: t.recus.ventes || 0, source: t.source, avertissement: t.avertissement, tache: t }; }

  function echec(t, message, couche) {
    // Bâtiments déjà reçus mais adresses impossibles : la tâche est terminée avec un avertissement
    if (couche === 'dpe' || couche === 'dvf') {
      // Données d'enrichissement : non bloquantes, on termine (et on garde ce qui est arrivé)
      t.etapes.forEach(function (e) { if (e.couche === couche) e.fini = true; });
      t.avertissement = (couche === 'dpe' ? 'Diagnostics énergétiques (DPE)' : 'Ventes (DVF)') + ' incomplets (' + message.toLowerCase() + ') : relancez « Mettre à jour » plus tard.';
      t.essais = 0;
      setTimeout(function () { pageSuivante(t); }, config.pauseMs);
      return;
    }
    if (couche !== 'bat') {
      t.avertissement = 'Adresses incomplètes (' + message.toLowerCase() + ') : elles seront cherchées à l\'ouverture des fiches.';
      terminer(t); return;
    }
    // Petite zone à l'écran : secours OpenStreetMap
    if (t.type === 'zone' && DataImmo.surfaceKm2(t.zone.b) <= DataImmo.config.surfaceMaxOsmKm2) { secoursOsm(t, message); return; }
    erreur(t, message);
  }
  function erreur(t, message) {
    t.etat = 'erreur'; t.erreur = message; t.message = null;
    var p = promesses[t.id]; delete promesses[t.id];
    liberer(t);
    if (p) p.ko(new Error(message));
  }

  function secoursOsm(t, messageIgn) {
    t.source = 'osm'; t.essais = 0;
    t.message = 'Service IGN indisponible : essai avec OpenStreetMap…'; signaler();
    var n = 0;
    function essai() {
      if (actif !== t || t.etat !== 'en-cours') { liberer(t); return; }
      DataImmo.tenter(DataImmo.urlOsm(n), DataImmo.corpsOsm(t.zone.b)).then(function (json) {
        if (actif !== t) return;
        var res = DataImmo.integrerOsm(json);
        t.recus.bat += res.recus; t.recus.nouveaux += res.nouveaux.length;
        if (res.nouveaux.length) { CarteImmo.afficherBatiments(res.nouveaux); Store.enregistrerBatiments(res.nouveaux); }
        t.etapes.forEach(function (e) { e.fini = true; });
        t.avertissement = 'Données OpenStreetMap (secours) : types et logements moins précis. Rechargez la zone plus tard pour les données IGN.';
        terminer(t);
      }, function (err) {
        if (actif !== t) return;
        n++;
        if (err && err.reessayer && n < 4) {
          var d = (err.attenteMs || config.delaiBaseMs * Math.pow(2, n - 1));
          t.message = 'OpenStreetMap : ' + (err.message || 'erreur') + ', nouvel essai dans ' + Math.round(d / 1000) + ' s'; signaler();
          setTimeout(essai, d); return;
        }
        erreur(t, 'IGN : ' + messageIgn + ' ; OpenStreetMap : ' + ((err && err.message) || 'erreur'));
      });
    }
    essai();
  }

  function elaguer() {
    var finies = taches.filter(function (t) { return t.etat === 'fini'; });
    if (finies.length > HISTORIQUE_MAX) {
      var trop = finies.slice(0, finies.length - HISTORIQUE_MAX);
      taches = taches.filter(function (t) { return trop.indexOf(t) < 0; });
    }
  }

  // ---------- Commandes ----------

  function pause(id) { var t = parId(id); if (!t || t.etat === 'fini') return; t.etat = 'pause'; t.message = null; if (actif !== t) { sauver(); signaler(); } }
  function reprendre(id) {
    var t = parId(id); if (!t || t.etat === 'fini' || t.etat === 'en-cours') return;
    t.etat = 'attente'; t.erreur = null; t.essais = 0; t.message = null;
    sauver(); signaler(); lancer();
  }
  function annuler(id) {
    var t = parId(id); if (!t) return;
    taches = taches.filter(function (x) { return x !== t; });
    var p = promesses[id]; delete promesses[id];
    if (actif === t) actif = null;
    sauver(); signaler(); setTimeout(lancer, 50);
    if (p) p.ko(new Error('Téléchargement annulé.'));
  }

  // Progression d'une tâche : { pct (0-1), etape, fait, total, restantMs }
  function progression(t) {
    var p = 0, courante = null;
    t.etapes.forEach(function (e) {
      var f = e.fini ? 1 : (e.total ? Math.min(1, e.debut / e.total) : 0);
      p += POIDS[e.couche] * f;
      if (!e.fini && !courante) courante = e;
    });
    var restant = null;
    if (t.etat === 'en-cours' && t.debutT && p > 0.04) restant = (Date.now() - t.debutT) * (1 - p) / p;
    return { pct: t.etat === 'fini' ? 1 : p, etape: courante ? courante.couche : null, fait: courante ? courante.debut : 0, total: courante ? courante.total : null, restantMs: restant };
  }

  // ---------- Restauration ----------

  function charger(liste) {
    taches = (Array.isArray(liste) ? liste : []).filter(function (t) { return t && t.id && t.zone && Array.isArray(t.etapes); });
    taches.forEach(function (t) {
      if (t.etat === 'en-cours') t.etat = 'attente';   // interrompue par la fermeture : reprise
      t.essais = 0; t.message = null; t.adresses = t.adresses || {}; t.liens = t.liens || {};
    });
    signaler();
  }
  // À appeler une fois l'application prête : reprend les tâches interrompues
  function demarrer() {
    window.addEventListener('online', function () { clearTimeout(timerReprise); timerReprise = setTimeout(lancer, 1000); });
    if (taches.some(function (t) { return t.etat === 'attente'; })) setTimeout(lancer, 1500);
  }

  return {
    config: config, zone: zone, contour: contour, pause: pause, reprendre: reprendre, annuler: annuler,
    liste: function () { return taches; }, visibles: visibles, actif: function () { return actif; }, parId: parId,
    parRef: function (type, ref) { return taches.filter(function (t) { return t.type === type && t.ref === ref; }).pop() || null; },
    enCours: enCours, progression: progression, surChangement: function (cb) { ecouteurs.push(cb); }, surFin: function (cb) { ecouteursFin.push(cb); },
    charger: charger, demarrer: demarrer
  };
})();
