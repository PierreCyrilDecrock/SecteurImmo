/*
 * stats.js – Calculs statistiques (sans affichage) : éléments à analyser, séries par jour/semaine,
 * avancement par rue, jeu de données de démonstration. Expose l'objet global Stats.
 */
var Stats = (function () {
  'use strict';

  // ---------- Dates (chaînes locales « AAAA-MM-JJTHH:mm », comme dans les fiches) ----------

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function jourDe(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dateDepuisJour(j) { var p = j.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function ajouterJours(d, n) { var r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return r; }
  function lundi(d) { var k = (d.getDay() + 6) % 7; return ajouterJours(d, -k); }
  function aujourdhui() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // ---------- Extraction de la rue depuis une adresse ----------

  // « 12 Rue des Lilas 44000 Nantes » -> « Rue des Lilas » ; « 8, Rue Test, Nantes, France » -> « Rue Test »
  function rueDe(adresse) {
    if (!adresse) return '';
    var a = String(adresse).replace(/^≈\s*/, '').trim();
    if (a.indexOf(',') >= 0) {
      var parts = a.split(',').map(function (x) { return x.trim(); });
      if (/^\d+\s?(bis|ter)?$/i.test(parts[0]) && parts[1]) return parts[1];
      return parts[0];
    }
    a = a.replace(/[\s,]*\b\d{5}\b.*$/, '');                     // code postal et ville
    a = a.replace(/^\d+\s?(?:bis|ter|quater|[a-d])?\s+/i, '');  // numéro
    return a.trim();
  }

  // ---------- Éléments réels ----------

  // Un élément par bâtiment connu (chargé sur la carte) ou ayant un statut
  function elementsReels() {
    var centres = CarteImmo.tousCentres(), recs = Statuts._records(), adr = Statuts.adressesToutes();
    var ids = {}; Object.keys(centres).forEach(function (i) { ids[i] = 1; }); Object.keys(recs).forEach(function (i) { ids[i] = 1; });
    var secteursDe = {};
    Secteurs.liste().forEach(function (s) {
      Secteurs.membresDe(s.id).forEach(function (b) { (secteursDe[b] = secteursDe[b] || []).push(s.id); });
    });
    var man = Statuts.manuels();
    return Object.keys(ids).map(function (id) {
      var r = recs[id] || {}, f = DataImmo.batiment(id), c = centres[id] || (man[id] ? [man[id].lat, man[id].lon] : null);
      var texteAdr = (f && DataImmo.adresse(f.properties)) || adr[id] || '';
      // Rue : étiquette OSM (sans un éventuel code postal collé), sinon tirée de l'adresse trouvée
      var rue = (f && f.properties['addr:street'] ? f.properties['addr:street'].replace(/[\s,]*\b\d{5}\b.*$/, '').trim() : '') || rueDe(adr[id]);
      return {
        id: id, statut: r.statut || 'aucun', date: r.date || '', note: r.note || '', logements: r.logements || 0,
        nom: r.nom || '', tel: r.tel || '',
        adresse: texteAdr, rue: rue || '', secteurs: secteursDe[id] || [], lat: c ? c[0] : null, lon: c ? c[1] : null
      };
    });
  }

  // ---------- Jeu de démonstration (jamais enregistré, ne touche pas aux vraies données) ----------

  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function elementsDemo() {
    var rnd = mulberry32(42);
    var rues = ['Rue des Lilas', 'Avenue du Parc', 'Impasse des Écoles', 'Rue Victor Hugo', 'Allée des Tilleuls', 'Rue du Moulin', 'Chemin des Vignes', 'Rue de la Gare'];
    var secteurs = ['demo-centre', 'demo-lilas'];
    var notes = ['', '', '', 'Propriétaire intéressé par une estimation', 'Rappeler après 18 h', 'Vend dans 2 ans', 'Locataire', 'A déjà un agent', 'Succession en cours', 'Veut un avis de valeur'];
    var noms = ['M. Martin', 'Mme Bernard', 'M. et Mme Petit', 'Mme Durand', 'M. Leroy', 'Mme Moreau', 'M. Lefèvre', 'Mme Garnier'];
    var statutsFaits = ['prospectus', 'prospectus', 'prospectus', 'contact', 'contact', 'absent', 'absent', 'refus', 'rappeler'];
    var auj = aujourdhui(), items = [], n = 0;
    rues.forEach(function (rue, k) {
      var nb = 14 + Math.floor(rnd() * 12), avancement = 0.35 + rnd() * 0.65;
      for (var i = 1; i <= nb; i++) {
        var fait = rnd() < avancement, st = 'aucun', date = '';
        if (fait) {
          st = statutsFaits[Math.floor(rnd() * statutsFaits.length)];
          var d = ajouterJours(auj, -Math.floor(Math.pow(rnd(), 1.5) * 60));
          date = jourDe(d) + 'T' + pad(9 + Math.floor(rnd() * 10)) + ':' + pad(Math.floor(rnd() * 60));
        }
        var note = (st === 'contact' || st === 'rappeler') ? notes[Math.floor(rnd() * notes.length)] : '';
        var nom = (st === 'contact' || st === 'rappeler') && rnd() < 0.7 ? noms[Math.floor(rnd() * noms.length)] : '';
        var tel = nom && rnd() < 0.6 ? '06 ' + pad(Math.floor(rnd() * 100)) + ' ' + pad(Math.floor(rnd() * 100)) + ' ' + pad(Math.floor(rnd() * 100)) + ' ' + pad(Math.floor(rnd() * 100)) : '';
        items.push({ id: 'demo/' + (++n), statut: st, date: date, note: note, nom: nom, tel: tel, logements: rnd() < 0.1 ? 2 + Math.floor(rnd() * 6) : 0,
          adresse: i + ' ' + rue, rue: rue, secteurs: [secteurs[k % 2]], lat: null, lon: null });
      }
    });
    return items;
  }

  var NOMS_DEMO = { 'demo-centre': 'Centre-ville (démo)', 'demo-lilas': 'Les Lilas (démo)' };

  // ---------- Filtres ----------

  // periode : nombre de jours (7, 30, 90) ou 0 = tout ; secteur : id ou '' (tous)
  function filtrer(items, periode, secteur) {
    var debut = periode ? jourDe(ajouterJours(aujourdhui(), -(periode - 1))) : '';
    return items.filter(function (e) {
      if (secteur && e.secteurs.indexOf(secteur) < 0) return false;
      if (periode) return e.statut !== 'aucun' && e.date && e.date.slice(0, 10) >= debut;
      return true;
    });
  }

  // ---------- Chiffres clés ----------

  function chiffres(items) {
    var par = {}; Statuts.LISTE.forEach(function (s) { par[s.id] = 0; });
    var logements = 0;
    items.forEach(function (e) { par[e.statut]++; if (e.statut !== 'aucun') logements += e.logements || 1; });
    var total = items.length, faits = total - par.aucun;
    return { total: total, faits: faits, aFaire: par.aucun, par: par, logements: logements,
      tauxContact: faits ? Math.round(1000 * par.contact / faits) / 10 : null };
  }

  // ---------- Série temporelle ----------

  // Retourne { buckets: [{ debut, fin, label, total, par }], granularite, auto }
  function serie(items, periode, granularite) {
    var faits = items.filter(function (e) { return e.statut !== 'aucun' && e.date; });
    var auj = aujourdhui(), debut;
    if (periode) debut = ajouterJours(auj, -(periode - 1));
    else if (faits.length) debut = faits.reduce(function (m, e) { var d = dateDepuisJour(e.date.slice(0, 10)); return d < m ? d : m; }, auj);
    else debut = ajouterJours(auj, -6);
    var jours = Math.round((auj - debut) / 86400000) + 1, auto = false;
    if (granularite === 'jour' && jours > 100) { granularite = 'semaine'; auto = true; }
    var buckets = [], index = {}, d = granularite === 'semaine' ? lundi(debut) : debut;
    while (d <= auj) {
      var fin = granularite === 'semaine' ? ajouterJours(d, 6) : d;
      var b = { debut: jourDe(d), fin: jourDe(fin), total: 0, par: {} };
      Statuts.ORDRE_GRAPHIQUE.forEach(function (s) { b.par[s] = 0; });
      b.label = granularite === 'semaine' ? 'Sem. du ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) : pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
      b.libelleLong = granularite === 'semaine'
        ? 'Semaine du ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' au ' + pad(fin.getDate()) + '/' + pad(fin.getMonth() + 1)
        : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      buckets.push(b);
      var cle = jourDe(d); index[cle] = b;
      d = ajouterJours(d, granularite === 'semaine' ? 7 : 1);
    }
    faits.forEach(function (e) {
      var j = dateDepuisJour(e.date.slice(0, 10));
      if (j < debut || j > auj) return;
      var cle = jourDe(granularite === 'semaine' ? lundi(j) : j), b = index[cle];
      if (b && b.par[e.statut] !== undefined) { b.par[e.statut]++; b.total++; }
    });
    return { buckets: buckets, granularite: granularite, auto: auto };
  }

  // ---------- Avancement par rue ----------

  function rues(items) {
    var m = {};
    items.forEach(function (e) {
      var nom = e.rue || '';
      var r = m[nom] || (m[nom] = { nom: nom, total: 0, faits: 0, par: {} });
      r.total++; if (e.statut !== 'aucun') r.faits++;
      r.par[e.statut] = (r.par[e.statut] || 0) + 1;
    });
    return Object.keys(m).map(function (k) { var r = m[k]; r.pct = r.total ? Math.round(100 * r.faits / r.total) : 0; r.termine = r.faits >= r.total; return r; });
  }

  // ---------- Comparaison avec la période précédente, rythme ----------

  // Maisons faites et taux de contact sur la période précédente de même durée (null si période = tout)
  function precedente(items, periode, secteur) {
    if (!periode) return null;
    var auj = aujourdhui();
    var fin = jourDe(ajouterJours(auj, -periode)), debut = jourDe(ajouterJours(auj, -(2 * periode - 1)));
    var sel = items.filter(function (e) {
      if (secteur && e.secteurs.indexOf(secteur) < 0) return false;
      var j = e.date ? e.date.slice(0, 10) : '';
      return e.statut !== 'aucun' && j && j >= debut && j <= fin;
    });
    return chiffres(sel);
  }

  // Jours d'affilée avec au moins une maison faite (jusqu'à aujourd'hui, ou hier si rien aujourd'hui)
  function serieJours(items, secteur) {
    var jours = {};
    items.forEach(function (e) { if (e.statut !== 'aucun' && e.date && (!secteur || e.secteurs.indexOf(secteur) >= 0)) jours[e.date.slice(0, 10)] = 1; });
    var d = aujourdhui();
    if (!jours[jourDe(d)]) d = ajouterJours(d, -1);
    var n = 0;
    while (jours[jourDe(d)]) { n++; d = ajouterJours(d, -1); }
    return n;
  }

  // Maisons faites depuis lundi (semaine en cours) et aujourd'hui
  function rythme(items, secteur) {
    var auj = aujourdhui(), lun = jourDe(lundi(auj)), j0 = jourDe(auj), semaine = 0, jour = 0;
    items.forEach(function (e) {
      if (e.statut === 'aucun' || !e.date || (secteur && e.secteurs.indexOf(secteur) < 0)) return;
      var j = e.date.slice(0, 10);
      if (j >= lun) semaine++;
      if (j === j0) jour++;
    });
    return { semaine: semaine, aujourdhui: jour, serie: serieJours(items, secteur) };
  }

  return {
    precedente: precedente, rythme: rythme,
    rueDe: rueDe, elementsReels: elementsReels, elementsDemo: elementsDemo, nomsDemo: NOMS_DEMO,
    filtrer: filtrer, chiffres: chiffres, serie: serie, rues: rues,
    jourDe: jourDe, aujourdhui: aujourdhui, dateDepuisJour: dateDepuisJour
  };
})();
