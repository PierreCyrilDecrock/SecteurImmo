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

  // Poids d'un élément = nombre de logements (portes) qu'il représente
  function w(e) { return e.poids === undefined ? 1 : e.poids; }

  // Un élément par bâtiment affiché ou ayant une fiche, et un par logement détaillé d'immeuble
  function elementsReels() {
    var centres = CarteImmo.tousCentres(), recs = Statuts._records(), adr = Statuts.adressesToutes();
    var ids = {}; Object.keys(centres).forEach(function (i) { ids[i] = 1; }); Object.keys(recs).forEach(function (i) { ids[i] = 1; });
    var secteursDe = {};
    Secteurs.liste().forEach(function (s) {
      Secteurs.membresDe(s.id).forEach(function (b) { (secteursDe[b] = secteursDe[b] || []).push(s.id); });
    });
    var man = Statuts.manuels(), res = [];
    Object.keys(ids).forEach(function (id) {
      if (Statuts.estLot(id)) return;   // les logements sont ajoutés avec leur immeuble
      var r = recs[id] || {}, f = DataImmo.batiment(id), c = centres[id] || CarteImmo.centre(id) || (man[id] ? [man[id].lat, man[id].lon] : null);
      var texteAdr = (f && DataImmo.adresse(f.properties)) || adr[id] || '';
      // Rue : adresse du bâtiment (sans un éventuel code postal collé), sinon tirée de l'adresse trouvée
      var rue = (f && f.properties['addr:street'] ? f.properties['addr:street'].replace(/[\s,]*\b\d{5}\b.*$/, '').trim() : '') || rueDe(adr[id]);
      var type = man[id] && !r.type ? 'maison' : TypesBati.typeDe(id), nLog = Statuts.avancement(id).total;
      var commun = { adresse: texteAdr, rue: rue || '', secteurs: secteursDe[id] || [], lat: c ? c[0] : null, lon: c ? c[1] : null, type: type, nbLogements: nLog, parent: id };
      res.push(Object.assign(element(id, r), commun, { poids: Statuts.poids(id), logements: r.logements || 0 }));
      Statuts.lotsDe(id).forEach(function (l) {
        res.push(Object.assign(element(l, recs[l] || {}), commun, { poids: 1, logement: (recs[l] || {}).libelle || 'Logement', logements: 0 }));
      });
    });
    return res;
  }
  function element(id, r) {
    return {
      id: id, statut: r.statut || 'aucun', date: r.date || '', note: r.note || '',
      nom: r.nom || '', tel: r.tel || '', historique: r.historique || [], etiquettes: r.etiquettes || [],
      occupant: r.occupant || '', projet: r.projet || '', echeance: r.echeance || '', potentiel: r.potentiel || ''
    };
  }

  // ---------- Jeu de démonstration (jamais enregistré, ne touche pas aux vraies données) ----------

  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function elementsDemo() {
    var rnd = mulberry32(42);
    var choisir = function (t) { return t[Math.floor(rnd() * t.length)]; };
    var rues = ['Rue des Lilas', 'Avenue du Parc', 'Impasse des Écoles', 'Rue Victor Hugo', 'Allée des Tilleuls', 'Rue du Moulin', 'Chemin des Vignes', 'Rue de la Gare', 'Rue Pasteur', 'Allée des Peupliers', 'Rue Jean Jaurès', 'Chemin du Lavoir'];
    var secteurs = ['demo-centre', 'demo-lilas'];
    var notes = ['', '', 'Propriétaire intéressé par une estimation', 'Rappeler après 18 h', 'Vend dans 2 ans', 'A déjà un agent', 'Succession en cours', 'Veut un avis de valeur', 'Enfants partis, maison trop grande'];
    var noms = ['M. Martin', 'Mme Bernard', 'M. et Mme Petit', 'Mme Durand', 'M. Leroy', 'Mme Moreau', 'M. Lefèvre', 'Mme Garnier'];
    var tags = ['e-stop-pub', 'e-chien', 'e-a-vendre', 'e-travaux', 'e-volets', 'e-boite'];
    var auj = aujourdhui(), items = [], n = 0;
    function horodatage(j, h) { return jourDe(ajouterJours(auj, -j)) + 'T' + pad(h) + ':' + pad(Math.floor(rnd() * 60)); }
    rues.forEach(function (rue, k) {
      var nb = 18 + Math.floor(rnd() * 14), avancement = 0.35 + rnd() * 0.65;
      for (var i = 1; i <= nb; i++) {
        var e = { id: 'demo/' + (++n), statut: 'aucun', date: '', note: '', nom: '', tel: '', historique: [], etiquettes: [], occupant: '', projet: '', echeance: '', potentiel: '',
          logements: 0, poids: 1, type: 'maison', adresse: i + ' ' + rue, rue: rue, secteurs: [secteurs[k % 2]], lat: null, lon: null };
        if (rnd() < avancement) {
          // Passage : jour et heure ; on trouve plus souvent quelqu'un en fin de journée et le samedi
          var j = Math.floor(Math.pow(rnd(), 1.5) * 60), h = 9 + Math.floor(rnd() * 11);
          var jour = ajouterJours(auj, -j).getDay();
          var chance = 0.22 + (h >= 17 ? 0.25 : 0) + (jour === 6 ? 0.15 : 0) - (h >= 12 && h < 14 ? 0.08 : 0);
          var t = horodatage(j, h);
          if (rnd() < chance) {
            var r = rnd();
            var st = r < 0.5 ? 'contact' : r < 0.7 ? 'rappeler' : r < 0.85 ? 'estimation' : r < 0.93 ? 'mandat' : 'concurrent';
            e.historique.push({ statut: st === 'concurrent' ? 'contact' : (st === 'rappeler' || st === 'contact' ? st : 'contact'), date: t });
            if (st === 'estimation' || st === 'mandat') e.historique.push({ statut: 'estimation', date: horodatage(Math.max(0, j - 4), 10 + Math.floor(rnd() * 8)) });
            if (st === 'mandat') e.historique.push({ statut: 'mandat', date: horodatage(Math.max(0, j - 9), 10 + Math.floor(rnd() * 8)) });
            if (st === 'concurrent') e.historique.push({ statut: 'concurrent', date: horodatage(Math.max(0, j - 12), 11) });
            e.statut = st; e.date = e.historique[e.historique.length - 1].date;
            e.nom = rnd() < 0.75 ? choisir(noms) : '';
            e.tel = e.nom && rnd() < 0.6 ? '06 ' + pad(Math.floor(rnd() * 100)) + ' ' + pad(Math.floor(rnd() * 100)) + ' ' + pad(Math.floor(rnd() * 100)) + ' ' + pad(Math.floor(rnd() * 100)) : '';
            e.note = choisir(notes);
            e.occupant = rnd() < 0.8 ? 'proprietaire' : 'locataire';
            e.potentiel = st === 'mandat' || st === 'estimation' ? choisir(['chaud', 'chaud', 'tiede']) : choisir(['chaud', 'tiede', 'tiede', 'froid', 'froid', '']);
            e.projet = e.potentiel ? choisir(['vente', 'vente', 'vente', 'estimation', 'succession', 'achat', 'aucun']) : '';
            e.echeance = e.projet && e.projet !== 'aucun' ? choisir(['3m', '6m', '6m', '12m', 'plus']) : '';
          } else {
            e.statut = choisir(['prospectus', 'prospectus', 'prospectus', 'absent', 'absent', 'refus']);
            e.date = t; e.historique.push({ statut: e.statut, date: t });
          }
          if (rnd() < 0.18) e.etiquettes.push(choisir(tags));
        }
        items.push(e);
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
    var logements = 0, contacts = 0;
    var total = 0;
    items.forEach(function (e) {
      var p = w(e);
      par[e.statut] += p; total += p;
      if (e.statut !== 'aucun') logements += p;
      if (Statuts.CONTACTS.indexOf(e.statut) >= 0) contacts += p;
    });
    var faits = total - par.aucun;
    return { total: total, faits: faits, aFaire: par.aucun, par: par, logements: logements, contacts: contacts,
      tauxContact: faits ? Math.round(1000 * contacts / faits) / 10 : null };
  }

  // ---------- Entonnoir commercial : portes → contacts → estimations → mandats ----------
  // Une étape est « atteinte » si le statut actuel OU un passage de l'historique l'a atteinte.
  function atteint(e, statuts) {
    return statuts.indexOf(e.statut) >= 0 || (e.historique || []).some(function (h) { return statuts.indexOf(h.statut) >= 0; });
  }
  function entonnoir(items) {
    var faits = items.filter(function (e) { return e.statut !== 'aucun' && w(e) > 0; });
    var somme = function (l) { return l.reduce(function (t, e) { return t + w(e); }, 0); };
    var etapes = [
      { id: 'faits', libelle: 'Portes faites', n: somme(faits) },
      { id: 'contacts', libelle: 'Contacts', n: somme(faits.filter(function (e) { return atteint(e, Statuts.CONTACTS); })) },
      { id: 'estimations', libelle: 'Estimations', n: somme(faits.filter(function (e) { return atteint(e, ['estimation', 'mandat']); })) },
      { id: 'mandats', libelle: 'Mandats signés', n: somme(faits.filter(function (e) { return atteint(e, ['mandat']); })) }
    ];
    etapes.forEach(function (x, i) {
      x.pctPrecedent = i && etapes[i - 1].n ? Math.round(100 * x.n / etapes[i - 1].n) : null;
      x.pctTotal = etapes[0].n ? Math.round(1000 * x.n / etapes[0].n) / 10 : null;
    });
    return { etapes: etapes, concurrents: somme(faits.filter(function (e) { return e.statut === 'concurrent'; })) };
  }

  // ---------- Meilleurs créneaux : taux de contact par jour de la semaine et moment de la journée ----------
  var JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  var MOMENTS = [['Matin', 'avant 12 h'], ['Midi', '12 h – 14 h'], ['Après-midi', '14 h – 17 h'], ['Soir', 'après 17 h']];
  function moment(h) { return h < 12 ? 0 : h < 14 ? 1 : h < 17 ? 2 : 3; }
  function creneaux(items, periode) {
    var debut = periode ? jourDe(ajouterJours(aujourdhui(), -(periode - 1))) : '';
    var grille = JOURS.map(function () { return MOMENTS.map(function () { return { portes: 0, contacts: 0 }; }); });
    var total = 0;
    items.forEach(function (e) {
      // Chaque passage compte (historique) ; à défaut, le dernier statut et sa date
      var passages = e.historique && e.historique.length ? e.historique : (e.statut !== 'aucun' && e.date && w(e) > 0 ? [{ statut: e.statut, date: e.date, n: w(e) }] : []);
      passages.forEach(function (p) {
        if (!p.date || p.date.length < 13 || (debut && p.date.slice(0, 10) < debut)) return;
        if (['estimation', 'mandat', 'concurrent'].indexOf(p.statut) >= 0) return;   // étapes de suivi, pas des passages à la porte
        var d = dateDepuisJour(p.date.slice(0, 10)), c = grille[(d.getDay() + 6) % 7][moment(+p.date.slice(11, 13))];
        var n = p.n > 1 ? p.n : 1;
        c.portes += n; total += n;
        if (Statuts.CONTACTS.indexOf(p.statut) >= 0) c.contacts += n;
      });
    });
    var meilleur = null;
    grille.forEach(function (ligne, j) { ligne.forEach(function (c, m) {
      c.taux = c.portes ? c.contacts / c.portes : null;
      if (c.portes >= 5 && (!meilleur || c.taux > meilleur.taux)) meilleur = { jour: j, moment: m, taux: c.taux, portes: c.portes };
    }); });
    return { grille: grille, total: total, meilleur: meilleur, jours: JOURS, moments: MOMENTS };
  }

  // ---------- Qualification et étiquettes ----------
  function qualification(items) {
    var r = {};
    Object.keys(Statuts.QUALIF).forEach(function (champ) {
      r[champ] = {};
      items.forEach(function (e) { if (e[champ]) r[champ][e[champ]] = (r[champ][e[champ]] || 0) + 1; });
    });
    return r;
  }
  function etiquettes(items) {
    var c = {};
    items.forEach(function (e) { (e.etiquettes || []).forEach(function (t) { c[t] = (c[t] || 0) + 1; }); });
    return c;
  }
  // Prospects à travailler : potentiel chaud ou tiède, pas encore signés ni perdus ; les plus urgents d'abord
  function prospects(items) {
    var rangPot = { chaud: 0, tiede: 1 }, rangEch = { '3m': 0, '6m': 1, '12m': 2, plus: 3 };
    return items.filter(function (e) { return (e.potentiel === 'chaud' || e.potentiel === 'tiede') && ['mandat', 'concurrent', 'refus'].indexOf(e.statut) < 0; })
      .sort(function (a, b) {
        return (rangPot[a.potentiel] - rangPot[b.potentiel]) || ((a.echeance ? rangEch[a.echeance] : 9) - (b.echeance ? rangEch[b.echeance] : 9)) || (a.date < b.date ? 1 : -1);
      });
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
      if (b && b.par[e.statut] !== undefined) { b.par[e.statut] += w(e); b.total += w(e); }
    });
    return { buckets: buckets, granularite: granularite, auto: auto };
  }

  // ---------- Avancement par rue ----------

  function rues(items) {
    var m = {};
    items.forEach(function (e) {
      var nom = e.rue || '';
      var r = m[nom] || (m[nom] = { nom: nom, total: 0, faits: 0, par: {} });
      var p = w(e);
      r.total += p; if (e.statut !== 'aucun') r.faits += p;
      r.par[e.statut] = (r.par[e.statut] || 0) + p;
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
    var c = chiffres(sel);
    c.elements = sel;
    return c;
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
      if (j >= lun) semaine += w(e);
      if (j === j0) jour += w(e);
    });
    return { semaine: semaine, aujourdhui: jour, serie: serieJours(items, secteur) };
  }

  return {
    entonnoir: entonnoir, creneaux: creneaux, qualification: qualification, etiquettes: etiquettes, prospects: prospects,
    precedente: precedente, rythme: rythme,
    rueDe: rueDe, elementsReels: elementsReels, elementsDemo: elementsDemo, nomsDemo: NOMS_DEMO,
    filtrer: filtrer, chiffres: chiffres, serie: serie, rues: rues,
    jourDe: jourDe, aujourdhui: aujourdhui, dateDepuisJour: dateDepuisJour, poids: w
  };
})();
