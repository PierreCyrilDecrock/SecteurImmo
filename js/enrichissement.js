/*
 * enrichissement.js – Données publiques ajoutées aux bâtiments téléchargés :
 *   - DPE (diagnostics de performance énergétique des logements, ADEME, data.ademe.fr) ;
 *   - DVF (ventes immobilières depuis 2021, Etalab, API de l'application officielle app.dvf.etalab.gouv.fr).
 *
 * Rattachement d'un DPE à un bâtiment, du plus sûr au moins sûr :
 *   1. identifiant RNB (Référentiel national des bâtiments) commun au DPE et à la BD TOPO ;
 *   2. identifiant de l'adresse BAN ;
 *   3. numéro et nom de rue identiques ;
 *   4. position de l'adresse du DPE sur le bâtiment (ou à 15 m au plus, bâtiment d'habitation).
 * Une vente DVF est rattachée par sa parcelle cadastrale (connue grâce aux liens adresse -> bâtiment) ;
 * si la parcelle porte plusieurs bâtiments, par l'adresse de la vente, sinon à tous ceux de la parcelle.
 *
 * Sur chaque bâtiment : properties.dpe = [{ id, e, g, d, t, s, c, p }] et properties.dvf = [{ id, d, v, t, s, p, n, parc }].
 * Expose l'objet global Enrichissement.
 */
var Enrichissement = (function () {
  'use strict';

  var config = {
    dpe: 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines',
    dvf: 'https://app.dvf.etalab.gouv.fr/api/mutations3/',
    pageDpe: 5000,
    procheM: 15
  };
  var CHAMPS_DPE = 'numero_dpe,identifiant_ban,numero_voie_ban,nom_rue_ban,etiquette_dpe,etiquette_ges,date_etablissement_dpe,type_batiment,' +
    'surface_habitable_logement,periode_construction,complement_adresse_logement,id_rnb,_geopoint';
  var HABITAT = { maison: 1, immeuble: 1, mixte: 1 };
  var ETIQUETTES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  // ---------- Requêtes ----------

  // Première page des DPE d'une zone : par commune (code INSEE) sinon par emprise
  function urlDpe(zone) {
    var q = ['size=' + config.pageDpe, 'select=' + encodeURIComponent(CHAMPS_DPE)];
    if (zone.insee) q.push('qs=' + encodeURIComponent('code_insee_ban:' + zone.insee));
    else q.push('bbox=' + [zone.b[1], zone.b[0], zone.b[3], zone.b[2]].map(function (v) { return v.toFixed(6); }).join(','));
    return config.dpe + '?' + q.join('&');
  }
  // Ventes d'une section cadastrale (« 69149 » + « 000AT »)
  function urlDvf(section) { return config.dvf + section.slice(0, 5) + '/' + section.slice(5); }

  // Sections cadastrales des bâtiments de la zone (d'après leurs parcelles)
  function sections(zone) {
    var r = {}, bs = DataImmo._batiments();
    Object.keys(bs).forEach(function (id) {
      var p = bs[id].properties;
      if (!p.parc || !dansZone(bs[id], zone)) return;
      p.parc.forEach(function (idu) { if (idu && idu.length >= 10) r[idu.slice(0, 10)] = 1; });
    });
    return Object.keys(r).sort();
  }
  function dansZone(f, zone) {
    var c = DataImmo.centreDe(f), b = zone.b;
    if (c[0] < b[0] || c[0] > b[2] || c[1] < b[1] || c[1] > b[3]) return false;
    return !zone.poly || DataImmo.dansPolygone(c[0], c[1], zone.poly);
  }

  // ---------- Normalisation des adresses ----------

  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  // Clé « numéro + dernier mot de la rue » : « 5 rue colonel sebbane » -> « 5|sebbane », « 58 BD KENNEDY » -> « 58|kennedy »
  function cleAdresse(numero, voie) {
    var n = norm(numero).replace(/\s+/g, ''), mots = norm(voie).split(' ').filter(Boolean);
    if (!n || !mots.length) return null;
    return n + '|' + mots[mots.length - 1];
  }
  function clesBatiment(p) {
    return (p.adr || []).map(function (l) { var m = /^(\d+\s*(?:bis|ter|quater|[a-z])?)\s+(.*)$/i.exec(l); return m ? cleAdresse(m[1], m[2]) : null; }).filter(Boolean);
  }

  // ---------- Index des bâtiments (construit au début d'une étape) ----------

  var PAS = 0.0005;
  function index() {
    var bs = DataImmo._batiments(), x = { rnb: {}, adr: {}, cle: {}, parc: {}, grille: {} };
    Object.keys(bs).forEach(function (id) {
      if (!DataImmo.estIgn(id)) return;
      var f = bs[id], p = f.properties;
      (p.rnb || []).forEach(function (r) { x.rnb[r] = id; });
      (p.adrIds || []).forEach(function (a) { (x.adr[a] = x.adr[a] || []).push(id); });
      clesBatiment(p).forEach(function (k) { (x.cle[k] = x.cle[k] || []).push(id); });
      (p.parc || []).forEach(function (pc) { (x.parc[pc] = x.parc[pc] || []).push(id); });
      var c = DataImmo.centreDe(f), k = Math.floor(c[0] / PAS) + ':' + Math.floor(c[1] / PAS);
      (x.grille[k] = x.grille[k] || []).push(id);
    });
    return x;
  }
  // Bâtiment d'habitation le plus proche d'un point (dedans, ou à config.procheM au plus)
  function plusProche(x, lat, lon) {
    var i0 = Math.floor(lat / PAS), j0 = Math.floor(lon / PAS), best = null, dMin = config.procheM;
    for (var i = i0 - 1; i <= i0 + 1; i++) for (var j = j0 - 1; j <= j0 + 1; j++) {
      (x.grille[i + ':' + j] || []).forEach(function (id) {
        var f = DataImmo.batiment(id); if (!f) return;
        var d = DataImmo.distanceBatiment([lon, lat], f);
        if (d === 0 && (!best || dMin > 0)) { best = id; dMin = 0; return; }
        if (d < dMin && HABITAT[f.properties._t]) { best = id; dMin = d; }
      });
    }
    return best;
  }
  // Parmi plusieurs bâtiments candidats, celui d'habitation (sinon le premier)
  function prefere(ids) {
    if (!ids || !ids.length) return null;
    return ids.filter(function (id) { var f = DataImmo.batiment(id); return f && HABITAT[f.properties._t]; })[0] || ids[0];
  }

  // ---------- DPE ----------

  function versDpe(r) {
    var o = { id: r.numero_dpe, e: ETIQUETTES.indexOf(r.etiquette_dpe) >= 0 ? r.etiquette_dpe : null, d: r.date_etablissement_dpe || '' };
    if (r.etiquette_ges) o.g = r.etiquette_ges;
    if (r.type_batiment) o.t = r.type_batiment;
    if (r.surface_habitable_logement) o.s = Math.round(r.surface_habitable_logement);
    if (r.complement_adresse_logement) o.c = String(r.complement_adresse_logement).slice(0, 60);
    if (r.periode_construction) o.p = r.periode_construction;
    return o;
  }

  /*
   * Page de DPE : rattache chaque DPE à un bâtiment. Renvoie { modifies: [Features], rattaches, ignores }.
   */
  function traiterDpe(json, x) {
    var touches = {}, rattaches = 0, ignores = 0;
    (json.results || []).forEach(function (r) {
      if (!r.numero_dpe || !r.etiquette_dpe) { ignores++; return; }
      var id = (r.id_rnb && x.rnb[r.id_rnb]) || prefere(x.adr[r.identifiant_ban]) || prefere(x.cle[cleAdresse(r.numero_voie_ban, r.nom_rue_ban)]);
      if (!id && r._geopoint) { var g = String(r._geopoint).split(','); id = plusProche(x, +g[0], +g[1]); }
      if (!id) { ignores++; return; }
      var p = DataImmo.batiment(id).properties, l = p.dpe = p.dpe || [];
      var o = versDpe(r), i = -1;
      for (var k = 0; k < l.length; k++) if (l[k].id === o.id) { i = k; break; }
      if (i >= 0) l[i] = o; else if (l.length < 300) l.push(o);
      // Bâtiment sans adresse BAN : l'adresse du DPE en tient lieu
      if (!(p.adr && p.adr.length) && !p['addr:street'] && r.nom_rue_ban) {
        p['addr:street'] = r.nom_rue_ban; if (r.numero_voie_ban) p['addr:housenumber'] = String(r.numero_voie_ban);
      }
      touches[id] = true; rattaches++;
    });
    Object.keys(touches).forEach(function (id) { DataImmo.batiment(id).properties.dpe.sort(function (a, b) { return a.d < b.d ? 1 : -1; }); });
    return { modifies: Object.keys(touches).map(DataImmo.batiment), rattaches: rattaches, ignores: ignores };
  }

  // ---------- DVF ----------

  var LOGEMENT = { Maison: 1, Appartement: 1 };
  // Lignes DVF -> mutations : { id, d, v, n, types: {}, s, p, parcelles: {}, cles: {} }
  function mutations(json) {
    var m = {};
    (json.mutations || []).forEach(function (l) {
      var x = m[l.id_mutation] || (m[l.id_mutation] = { id: l.id_mutation, d: l.date_mutation, v: Math.round(+l.valeur_fonciere) || 0, n: l.nature_mutation, types: {}, s: 0, p: 0, parcelles: {}, cles: {}, logements: 0 });
      if (l.id_parcelle && l.id_parcelle !== 'None') x.parcelles[l.id_parcelle] = 1;
      var suffixe = l.adresse_suffixe && l.adresse_suffixe !== 'None' ? l.adresse_suffixe : '';
      var k = cleAdresse((l.adresse_numero && l.adresse_numero !== 'None' ? l.adresse_numero : '') + suffixe, l.adresse_nom_voie);
      if (k) x.cles[k] = 1;
      if (LOGEMENT[l.type_local]) {
        x.types[l.type_local] = (x.types[l.type_local] || 0) + 1; x.logements++;
        x.s += +l.surface_reelle_bati > 0 ? +l.surface_reelle_bati : 0;
        x.p += +l.nombre_pieces_principales > 0 ? +l.nombre_pieces_principales : 0;
      }
    });
    return Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return x.logements > 0; });
  }
  function versVente(x, parc) {
    var t = Object.keys(x.types), o = { id: x.id, d: x.d, v: x.v, n: x.n };
    o.t = x.logements > 1 ? x.logements + ' ' + (t.length === 1 ? t[0].toLowerCase() + 's' : 'logements') : t[0];
    if (x.s) o.s = Math.round(x.s);
    if (x.p) o.p = x.p;
    if (parc) o.parc = 1;
    return o;
  }

  // Page de ventes d'une section : rattache chaque vente aux bâtiments de sa parcelle
  function traiterDvf(json, x) {
    var touches = {}, rattachees = 0;
    mutations(json).forEach(function (m) {
      var cands = [];
      Object.keys(m.parcelles).forEach(function (pc) { (x.parc[pc] || []).forEach(function (id) { if (cands.indexOf(id) < 0) cands.push(id); }); });
      if (!cands.length) return;
      var cibles = cands, parc = false;
      if (cands.length > 1) {
        var parAdresse = cands.filter(function (id) { return clesBatiment(DataImmo.batiment(id).properties).some(function (k) { return m.cles[k]; }); });
        if (parAdresse.length) cibles = parAdresse;
        else { cibles = cands.filter(function (id) { return HABITAT[DataImmo.batiment(id).properties._t]; }); parc = true; if (!cibles.length) cibles = cands; }
      }
      var o = versVente(m, parc);
      cibles.forEach(function (id) {
        var p = DataImmo.batiment(id).properties, l = p.dvf = p.dvf || [];
        if (l.some(function (v) { return v.id === o.id; })) return;
        if (l.length < 200) l.push(o);
        touches[id] = true;
      });
      rattachees++;
    });
    Object.keys(touches).forEach(function (id) { DataImmo.batiment(id).properties.dvf.sort(function (a, b) { return a.d < b.d ? 1 : -1; }); });
    return { modifies: Object.keys(touches).map(DataImmo.batiment), rattachees: rattachees };
  }

  // ---------- Lecture pour l'affichage ----------

  function dpeDe(id) { var f = DataImmo.batiment(Statuts.parent(id)); return f && f.properties.dpe || []; }
  function ventesDe(id) { var f = DataImmo.batiment(Statuts.parent(id)); return f && f.properties.dvf || []; }
  // Étiquette la plus mauvaise des DPE (« G » est pire que « F »)
  function pireEtiquette(id) {
    var e = null;
    dpeDe(id).forEach(function (x) { if (x.e && (!e || x.e > e)) e = x.e; });
    return e;
  }
  // Étiquette d'une maison (DPE le plus récent), ou la plus mauvaise d'un immeuble
  function etiquette(id) {
    var l = dpeDe(id); if (!l.length) return null;
    return l.length === 1 ? l[0].e : pireEtiquette(id);
  }
  function derniereVente(id) { return ventesDe(id)[0] || null; }
  function periode(id) { var l = dpeDe(id); for (var i = 0; i < l.length; i++) if (l[i].p) return l[i].p; return ''; }
  // Nombre de DPE par étiquette (immeubles)
  function repartition(id) { var r = {}; dpeDe(id).forEach(function (x) { if (x.e) r[x.e] = (r[x.e] || 0) + 1; }); return r; }

  return {
    config: config, ETIQUETTES: ETIQUETTES, urlDpe: urlDpe, urlDvf: urlDvf, sections: sections, index: index,
    traiterDpe: traiterDpe, traiterDvf: traiterDvf, mutations: mutations, cleAdresse: cleAdresse,
    dpeDe: dpeDe, ventesDe: ventesDe, etiquette: etiquette, pireEtiquette: pireEtiquette, derniereVente: derniereVente,
    periode: periode, repartition: repartition
  };
})();
