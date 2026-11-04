/*
 * statuts.js – Modèle de données de la prospection (en mémoire pour l'instant).
 *
 * Pour chaque bâtiment (clé = id OSM, ex. "way/123", ou "man/…" pour un point
 * ajouté à la main) on garde : { statut, date, note, logements }.
 * Toute modification passe par modifier() afin de pouvoir être annulée (Ctrl+Z).
 * La sauvegarde dans IndexedDB viendra en phase 4 (via surChangement).
 * Expose l'objet global Statuts.
 */
var Statuts = (function () {
  'use strict';

  // Couleur + contour en pointillés + icône : on ne se fie pas à la seule teinte (daltonisme)
  var LISTE = [
    { id: 'aucun',      label: 'Non fait',          couleur: '#9aa5b1', contour: '#5f6b76', tirets: null,       icone: '' },
    { id: 'prospectus', label: 'Prospectus déposé', couleur: '#1e88e5', contour: '#0d47a1', tirets: '6 3',      icone: '📬' },
    { id: 'contact',    label: 'Contact personnel', couleur: '#2e9d4f', contour: '#1b5e20', tirets: null,       icone: '💬' },
    { id: 'absent',     label: 'Absent / à repasser', couleur: '#fb8c00', contour: '#bf5b00', tirets: '2 4',    icone: '🚪' },
    { id: 'refus',      label: 'Refus / Stop pub',  couleur: '#d32f2f', contour: '#7f0000', tirets: '10 3 2 3', icone: '⛔' },
    { id: 'rappeler',   label: 'À rappeler',        couleur: '#8e24aa', contour: '#4a148c', tirets: '1 5',      icone: '📞' }
  ];
  var parId = {};
  LISTE.forEach(function (s) { parId[s.id] = s; });

  var records = {};   // id -> { statut, date, note, logements }
  var manuels = {};   // id -> { lat, lon }
  var adresses = {};  // id -> adresse trouvée par géocodage inverse
  var pile = [];      // opérations annulables : { avant: { id: copie|null } }
  var PILE_MAX = 200;
  var ecouteurs = [];

  function copie(r) { return r ? JSON.parse(JSON.stringify(r)) : null; }

  // Date/heure locale au format "AAAA-MM-JJTHH:mm" (compatible <input type="datetime-local">)
  function maintenant() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function notifier(ids) { ecouteurs.forEach(function (cb) { cb(ids); }); }
  function surChangement(cb) { ecouteurs.push(cb); }

  function statutDe(id) { return records[id] ? (records[id].statut || 'aucun') : 'aucun'; }
  function get(id) { return records[id] || null; }

  // Supprime l'enregistrement s'il n'apporte plus aucune information
  function nettoyer(id) {
    var r = records[id];
    if (r && (r.statut || 'aucun') === 'aucun' && !r.note && !r.logements) delete records[id];
  }

  /*
   * Applique un changement { statut?, note?, logements?, date? } à plusieurs bâtiments.
   * Si le statut change et qu'aucune date n'est fournie, la date/heure courante est posée.
   */
  function modifier(ids, patch) {
    var avant = {}, modifies = [];
    ids.forEach(function (id) {
      var ancien = records[id];
      var r = copie(ancien) || {};
      var statutAvant = r.statut || 'aucun';
      Object.keys(patch).forEach(function (k) {
        if (patch[k] === undefined || patch[k] === '' || patch[k] === null) delete r[k]; else r[k] = patch[k];
      });
      if (patch.statut !== undefined && (patch.statut || 'aucun') !== statutAvant && patch.date === undefined) {
        if ((patch.statut || 'aucun') === 'aucun') delete r.date; else r.date = maintenant();
      }
      if (JSON.stringify(r) === JSON.stringify(ancien || {})) return; // rien n'a changé
      avant[id] = copie(ancien);
      records[id] = r;
      nettoyer(id);
      modifies.push(id);
    });
    if (!modifies.length) return 0;
    pile.push({ avant: avant });
    if (pile.length > PILE_MAX) pile.shift();
    notifier(modifies);
    return modifies.length;
  }

  function annuler() {
    var op = pile.pop();
    if (!op) return false;
    var ids = Object.keys(op.avant);
    ids.forEach(function (id) {
      if (op.avant[id]) records[id] = op.avant[id]; else delete records[id];
    });
    notifier(ids);
    return true;
  }
  function peutAnnuler() { return pile.length > 0; }

  // ---- Points ajoutés manuellement (maison absente d'OpenStreetMap) ----
  function ajouterManuel(lat, lon) {
    var id = 'man/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    manuels[id] = { lat: lat, lon: lon };
    return id;
  }
  function supprimerManuel(id) {
    delete manuels[id]; delete records[id]; delete adresses[id];
    pile = pile.filter(function (op) { delete op.avant[id]; return Object.keys(op.avant).length; });
    notifier([id]);
  }

  function setAdresse(id, label) { adresses[id] = label; }
  function adresseDe(id) { return adresses[id] || ''; }

  // Comptage par statut ; "aucun" = total - tout ce qui est coché
  function compter(total) {
    var c = {}; LISTE.forEach(function (s) { c[s.id] = 0; });
    Object.keys(records).forEach(function (id) { c[statutDe(id)]++; });
    c.aucun = Math.max(0, total - (Object.keys(records).filter(function (id) { return statutDe(id) !== 'aucun'; }).length));
    return c;
  }

  return {
    LISTE: LISTE, parId: function (id) { return parId[id] || parId.aucun; },
    get: get, statutDe: statutDe, modifier: modifier, annuler: annuler, peutAnnuler: peutAnnuler,
    surChangement: surChangement, maintenant: maintenant,
    ajouterManuel: ajouterManuel, supprimerManuel: supprimerManuel,
    manuels: function () { return manuels; },
    setAdresse: setAdresse, adresseDe: adresseDe, compter: compter,
    // Pour la sauvegarde (phase 4)
    _records: function () { return records; }
  };
})();
