/*
 * defis.js – Gamification : points d'expérience et niveaux, records personnels, badges,
 * défis de la semaine (objectifs adaptés à votre rythme). Tout est recalculé à partir de vos données
 * (historique des passages, tournées, secteurs) : rien ne peut se désynchroniser.
 * Expose l'objet global Defis.
 */
var Defis = (function () {
  'use strict';

  var PORTE = ['prospectus', 'contact', 'absent', 'refus', 'rappeler'];
  var POINTS = { prospectus: 2, absent: 2, refus: 2, concurrent: 2, contact: 8, rappeler: 6, estimation: 30, mandat: 150 };
  var TITRES = [[1, 'Débutant'], [3, 'Arpenteur'], [5, 'Prospecteur'], [8, 'Prospecteur confirmé'], [12, 'Pro du terrain'], [16, 'Expert du secteur'], [20, 'Maître du quartier'], [25, 'Légende locale']];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function jourDe(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dateJour(j) { var p = j.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function lundi(d) { var r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() - (r.getDay() + 6) % 7); return r; }
  function cleSemaine(d) { return jourDe(lundi(d)); }

  // ---------- Collecte des données ----------
  // Tous les passages de l'historique : { id, statut, date ('AAAA-MM-JJTHH:mm'), jour }
  function passages() {
    var recs = Statuts._records(), r = [];
    Object.keys(recs).forEach(function (id) {
      (recs[id].historique || []).forEach(function (h) { if (h.date) r.push({ id: id, statut: h.statut, date: h.date, jour: h.date.slice(0, 10) }); });
    });
    return r;
  }

  function agregats() {
    var ps = passages(), tournees = Tournees.liste();
    var parJour = {}, contactsJour = {}, parSemaine = {}, mandatsMois = {}, contactsRJ = {};
    var a = { portes: 0, contacts: 0, estimations: 0, mandats: 0, tard: false, ps: ps, tournees: tournees };
    ps.forEach(function (p) {
      var porte = PORTE.indexOf(p.statut) >= 0;
      if (porte) {
        a.portes++;
        parJour[p.jour] = (parJour[p.jour] || 0) + 1;
        var s = cleSemaine(dateJour(p.jour)); parSemaine[s] = (parSemaine[s] || 0) + 1;
        if (p.date.slice(11, 16) >= '19:30') a.tard = true;
      }
      if (Statuts.CONTACTS.indexOf(p.statut) >= 0 && p.statut !== 'estimation' && p.statut !== 'mandat') { a.contacts++; contactsJour[p.jour] = (contactsJour[p.jour] || 0) + 1; }
      if (p.statut === 'contact' || p.statut === 'rappeler') contactsRJ[p.jour] = (contactsRJ[p.jour] || 0) + 1;
      if (p.statut === 'estimation') a.estimations++;
      if (p.statut === 'mandat') { a.mandats++; mandatsMois[p.jour.slice(0, 7)] = (mandatsMois[p.jour.slice(0, 7)] || 0) + 1; }
    });
    a.contactsRJ = contactsRJ;
    a.parJour = parJour; a.contactsJour = contactsJour; a.parSemaine = parSemaine; a.mandatsMois = mandatsMois;
    // Série la plus longue de jours consécutifs avec au moins une porte
    var jours = Object.keys(parJour).sort(), serie = 0, meilleure = { n: 0, jour: null };
    jours.forEach(function (j, i) {
      var prec = i ? dateJour(jours[i - 1]) : null, cur = dateJour(j);
      serie = prec && (cur - prec) / 86400000 <= 1.01 ? serie + 1 : 1;
      if (serie > meilleure.n) meilleure = { n: serie, jour: j };
    });
    a.serie = meilleure;
    a.statsTournees = tournees.map(function (t) { return { t: t, s: Tournees.stats(t) }; });
    // Contacts qualifiés (potentiel renseigné)
    var recs = Statuts._records();
    a.qualifies = Object.keys(recs).filter(function (id) { return recs[id].potentiel && Statuts.CONTACTS.indexOf(recs[id].statut) >= 0; }).length;
    return a;
  }

  // ---------- Records personnels ----------
  function max(objet) {
    var cle = null, v = 0;
    Object.keys(objet).forEach(function (k) { if (objet[k] > v) { v = objet[k]; cle = k; } });
    return { valeur: v, cle: cle };
  }
  function records(a) {
    a = a || agregats();
    var r = [];
    var pj = max(a.parJour), cj = max(a.contactsJour), ps = max(a.parSemaine), mm = max(a.mandatsMois);
    r.push({ cle: 'portes_jour', titre: 'Portes en un jour', ic: 'house', valeur: pj.valeur, date: pj.cle });
    r.push({ cle: 'contacts_jour', titre: 'Contacts en un jour', ic: 'message-circle', valeur: cj.valeur, date: cj.cle });
    r.push({ cle: 'portes_semaine', titre: 'Portes en une semaine', ic: 'calendar-range', valeur: ps.valeur, date: ps.cle, prefixeDate: 'semaine du ' });
    r.push({ cle: 'serie', titre: 'Jours d\'affilée', ic: 'flame', valeur: a.serie.n, date: a.serie.jour, unite: ' j' });
    r.push({ cle: 'mandats_mois', titre: 'Mandats en un mois', ic: 'file-signature', valeur: mm.valeur, date: mm.cle ? mm.cle + '-01' : null, mois: true });
    function meilleureTournee(cle, f, min) {
      var m = null;
      a.statsTournees.forEach(function (x) { var v = f(x); if (v !== null && v !== undefined && (!min || min(x)) && (!m || v > m.v)) m = { v: v, t: x.t }; });
      return m;
    }
    var tp = meilleureTournee('portes', function (x) { return x.s.portes; });
    var td = meilleureTournee('duree', function (x) { return x.s.duree; });
    var tr = meilleureTournee('rythme', function (x) { return x.s.rythme; }, function (x) { return x.s.duree >= 30 * 60000 && x.s.portes >= 15; });
    var tt = meilleureTournee('taux', function (x) { return x.s.tauxContact; }, function (x) { return x.s.portes >= 20; });
    var tk = meilleureTournee('distance', function (x) { return x.s.distance; });
    r.push({ cle: 'tournee_portes', titre: 'Portes en une tournée', ic: 'route', valeur: tp ? tp.v : 0, date: tp ? jourDe(new Date(tp.t.debut)) : null, tournee: tp && tp.t.id });
    r.push({ cle: 'tournee_rythme', titre: 'Meilleur rythme', ic: 'gauge', valeur: tr ? tr.v : 0, unite: ' portes/h', date: tr ? jourDe(new Date(tr.t.debut)) : null, tournee: tr && tr.t.id });
    r.push({ cle: 'tournee_taux', titre: 'Meilleur taux de contact', ic: 'target', valeur: tt ? tt.v : 0, unite: ' %', date: tt ? jourDe(new Date(tt.t.debut)) : null, tournee: tt && tt.t.id });
    r.push({ cle: 'tournee_duree', titre: 'Plus longue tournée', ic: 'timer', valeur: td ? Math.round(td.v / 60000) : 0, unite: ' min', date: td ? jourDe(new Date(td.t.debut)) : null, tournee: td && td.t.id });
    r.push({ cle: 'tournee_distance', titre: 'Distance en une tournée', ic: 'footprints', valeur: tk ? Math.round(tk.v / 100) / 10 : 0, unite: ' km', date: tk && tk.v ? jourDe(new Date(tk.t.debut)) : null, tournee: tk && tk.t.id });
    return r;
  }

  // ---------- Badges ----------
  function badges(a) {
    a = a || agregats();
    var st = a.statsTournees, secteurs = Secteurs.liste();
    var boucle = secteurs.some(function (s) { var x = Secteurs.stats(s.id); return x.total >= 20 && x.aFaire === 0; });
    // Semaines consécutives avec au moins une tournée
    var semT = {}; a.tournees.forEach(function (t) { semT[cleSemaine(new Date(t.debut))] = 1; });
    var ks = Object.keys(semT).sort(), suite = 0, meilleureSuite = 0;
    ks.forEach(function (k, i) { suite = i && (dateJour(k) - dateJour(ks[i - 1])) / 86400000 <= 7.01 ? suite + 1 : 1; meilleureSuite = Math.max(meilleureSuite, suite); });
    function seuil(id, titre, desc, ic, valeur, cible, xp) { return { id: id, titre: titre, desc: desc, ic: ic, ok: valeur >= cible, progression: Math.min(1, valeur / cible), valeur: valeur, cible: cible, xp: xp }; }
    function drapeau(id, titre, desc, ic, ok, xp) { return { id: id, titre: titre, desc: desc, ic: ic, ok: !!ok, progression: ok ? 1 : 0, xp: xp }; }
    return [
      seuil('premiere-tournee', 'Premier pas', 'Terminer une première tournée', 'play', a.tournees.length, 1, 20),
      seuil('portes-100', 'Centurion', 'Faire 100 portes', 'house', a.portes, 100, 30),
      seuil('portes-1000', 'Arpenteur', 'Faire 1 000 portes', 'footprints', a.portes, 1000, 100),
      seuil('portes-5000', 'Infatigable', 'Faire 5 000 portes', 'mountain', a.portes, 5000, 300),
      seuil('contact-1', 'Première rencontre', 'Obtenir un premier contact', 'message-circle', a.contacts, 1, 10),
      seuil('contacts-100', 'Bon contact', 'Rencontrer 100 personnes', 'user', a.contacts, 100, 100),
      seuil('estimation-1', 'Premier avis de valeur', 'Réaliser une estimation', 'calculator', a.estimations, 1, 40),
      seuil('mandat-1', 'Premier mandat', 'Signer un mandat', 'file-signature', a.mandats, 1, 100),
      seuil('mandats-10', 'Rentreur de mandats', 'Signer 10 mandats', 'crown', a.mandats, 10, 300),
      seuil('serie-5', 'Régulier', 'Prospecter 5 jours d\'affilée', 'flame', a.serie.n, 5, 50),
      seuil('serie-15', 'Inarrêtable', 'Prospecter 15 jours d\'affilée', 'rocket', a.serie.n, 15, 150),
      drapeau('leve-tot', 'Lève-tôt', 'Commencer une tournée avant 9 h', 'sunrise', a.tournees.some(function (t) { return new Date(t.debut).getHours() < 9; }), 30),
      drapeau('noctambule', 'Oiseau de nuit', 'Pointer une porte après 19 h 30', 'moon-star', a.tard, 30),
      drapeau('marathon', 'Marathon', 'Une tournée de 3 heures', 'timer', st.some(function (x) { return x.s.duree >= 3 * 3600000; }), 60),
      drapeau('sprint', 'Sprinteur', '60 portes à l\'heure sur une tournée d\'au moins 30 min', 'gauge', st.some(function (x) { return x.s.rythme >= 60 && x.s.duree >= 30 * 60000; }), 60),
      drapeau('secteur-boucle', 'Secteur bouclé', 'Faire 100 % d\'un secteur d\'au moins 20 maisons', 'badge-check', boucle, 80),
      seuil('explorateur', 'Explorateur', 'Créer 5 secteurs', 'pentagon', secteurs.length, 5, 40),
      seuil('qualificateur', 'Fin limier', 'Qualifier 25 contacts (potentiel)', 'target', a.qualifies, 25, 60),
      seuil('regularite', 'Métronome', 'Au moins une tournée par semaine, 4 semaines d\'affilée', 'calendar-check', meilleureSuite, 4, 80)
    ];
  }

  // ---------- Défis de la semaine ----------
  function graine(cle) { var h = 0; for (var i = 0; i < cle.length; i++) h = (h * 31 + cle.charCodeAt(i)) | 0; return Math.abs(h); }
  // Défis d'une semaine (lundi = cleSemaine) ; cibles adaptées à la moyenne des 4 semaines précédentes
  function defisSemaine(cle, a) {
    a = a || agregats();
    var deb = dateJour(cle), fin = new Date(deb.getFullYear(), deb.getMonth(), deb.getDate() + 7);
    var debS = jourDe(deb), finS = jourDe(fin);
    var dansSemaine = function (j) { return j >= debS && j < finS; };
    var moy = function (f) {
      var t = 0; for (var k = 1; k <= 4; k++) { var d = new Date(deb.getFullYear(), deb.getMonth(), deb.getDate() - 7 * k); t += f(jourDe(d), jourDe(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7))); }
      return t / 4;
    };
    // Somme d'un compteur journalier sur une semaine (rapide : pas de parcours de tous les passages)
    var compte = function (d1, d2, parJour) {
      var t = 0, d = dateJour(d1);
      for (var i = 0; i < 7; i++) { t += parJour[jourDe(d)] || 0; d.setDate(d.getDate() + 1); }
      return t;
    };
    var estPorte = function (p) { return PORTE.indexOf(p.statut) >= 0; };
    var estContact = function (p) { return ['contact', 'rappeler'].indexOf(p.statut) >= 0; };
    var ps = a.ps.filter(function (p) { return dansSemaine(p.jour); });
    var tSem = a.statsTournees.filter(function (x) { return dansSemaine(jourDe(new Date(x.t.debut))); });
    var portes = ps.filter(estPorte).length, contacts = ps.filter(estContact).length;
    var cPortes = Math.max(50, Math.ceil(moy(function (d1, d2) { return compte(d1, d2, a.parJour); }) * 1.15 / 10) * 10);
    var cContacts = Math.max(5, Math.ceil(moy(function (d1, d2) { return compte(d1, d2, a.contactsRJ); }) * 1.15));
    var jours = {}; ps.filter(estPorte).forEach(function (p) { jours[p.jour] = 1; });
    var recs = Statuts._records();
    var qualifies = {}; ps.filter(estContact).forEach(function (p) { if (recs[p.id] && recs[p.id].potentiel) qualifies[p.id] = 1; });
    var pool = [
      { id: 'contacts', titre: 'Rencontrer ' + cContacts + ' personnes', ic: 'message-circle', valeur: contacts, cible: cContacts, xp: 60 },
      { id: 'jours', titre: 'Prospecter 4 jours différents', ic: 'calendar-check', valeur: Object.keys(jours).length, cible: 4, xp: 50 },
      { id: 'soir', titre: '2 tournées commencées après 17 h', ic: 'sunset', valeur: tSem.filter(function (x) { return new Date(x.t.debut).getHours() >= 17; }).length, cible: 2, xp: 50 },
      { id: 'estimation', titre: 'Réaliser une estimation', ic: 'calculator', valeur: ps.filter(function (p) { return p.statut === 'estimation'; }).length, cible: 1, xp: 80 },
      { id: 'longue', titre: 'Une tournée de 2 heures', ic: 'timer', valeur: tSem.reduce(function (m, x) { return Math.max(m, x.s.duree); }, 0) >= 2 * 3600000 ? 1 : 0, cible: 1, xp: 50 },
      { id: 'qualif', titre: 'Qualifier 5 contacts de la semaine', ic: 'target', valeur: Object.keys(qualifies).length, cible: 5, xp: 60 },
      { id: 'taux', titre: '30 % de contact sur 40 portes ou plus', ic: 'gauge', valeur: portes >= 40 ? Math.min(30, Math.round(100 * contacts / portes)) : 0, cible: 30, xp: 70, unite: ' %' }
    ];
    var g = graine(cle), choisis = [];
    while (choisis.length < 2) { var d = pool[(g + choisis.length * 3) % pool.length]; if (choisis.indexOf(d) < 0) choisis.push(d); else g++; }
    var liste = [{ id: 'portes', titre: 'Faire ' + cPortes + ' portes', ic: 'house', valeur: portes, cible: cPortes, xp: 60 }].concat(choisis);
    liste.forEach(function (d) { d.ok = d.valeur >= d.cible; d.progression = Math.min(1, d.valeur / d.cible); d.semaine = cle; });
    return liste;
  }

  // ---------- Expérience et niveau ----------
  function seuilNiveau(n) { return Math.round(150 * Math.pow(n - 1, 1.5) / 10) * 10; }
  function titre(n) { var t = TITRES[0][1]; TITRES.forEach(function (x) { if (n >= x[0]) t = x[1]; }); return t; }
  function experience(a) {
    a = a || agregats();
    var xp = 0;
    a.ps.forEach(function (p) { xp += POINTS[p.statut] || 0; });
    xp += a.tournees.length * 20;
    badges(a).forEach(function (b) { if (b.ok) xp += b.xp; });
    // Défis réussis, semaine par semaine, depuis la première activité (2 ans au plus)
    var jours = Object.keys(a.parJour).sort();
    if (jours.length) {
      var d = lundi(dateJour(jours[0])), fin = lundi(new Date()), n = 0;
      while (d <= fin && n < 104) { defisSemaine(jourDe(d), a).forEach(function (x) { if (x.ok) xp += x.xp; }); d.setDate(d.getDate() + 7); n++; }
    }
    var niveau = 1; while (xp >= seuilNiveau(niveau + 1)) niveau++;
    var bas = seuilNiveau(niveau), haut = seuilNiveau(niveau + 1);
    return { xp: xp, niveau: niveau, titre: titre(niveau), bas: bas, haut: haut, progression: (xp - bas) / (haut - bas) };
  }

  // Tout l'état de progression en une fois
  function etat() {
    var a = agregats();
    return { experience: experience(a), records: records(a), badges: badges(a), defis: defisSemaine(cleSemaine(new Date()), a), agregats: a };
  }

  return { etat: etat, agregats: agregats, records: records, badges: badges, defisSemaine: defisSemaine, experience: experience, cleSemaine: cleSemaine, seuilNiveau: seuilNiveau, POINTS: POINTS };
})();
