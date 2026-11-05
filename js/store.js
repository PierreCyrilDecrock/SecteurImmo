/*
 * store.js – Sauvegarde locale dans IndexedDB (aucun serveur).
 *
 * Magasins : records (statuts), manuels (points ajoutés), adresses, batiments
 * (géométries déjà téléchargées) et kv (zones chargées, préférences, méta).
 * Les écritures sont regroupées (300 ms) et envoyées aussi à la fermeture de la page.
 * Un numéro de schéma permet de faire évoluer le format (voir migrer()).
 * Expose l'objet global Store.
 */
var Store = (function () {
  'use strict';

  var NOM_BASE = 'secteurimmo';
  var VERSION_BASE = 1;
  var SCHEMA = 5;            // version du format des données (export compris)
  var db = null;
  var attente = null;        // écritures en attente : { magasin: { cle: valeur|null } }
  var timer = null;
  var ecouteursEtat = [];

  function vider() { attente = { records: {}, manuels: {}, adresses: {}, batiments: {}, kv: {} }; }
  vider();

  function promesse(req) {
    return new Promise(function (ok, ko) { req.onsuccess = function () { ok(req.result); }; req.onerror = function () { ko(req.error); }; });
  }

  function ouvrir() {
    return new Promise(function (ok) {
      if (!window.indexedDB) { ok(false); return; }
      var r;
      try { r = indexedDB.open(NOM_BASE, VERSION_BASE); } catch (e) { ok(false); return; }
      r.onupgradeneeded = function () {
        var d = r.result;
        ['records', 'manuels', 'adresses', 'batiments'].forEach(function (n) {
          if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
        });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = function () { db = r.result; ok(true); };
      r.onerror = function () { ok(false); };
      r.onblocked = function () { ok(false); };
    });
  }

  function lireTout(nom) { return promesse(db.transaction(nom, 'readonly').objectStore(nom).getAll()); }
  function lireCle(cle) { return promesse(db.transaction('kv', 'readonly').objectStore('kv').get(cle)); }

  // Adapte d'anciennes données au schéma courant (aucune migration nécessaire pour le moment)
  function migrer(donnees, schemaLu) {
    // Schéma 1 -> 2 : ajout des secteurs (absents = liste vide, déjà géré par les valeurs par défaut)
    // Schéma 2 -> 3 : fiches enrichies (nom, téléphone, historique des passages) : champs facultatifs, rien à convertir
    // Schéma 3 -> 4 : étiquettes, qualification du contact, statuts commerciaux : champs facultatifs, rien à convertir
    // Schéma 4 -> 5 : tournées (nouvelle liste facultative), rien à convertir
    // if (schemaLu < 3) { … }  ← à compléter quand le format changera
    return donnees;
  }

  /*
   * Ouvre la base et lit tout. Résout avec null si la base est indisponible
   * (navigation privée, stockage bloqué), sinon avec les données.
   */
  function init() {
    return ouvrir().then(function (ok) {
      if (!ok) return null;
      return Promise.all([lireTout('records'), lireTout('manuels'), lireTout('adresses'), lireTout('batiments'),
                          lireCle('zones'), lireCle('prefs'), lireCle('meta'), lireCle('fichierLie'), lireCle('secteurs'), lireCle('objectif'), lireCle('etiquettes'), lireCle('tournees'), lireCle('progression'), lireCle('base')]).then(function (r) {
        var d = { records: {}, manuels: {}, adresses: {}, batiments: r[3], zones: r[4] || [], prefs: r[5] || null, meta: r[6] || { schema: SCHEMA }, fichierLie: r[7] || null, secteurs: r[8] || { secteurs: [], options: {} }, objectif: r[9] || null, etiquettes: r[10] || null, tournees: r[11] || null, progression: r[12] || null, base: r[13] || null };
        r[0].forEach(function (x) { var id = x.id; delete x.id; d.records[id] = x; });
        r[1].forEach(function (x) { d.manuels[x.id] = { lat: x.lat, lon: x.lon }; });
        r[2].forEach(function (x) { d.adresses[x.id] = x.label; });
        return migrer(d, d.meta.schema || 1);
      });
    }).catch(function () { db = null; return null; });
  }

  function disponible() { return !!db; }

  // ---------- Stockage persistant ----------
  // Sans protection, le navigateur peut effacer les données d'un site quand l'espace disque manque.
  // navigator.storage.persist() demande au navigateur de ne pas le faire (accordé d'office par Chrome
  // aux sites utilisés régulièrement ou installés ; Firefox demande l'autorisation à l'utilisateur).
  function etatStockage() {
    var st = navigator.storage;
    if (!st || !st.persisted) return Promise.resolve({ gere: false, persiste: false, usage: null, quota: null });
    return Promise.all([st.persisted(), st.estimate ? st.estimate() : Promise.resolve({})]).then(function (r) {
      return { gere: true, persiste: !!r[0], usage: r[1].usage || null, quota: r[1].quota || null };
    }).catch(function () { return { gere: false, persiste: false, usage: null, quota: null }; });
  }
  function demanderPersistance() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persist().catch(function () { return false; });
  }

  // ---------- Écriture groupée ----------

  function planifier(magasin, cle, valeur) {
    if (!db) return;
    attente[magasin][cle] = valeur;
    clearTimeout(timer);
    timer = setTimeout(ecrire, 300);
  }

  function ecrire() {
    clearTimeout(timer);
    if (!db) return Promise.resolve();
    var lot = attente; vider();
    var noms = Object.keys(lot).filter(function (n) { return Object.keys(lot[n]).length; });
    if (!noms.length) return Promise.resolve();
    return new Promise(function (ok) {
      try {
        var tx = db.transaction(noms, 'readwrite');
        noms.forEach(function (n) {
          var st = tx.objectStore(n);
          Object.keys(lot[n]).forEach(function (cle) {
            var v = lot[n][cle];
            if (n === 'kv') { if (v === null) st.delete(cle); else st.put(v, cle); }
            else if (v === null) st.delete(cle); else st.put(v);
          });
        });
        tx.oncomplete = function () { signaler(true); ok(); };
        tx.onerror = tx.onabort = function () { signaler(false); ok(); };
      } catch (e) { signaler(false); ok(); }
    });
  }

  function signaler(bien) { ecouteursEtat.forEach(function (cb) { cb(bien); }); }
  function surEtat(cb) { ecouteursEtat.push(cb); }

  // ---------- Branchement sur le modèle ----------

  // À appeler après la restauration : enregistre ensuite chaque modification
  function demarrer() {
    Statuts.surDonnees(function (type, ids) {
      ids.forEach(function (id) {
        if (type === 'records') { var r = Statuts.get(id); planifier('records', id, r ? Object.assign({ id: id }, r) : null); }
        else if (type === 'manuels') { var m = Statuts.manuels()[id]; planifier('manuels', id, m ? { id: id, lat: m.lat, lon: m.lon } : null); }
        else if (type === 'adresses') { planifier('adresses', id, { id: id, label: Statuts.adresseDe(id) }); }
      });
      marquerDepuis();
    });
    window.addEventListener('pagehide', ecrire);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') ecrire(); });
  }

  function enregistrerBatiments(features) { features.forEach(function (f) { planifier('batiments', f.id, Object.assign({}, f)); }); }
  function enregistrerZones(zones) { planifier('kv', 'zones', zones); }
  function kvSet(cle, valeur) { planifier('kv', cle, valeur); }
  // Écriture à part (transaction isolée) : un objet non clonable ne doit pas faire échouer les autres écritures
  function kvSetIsole(cle, valeur) {
    if (!db) return Promise.resolve(false);
    return new Promise(function (ok) {
      try {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(valeur, cle);
        tx.oncomplete = function () { ok(true); };
        tx.onerror = tx.onabort = function () { ok(false); };
      } catch (e) { ok(false); }
    });
  }
  function enregistrerPrefs(p) { planifier('kv', 'prefs', p); }

  // Méta : date du dernier export, date de la première donnée, rappel reporté
  var meta = { schema: SCHEMA };
  function chargerMeta(m) { meta = Object.assign({ schema: SCHEMA }, m || {}); meta.schema = SCHEMA; }
  function getMeta(cle) { return meta[cle]; }
  function setMeta(cle, valeur) { meta[cle] = valeur; planifier('kv', 'meta', Object.assign({}, meta)); }
  function marquerDepuis() { if (!meta.depuis) setMeta('depuis', Date.now()); }

  // Réécrit toute la base à partir du modèle courant (après un import « remplacer »)
  function toutReecrire(batimentsAGarder) {
    if (!db) return Promise.resolve();
    clearTimeout(timer); vider();
    return new Promise(function (ok) {
      var tx = db.transaction(['records', 'manuels', 'adresses', 'batiments', 'kv'], 'readwrite');
      ['records', 'manuels', 'adresses'].forEach(function (n) { tx.objectStore(n).clear(); });
      var recs = Statuts._records(), man = Statuts.manuels(), adr = Statuts.adressesToutes();
      Object.keys(recs).forEach(function (id) { tx.objectStore('records').put(Object.assign({ id: id }, recs[id])); });
      Object.keys(man).forEach(function (id) { tx.objectStore('manuels').put({ id: id, lat: man[id].lat, lon: man[id].lon }); });
      Object.keys(adr).forEach(function (id) { tx.objectStore('adresses').put({ id: id, label: adr[id] }); });
      (batimentsAGarder || []).forEach(function (f) { tx.objectStore('batiments').put(Object.assign({}, f)); });
      tx.objectStore('kv').put(Secteurs.exporter(), 'secteurs');
      tx.objectStore('kv').put(Etiquettes.exporter(), 'etiquettes');
      tx.objectStore('kv').put(Tournees.exporter(), 'tournees');
      tx.oncomplete = function () { signaler(true); ok(); };
      tx.onerror = tx.onabort = function () { signaler(false); ok(); };
    });
  }

  function toutEffacer() {
    clearTimeout(timer); vider(); meta = { schema: SCHEMA };
    if (!db) return Promise.resolve();
    return new Promise(function (ok) {
      var tx = db.transaction(db.objectStoreNames, 'readwrite');
      Array.prototype.forEach.call(db.objectStoreNames, function (n) { tx.objectStore(n).clear(); });
      tx.oncomplete = tx.onerror = tx.onabort = function () { ok(); };
    });
  }

  return {
    SCHEMA: SCHEMA, init: init, disponible: disponible, etatStockage: etatStockage, demanderPersistance: demanderPersistance, demarrer: demarrer, flush: ecrire, surEtat: surEtat,
    enregistrerBatiments: enregistrerBatiments, enregistrerZones: enregistrerZones, enregistrerPrefs: enregistrerPrefs,
    kvSet: kvSet, enregistrerSecteurs: function (d) { planifier('kv', 'secteurs', d); }, kvSetIsole: kvSetIsole, chargerMeta: chargerMeta, getMeta: getMeta, setMeta: setMeta,
    toutReecrire: toutReecrire, toutEffacer: toutEffacer
  };
})();
