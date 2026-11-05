/*
 * statuts.js – Modèle de données de la prospection.
 *
 * Pour chaque maison (clé = id OSM, ex. "way/123", ou "man/…" pour une maison ajoutée à la main) :
 * { statut, date, note, logements, nom, tel, historique: [{ statut, date }], etiquettes: [ids],
 *   occupant, projet, echeance, potentiel }.
 * Toute modification passe par modifier() afin de pouvoir être annulée (Ctrl+Z).
 * Expose l'objet global Statuts.
 */
var Statuts = (function () {
  'use strict';

  // Couleur + contour en pointillés + icône : on ne se fie pas à la seule teinte (daltonisme).
  // Couleurs = palette catégorielle validée à 8 teintes (écart daltoniens ≥ 8 entre voisines dans
  // ORDRE_GRAPHIQUE, vérifié avec scripts/validate_palette.js du skill dataviz, en clair et en sombre).
  // `icone` = nom d'une icône Lucide (vendor/lucide/icons.svg) ; `court` = libellé compact (puces, légende).
  var LISTE = [
    { id: 'aucun',      label: 'Non fait',            court: 'Non fait',   couleur: '#9aa5b1', couleurSombre: '#9aa5b1', contour: '#64748b', tirets: null,          icone: 'circle-dashed' },
    { id: 'prospectus', label: 'Prospectus déposé',   court: 'Prospectus', couleur: '#2a78d6', couleurSombre: '#3987e5', contour: '#154a8f', tirets: '6 3',         icone: 'mail' },
    { id: 'contact',    label: 'Contact personnel',   court: 'Contact',    couleur: '#1baf7a', couleurSombre: '#199e70', contour: '#0b6b49', tirets: null,          icone: 'message-circle' },
    { id: 'absent',     label: 'Absent / à repasser', court: 'Absent',     couleur: '#eb6834', couleurSombre: '#d95926', contour: '#9a3a14', tirets: '2 4',         icone: 'door-closed' },
    { id: 'refus',      label: 'Refus / Stop pub',    court: 'Refus',      couleur: '#e34948', couleurSombre: '#e66767', contour: '#8f1f1f', tirets: '10 3 2 3',    icone: 'ban' },
    { id: 'rappeler',   label: 'À rappeler',          court: 'À rappeler', couleur: '#6250d6', couleurSombre: '#9085e9', contour: '#3d2f87', tirets: '1 5',         icone: 'phone-call' },
    // Statuts commerciaux (suite d'un contact)
    { id: 'estimation', label: 'Estimation faite',    court: 'Estimation', couleur: '#eda100', couleurSombre: '#c98500', contour: '#8a5d00', tirets: '4 2',         icone: 'calculator' },
    { id: 'mandat',     label: 'Mandat signé',        court: 'Mandat',     couleur: '#008300', couleurSombre: '#008300', contour: '#004d00', tirets: null,          icone: 'file-signature' },
    { id: 'concurrent', label: 'Mandat concurrent / vendu', court: 'Concurrent', couleur: '#e87ba4', couleurSombre: '#d55181', contour: '#a3335f', tirets: '8 3 2 3 2 3', icone: 'store' }
  ];
  // Ordre d'empilement des graphiques = ordre validé de la palette (ne pas changer sans revalider)
  var ORDRE_GRAPHIQUE = ['prospectus', 'absent', 'contact', 'estimation', 'concurrent', 'mandat', 'rappeler', 'refus'];
  // Ordre des boutons de choix et des raccourcis clavier 1 à 9
  var ORDRE_CHOIX = ['prospectus', 'contact', 'absent', 'rappeler', 'refus', 'estimation', 'mandat', 'concurrent', 'aucun'];
  // Statuts qui supposent qu'on a parlé à quelqu'un (taux de contact, entonnoir)
  var CONTACTS = ['contact', 'rappeler', 'estimation', 'mandat'];

  // Qualification du contact : valeurs possibles (id -> libellé)
  var QUALIF = {
    occupant: { titre: 'Occupant', valeurs: [['proprietaire', 'Propriétaire'], ['locataire', 'Locataire']] },
    projet: { titre: 'Projet', valeurs: [['vente', 'Vente'], ['achat', 'Achat'], ['location', 'Mise en location'], ['succession', 'Succession'], ['estimation', 'Simple estimation'], ['aucun', 'Aucun projet']] },
    echeance: { titre: 'Échéance', valeurs: [['3m', 'Moins de 3 mois'], ['6m', '3 à 6 mois'], ['12m', '6 à 12 mois'], ['plus', 'Plus d\'un an']] },
    potentiel: { titre: 'Potentiel', valeurs: [['chaud', 'Chaud'], ['tiede', 'Tiède'], ['froid', 'Froid']] }
  };
  function libelleQualif(champ, v) {
    var q = QUALIF[champ]; if (!q || !v) return '';
    var t = q.valeurs.filter(function (x) { return x[0] === v; })[0];
    return t ? t[1] : '';
  }
  // Champs dont la présence justifie de garder une fiche même « non faite »
  var CHAMPS_INFO = ['note', 'logements', 'nom', 'tel', 'historique', 'etiquettes', 'occupant', 'projet', 'echeance', 'potentiel'];

  var parId = {};
  LISTE.forEach(function (s) { parId[s.id] = s; });

  var records = {};   // id -> fiche (voir en-tête)
  var manuels = {};   // id -> { lat, lon }
  var adresses = {};  // id -> adresse trouvée par géocodage inverse
  var pile = [];      // opérations annulables : { avant: { id: copie|null } }
  var PILE_MAX = 200;
  var ecouteurs = [];
  var ecouteursDonnees = []; // pour la sauvegarde : (type, ids), type = 'records' | 'manuels' | 'adresses'

  function copie(r) { return r ? JSON.parse(JSON.stringify(r)) : null; }

  // Date/heure locale au format "AAAA-MM-JJTHH:mm" (compatible <input type="datetime-local">)
  function maintenant() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function signaler(type, ids) { ecouteursDonnees.forEach(function (cb) { cb(type, ids); }); }
  function notifier(ids, silencieux) {
    ecouteurs.forEach(function (cb) { cb(ids); });
    if (!silencieux) signaler('records', ids);
  }
  function surChangement(cb) { ecouteurs.push(cb); }
  function surDonnees(cb) { ecouteursDonnees.push(cb); }

  function statutDe(id) { return records[id] ? (records[id].statut || 'aucun') : 'aucun'; }
  function get(id) { return records[id] || null; }

  // Supprime l'enregistrement s'il n'apporte plus aucune information
  function nettoyer(id) {
    var r = records[id];
    if (r && (r.statut || 'aucun') === 'aucun' && !CHAMPS_INFO.some(function (k) { return Array.isArray(r[k]) ? r[k].length : r[k]; })) delete records[id];
  }

  /*
   * Applique un changement { statut?, note?, logements?, date? } à plusieurs bâtiments.
   * Si le statut change et qu'aucune date n'est fournie, la date/heure courante est posée.
   */
  function modifier(ids, patch) {
    var patchs = {};
    ids.forEach(function (id) { patchs[id] = patch; });
    return modifierChacun(patchs);
  }

  // Applique un changement différent à chaque maison ({ id: patch }) en une seule opération annulable
  function modifierChacun(patchs) {
    var avant = {}, modifies = [];
    Object.keys(patchs).forEach(function (id) {
      var patch = patchs[id];
      var ancien = records[id];
      var r = copie(ancien) || {};
      var statutAvant = r.statut || 'aucun';
      Object.keys(patch).forEach(function (k) {
        var v = patch[k];
        if (v === undefined || v === '' || v === null || (Array.isArray(v) && !v.length)) delete r[k]; else r[k] = Array.isArray(v) ? v.slice() : v;
      });
      var statutChange = patch.statut !== undefined && (patch.statut || 'aucun') !== statutAvant;
      if (statutChange && patch.date === undefined) {
        if ((patch.statut || 'aucun') === 'aucun') delete r.date; else r.date = maintenant();
      }
      // Historique des passages : une entrée par changement de statut (les 30 dernières)
      if (statutChange && (r.statut || 'aucun') !== 'aucun') {
        r.historique = (r.historique || []).concat([{ statut: r.statut, date: r.date }]).slice(-30);
      } else if (!statutChange && patch.date !== undefined && r.historique && r.historique.length) {
        var dernier = r.historique[r.historique.length - 1];
        if (dernier.statut === r.statut) r.historique[r.historique.length - 1] = { statut: r.statut, date: r.date };
      }
      if (r.historique && !r.historique.length) delete r.historique;
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
    signaler('manuels', [id]);
    return id;
  }
  function supprimerManuel(id) {
    delete manuels[id]; delete records[id]; delete adresses[id];
    pile = pile.filter(function (op) { delete op.avant[id]; return Object.keys(op.avant).length; });
    signaler('manuels', [id]);
    notifier([id]);
  }

  function setAdresse(id, label) { adresses[id] = label; signaler('adresses', [id]); }
  function adresseDe(id) { return adresses[id] || ''; }

  // Comptage par statut ; "aucun" = total - tout ce qui est coché
  function compter(total) {
    var c = {}; LISTE.forEach(function (s) { c[s.id] = 0; });
    Object.keys(records).forEach(function (id) { c[statutDe(id)]++; });
    c.aucun = Math.max(0, total - (Object.keys(records).filter(function (id) { return statutDe(id) !== 'aucun'; }).length));
    return c;
  }

  /*
   * Charge des données (restauration au démarrage, import) :
   *  mode 'remplacer' : efface tout puis charge ;
   *  mode 'fusionner' : ajoute ; en cas de conflit sur un bâtiment, garde l'entrée la plus récente.
   * silencieux : n'enregistre pas (la source est déjà la base locale).
   * Renvoie des compteurs. L'historique d'annulation est vidé.
   */
  function charger(donnees, mode, silencieux) {
    var bilan = { ajoutes: 0, remplaces: 0, conflitsGardes: 0, manuels: 0 };
    var touches = Object.keys(records);
    var recs = donnees.records || {};
    if (mode === 'remplacer') { records = {}; manuels = {}; adresses = {}; }
    Object.keys(recs).forEach(function (id) {
      var nouveau = copie(recs[id]);
      var ancien = records[id];
      if (!ancien) { records[id] = nouveau; bilan.ajoutes++; }
      else if ((nouveau.date || '') >= (ancien.date || '')) { records[id] = nouveau; bilan.remplaces++; }
      else bilan.conflitsGardes++;
      nettoyer(id);
      touches.push(id);
    });
    var idsManuels = Object.keys(donnees.manuels || {}), idsAdresses = [];
    idsManuels.forEach(function (id) {
      if (!manuels[id]) bilan.manuels++;
      manuels[id] = { lat: donnees.manuels[id].lat, lon: donnees.manuels[id].lon };
    });
    Object.keys(donnees.adresses || {}).forEach(function (id) { if (!adresses[id]) { adresses[id] = donnees.adresses[id]; idsAdresses.push(id); } });
    pile = [];
    if (!silencieux) { signaler('manuels', idsManuels); signaler('adresses', idsAdresses); }
    notifier(touches, silencieux);
    return bilan;
  }

  return {
    charger: charger, surDonnees: surDonnees, adressesToutes: function () { return adresses; },
    LISTE: LISTE, ORDRE_GRAPHIQUE: ORDRE_GRAPHIQUE, ORDRE_CHOIX: ORDRE_CHOIX, CONTACTS: CONTACTS, QUALIF: QUALIF, libelleQualif: libelleQualif, parId: function (id) { return parId[id] || parId.aucun; },
    get: get, statutDe: statutDe, modifier: modifier, modifierChacun: modifierChacun, annuler: annuler, peutAnnuler: peutAnnuler,
    surChangement: surChangement, maintenant: maintenant,
    ajouterManuel: ajouterManuel, supprimerManuel: supprimerManuel,
    manuels: function () { return manuels; },
    setAdresse: setAdresse, adresseDe: adresseDe, compter: compter,
    // Pour la sauvegarde (phase 4)
    _records: function () { return records; }
  };
})();
