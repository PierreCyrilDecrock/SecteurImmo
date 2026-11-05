/*
 * tournees-ui.js – Interface des tournées : bouton du dock, pilule « tournée en cours » (chrono, portes,
 * contacts, objectif), démarrage, bilan de fin (records battus, défis, XP), tournée oubliée, et vue
 * « Tournées » : progression (niveau, défis de la semaine, records, badges), statistiques et historique.
 * Expose l'objet global TourneesUi.
 */
var TourneesUi = (function () {
  'use strict';

  var el = Ui.el, icone = Ui.icone;
  var pilule, bouton, minuteur = null, vueOuverte = false, xpDebut = null, coucheTrace = null;

  // ---------- Formats ----------
  function duree(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    if (!m) return '< 1 min';
    return h ? h + ' h ' + String(m % 60).padStart(2, '0') : m + ' min';
  }
  function chrono(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function km(m) { return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m'; }
  function nb(n) { return Ui.nombre(n); }
  function dateLongue(t) { return new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function heure(t) { return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function nomTournee(t) {
    if (t.nom) return t.nom;
    var s = t.secteur && Secteurs.liste().filter(function (x) { return x.id === t.secteur; })[0];
    return s ? s.nom : 'Tournée du ' + new Date(t.debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  // ---------- Pilule « tournée en cours » ----------
  function majPilule() {
    var t = Tournees.active();
    bouton.setAttribute('aria-pressed', t ? 'true' : 'false');
    bouton.setAttribute('aria-label', t ? 'Tournée en cours' : 'Démarrer une tournée');
    bouton.setAttribute('data-tip', t ? 'Tournée en cours' : 'Démarrer une tournée');
    bouton.querySelector('use').setAttribute('href', 'vendor/lucide/icons.svg#' + (t ? 'timer' : 'play'));
    document.getElementById('point-tournee').hidden = !t;
    if (!t) { pilule.hidden = true; clearInterval(minuteur); minuteur = null; return; }
    var s = Tournees.stats(t), pause = Tournees.enPause();
    pilule.hidden = false;
    pilule.classList.toggle('en-pause', pause);
    pilule.querySelector('.tp-chrono').textContent = pause ? 'En pause · ' + chrono(s.duree) : chrono(s.duree);
    pilule.querySelector('.tp-portes').textContent = nb(s.portes);
    pilule.querySelector('.tp-contacts').textContent = nb(s.contacts);
    var obj = pilule.querySelector('.tp-objectif');
    obj.hidden = !t.objectif;
    if (t.objectif) obj.querySelector('span').style.width = Math.min(100, 100 * s.portes / t.objectif) + '%';
    var bp = pilule.querySelector('.tp-pause');
    bp.querySelector('use').setAttribute('href', 'vendor/lucide/icons.svg#' + (pause ? 'play' : 'pause'));
    bp.setAttribute('aria-label', pause ? 'Reprendre la tournée' : 'Mettre en pause');
    if (!minuteur) minuteur = setInterval(function () { if (Tournees.active()) majPilule(); }, 1000);
  }

  // ---------- Démarrage ----------
  function secteurSousLaVue() {
    var c = CarteImmo.getMap().getCenter();
    var s = Secteurs.liste().filter(function (x) { return CarteImmo.dansPolygone(c.lat, c.lng, x.points); })[0];
    return s ? s.id : '';
  }
  function ouvrirDemarrage() {
    if (Tournees.active()) { terminer(); return; }
    var dlg = document.getElementById('dlg-tournee');
    dlg.innerHTML = '';
    var tete = el('div', 'modale-tete');
    var m = el('span', 'medaillon-modale'); m.appendChild(icone('play')); tete.appendChild(m);
    var tt = el('div'); var h = el('h2', null, 'Nouvelle tournée'); h.id = 'dlg-tournee-titre'; tt.appendChild(h);
    tt.appendChild(el('p', 'sous-titre', 'Chronométrée, avec vos portes, contacts et records.')); tete.appendChild(tt);
    dlg.appendChild(tete);
    var corps = el('div', 'modale-corps formulaire');
    var sel = el('select', 'saisie'); sel.id = 'tournee-secteur';
    var o0 = el('option', null, 'Aucun secteur en particulier'); o0.value = ''; sel.appendChild(o0);
    Secteurs.liste().forEach(function (s) { var o = el('option', null, s.nom); o.value = s.id; sel.appendChild(o); });
    sel.value = secteurSousLaVue();
    var l1 = el('label', 'champ'); l1.appendChild(el('span', null, 'Secteur')); l1.appendChild(sel); corps.appendChild(l1);
    var obj = el('input', 'saisie'); obj.type = 'number'; obj.min = '1'; obj.max = '2000'; obj.id = 'tournee-objectif'; obj.placeholder = 'Ex. 60';
    var defi = Defis.etat().defis[0];
    if (defi && !defi.ok) obj.placeholder = 'Ex. ' + Math.max(20, Math.ceil((defi.cible - defi.valeur) / 3 / 5) * 5);
    var l2 = el('label', 'champ'); l2.appendChild(el('span', null, 'Objectif de portes (facultatif)')); l2.appendChild(obj); corps.appendChild(l2);
    function interrupteur(id, texte, coche) {
      var l = el('label', 'interrupteur'); var c = el('input'); c.type = 'checkbox'; c.id = id; c.checked = coche;
      l.appendChild(c); l.appendChild(el('span', 'piste')); l.appendChild(document.createTextNode(texte)); corps.appendChild(l); return c;
    }
    var cPos = interrupteur('tournee-position', 'Mesurer la distance parcourue (Ma position)', !!navigator.geolocation);
    var cPoint = interrupteur('tournee-pointage', 'Passer en pointage rapide', true);
    dlg.appendChild(corps);
    var pied = el('div', 'modale-pied');
    pied.appendChild(Ui.bouton('Annuler', 'btn btn-fantome', function () { dlg.close(); }));
    pied.appendChild(Ui.bouton([icone('play', 'ic-sm'), 'Démarrer'], 'btn btn-primaire', function () {
      dlg.close();
      xpDebut = Defis.experience().xp;
      var n = parseInt(obj.value, 10);
      Tournees.demarrer({ secteur: sel.value || null, objectif: n > 0 ? n : null });
      Tournees.active().xpDebut = xpDebut;
      if (cPos.checked) Position.demarrerSiArrete();
      if (cPoint.checked) Outils.setMode('tournee');
      Coquille.naviguer('carte');
      Notif.afficher('Tournée démarrée. Bonne prospection !', { type: 'succes', cle: 'tournee-etat' });
    }, { id: 'tournee-demarrer' }));
    dlg.appendChild(pied);
    dlg.showModal();
  }

  // ---------- Fin et bilan ----------
  function terminer(fin) {
    var t = Tournees.active();
    if (!t) return;
    var s0 = Tournees.stats(t, fin);
    if (!s0.maisons && !fin) {
      Ui.confirmer({ titre: 'Terminer cette tournée ?', message: 'Aucune maison n\'a été pointée : la tournée ne sera pas enregistrée.', bouton: 'Terminer', icone: 'square' })
        .then(function (ok) { if (ok) { Tournees.abandonner(); Notif.afficher('Tournée abandonnée.', { cle: 'tournee-etat' }); } });
      return;
    }
    // Records avant la fin (la tournée en cours n'y est pas encore)
    var avant = Defis.records();
    var xp0 = t.xpDebut !== undefined && t.xpDebut !== null ? t.xpDebut : xpDebut;
    var fini = Tournees.terminer(fin);
    if (Outils.mode() === 'tournee') Outils.setMode('consulter');
    var verif = Progression.verifier(true);   // badges et défis débloqués : affichés dans le bilan
    var apres = verif.etat.records;
    var battus = apres.filter(function (r) {
      var a = avant.filter(function (x) { return x.cle === r.cle; })[0];
      return r.tournee === fini.id && r.valeur > 0 && (!a || r.valeur > a.valeur);
    });
    bilan(fini, battus, verif, xp0);
  }

  function tuile(v, l, ic) {
    var d = el('div', 'tuile-tournee'); if (ic) d.appendChild(icone(ic, 'ic-sm'));
    d.appendChild(el('strong', 'num', v)); d.appendChild(el('span', null, l)); return d;
  }
  function jaugeStatuts(s) {
    var j = el('div', 'jauge multi'); j.style.height = '10px';
    Statuts.ORDRE_GRAPHIQUE.forEach(function (sid) {
      var n = s.par[sid]; if (!n) return;
      var seg = el('span'); seg.style.flexBasis = (100 * n / s.maisons) + '%'; seg.style.background = 'var(--st-' + sid + ')'; seg.title = Statuts.parId(sid).label + ' : ' + n; j.appendChild(seg);
    });
    return j;
  }
  function grilleStats(t, s) {
    var g = el('div', 'grille-tuiles');
    g.appendChild(tuile(duree(s.duree), 'durée', 'timer'));
    g.appendChild(tuile(nb(s.portes), 'portes', 'house'));
    g.appendChild(tuile(nb(s.contacts), 'contacts', 'message-circle'));
    g.appendChild(tuile(s.tauxContact === null ? '—' : String(s.tauxContact).replace('.', ',') + ' %', 'de contact', 'target'));
    g.appendChild(tuile(s.rythme === null ? '—' : nb(s.rythme), 'portes / heure', 'gauge'));
    g.appendChild(tuile(s.distance ? km(s.distance) : '—', 'parcourus', 'footprints'));
    if (s.estimations || s.mandats) g.appendChild(tuile(s.estimations + ' · ' + s.mandats, 'estim. · mandats', 'file-signature'));
    if (t.objectif) g.appendChild(tuile(Math.round(100 * s.portes / t.objectif) + ' %', 'de l\'objectif (' + t.objectif + ')', 'goal'));
    return g;
  }

  function bilan(t, battus, verif, xp0) {
    var s = Tournees.stats(t), e = verif.etat;
    var dlg = document.getElementById('dlg-bilan-tournee');
    dlg.innerHTML = '';
    var haut = el('div', 'bilan-tournee-haut' + (battus.length ? ' record' : ''));
    var med = el('div', 'medaillon'); med.appendChild(icone(battus.length ? 'trophy' : 'flag')); haut.appendChild(med);
    var h = el('h2', null, battus.length ? (battus.length > 1 ? battus.length + ' records battus !' : 'Nouveau record !') : 'Tournée terminée'); h.id = 'dlg-bilan-titre'; haut.appendChild(h);
    haut.appendChild(el('p', null, nomTournee(t) + ' · ' + heure(t.debut) + ' – ' + heure(t.fin)));
    dlg.appendChild(haut);
    var corps = el('div', 'modale-corps');
    corps.appendChild(grilleStats(t, s));
    if (s.maisons) corps.appendChild(jaugeStatuts(s));
    if (battus.length) {
      var ul = el('ul', 'liste-records');
      battus.forEach(function (r) { var li = el('li'); li.appendChild(icone('trophy', 'ic-sm')); li.appendChild(el('span', null, r.titre)); li.appendChild(el('strong', 'num', String(r.valeur).replace('.', ',') + (r.unite || ''))); ul.appendChild(li); });
      corps.appendChild(ul);
    }
    verif.nouveaux.filter(function (n) { return n.type !== 'niveau'; }).forEach(function (n) {
      var p = el('p', 'succes-ligne'); p.appendChild(icone(n.type === 'badge' ? 'award' : 'circle-check', 'ic-sm')); p.appendChild(document.createTextNode(n.titre)); corps.appendChild(p);
    });
    // Expérience gagnée
    var xpGagne = xp0 !== null && xp0 !== undefined ? e.experience.xp - xp0 : null;
    var bx = el('div', 'xp-bilan');
    bx.appendChild(el('strong', null, (xpGagne !== null ? '+' + nb(xpGagne) + ' XP' : nb(e.experience.xp) + ' XP')));
    bx.appendChild(el('span', null, 'Niveau ' + e.experience.niveau + ' · ' + e.experience.titre));
    var j = el('div', 'jauge'); var js = el('span'); js.style.setProperty('--c', 'var(--st-estimation)'); j.appendChild(js); bx.appendChild(j);
    requestAnimationFrame(function () { requestAnimationFrame(function () { js.style.width = Math.round(100 * e.experience.progression) + '%'; }); });
    corps.appendChild(bx);
    dlg.appendChild(corps);
    var pied = el('div', 'modale-pied');
    if (s.maisons) pied.appendChild(Ui.bouton([icone('map', 'ic-sm'), 'Voir sur la carte'], 'btn', function () { dlg.close(); voirSurCarte(t); }));
    pied.appendChild(Ui.bouton('Fermer', 'btn btn-primaire', function () { dlg.close(); }, { id: 'bilan-tournee-fermer' }));
    dlg.appendChild(pied);
    dlg.showModal();
    if (battus.length || verif.nouveaux.length) { Celebration.confettis(); Ui.vibrer([20, 40, 20]); }
  }

  // Maisons et trajet d'une tournée sur la carte
  function voirSurCarte(t) {
    var s = Tournees.stats(t), map = CarteImmo.getMap();
    Coquille.naviguer('carte');
    if (coucheTrace) { map.removeLayer(coucheTrace); coucheTrace = null; }
    var pts = s.ids.map(CarteImmo.centre).filter(Boolean);
    if (t.trace && t.trace.length > 1) { coucheTrace = L.polyline(t.trace, { color: '#2563eb', weight: 4, opacity: .8, dashArray: '1 8', lineCap: 'round', interactive: false }).addTo(map); pts = pts.concat(t.trace); }
    CarteImmo.mettreEnEvidence(s.ids);
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 19 });
    Notif.afficher(nomTournee(t) + ' : ' + s.maisons + ' maison' + (s.maisons > 1 ? 's' : '') + ' en évidence', { cle: 'trace', duree: 10000, action: { texte: 'Masquer', fn: function () {
      CarteImmo.mettreEnEvidence([]); if (coucheTrace) { map.removeLayer(coucheTrace); coucheTrace = null; }
    } } });
  }

  // Tournée restée ouverte (oubli) : proposée à la clôture au démarrage de l'application
  function verifierOubli() {
    var t = Tournees.active();
    if (!t || Date.now() - Tournees.derniereActivite(t) < 4 * 3600000) return;
    var fin = Math.max(Tournees.derniereActivite(t), t.debut + 60000);
    var dlg = document.getElementById('dlg-confirmer');
    Ui.confirmer({ titre: 'Tournée restée ouverte', icone: 'timer',
      message: 'La tournée commencée ' + dateLongue(t.debut) + ' à ' + heure(t.debut) + ' n\'a pas été terminée (' + Tournees.stats(t).maisons + ' maison(s)). La terminer à ' + heure(fin) + ', heure de la dernière maison pointée ?',
      bouton: 'Terminer à ' + heure(fin), annuler: 'La reprendre' })
      .then(function (ok) { if (ok) terminer(fin); });
    return dlg;
  }

  // ---------- Vue « Tournées » ----------
  function anneauNiveau(x) {
    var c = el('span'); c.style.display = 'flex'; c.style.flexDirection = 'column'; c.style.alignItems = 'center';
    c.appendChild(el('small', null, 'niveau')); c.appendChild(el('strong', 'num', String(x.niveau)));
    return Ui.anneau(Math.round(100 * x.progression), 104, 9, 'var(--st-estimation)', c);
  }
  function blocNiveau(e) {
    var x = e.experience, b = el('section', 'bloc s4 bloc-niveau');
    b.appendChild(anneauNiveau(x));
    var t = el('div', 'niveau-texte');
    t.appendChild(el('h3', null, x.titre));
    t.appendChild(el('p', 'num', nb(x.xp) + ' XP'));
    t.appendChild(el('p', 'sous-titre', nb(x.haut - x.xp) + ' XP avant le niveau ' + (x.niveau + 1)));
    var l = el('p', 'sous-titre', 'Porte : ' + Defis.POINTS.prospectus + ' · contact : ' + Defis.POINTS.contact + ' · estimation : ' + Defis.POINTS.estimation + ' · mandat : ' + Defis.POINTS.mandat + ' XP');
    l.style.fontSize = '11.5px'; t.appendChild(l);
    b.appendChild(t);
    return b;
  }
  function blocDefis(e) {
    var b = el('section', 'bloc s8');
    var tete = el('div', 'bloc-tete'); tete.appendChild(icone('swords', 'ic-sm')); tete.appendChild(el('h3', null, 'Défis de la semaine'));
    var j = 7 - ((new Date().getDay() + 6) % 7);
    tete.appendChild(el('span', 'sous-titre', j > 1 ? 'encore ' + j + ' jours' : 'dernier jour'));
    b.appendChild(tete);
    var c = el('div', 'bloc-corps'); var ul = el('ul', 'liste-defis');
    e.defis.forEach(function (d) {
      var li = el('li', d.ok ? 'reussi' : '');
      var ic = el('span', 'defi-ic'); ic.appendChild(icone(d.ok ? 'circle-check' : d.ic, 'ic-sm')); li.appendChild(ic);
      var tx = el('div', 'txt'); tx.appendChild(el('strong', null, d.titre));
      var jg = el('div', 'jauge'); var s = el('span'); s.style.setProperty('--c', d.ok ? 'var(--st-contact)' : 'var(--primaire)'); jg.appendChild(s); tx.appendChild(jg);
      requestAnimationFrame(function () { requestAnimationFrame(function () { s.style.width = Math.round(100 * d.progression) + '%'; }); });
      li.appendChild(tx);
      li.appendChild(el('span', 'defi-val num', Math.min(d.valeur, d.cible) + (d.unite || '') + ' / ' + d.cible + (d.unite || '')));
      li.appendChild(el('span', 'defi-xp', '+' + d.xp + ' XP'));
      ul.appendChild(li);
    });
    c.appendChild(ul); b.appendChild(c);
    return b;
  }
  function blocRecords(e) {
    var b = el('section', 'bloc s12');
    var tete = el('div', 'bloc-tete'); tete.appendChild(icone('trophy', 'ic-sm')); tete.appendChild(el('h3', null, 'Records personnels')); b.appendChild(tete);
    var c = el('div', 'bloc-corps'); var g = el('div', 'grille-records');
    e.records.forEach(function (r) {
      var d = el('div', 'record' + (r.valeur ? '' : ' vide'));
      var ic = el('span', 'record-ic'); ic.appendChild(icone(r.ic, 'ic-sm')); d.appendChild(ic);
      d.appendChild(el('strong', 'num', r.valeur ? String(r.valeur).replace('.', ',') + (r.unite || '') : '—'));
      d.appendChild(el('span', null, r.titre));
      if (r.date && r.valeur) {
        var dt = r.date.split('-');
        d.appendChild(el('small', null, r.mois ? new Date(+dt[0], +dt[1] - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : (r.prefixeDate || '') + dt[2] + '/' + dt[1] + '/' + dt[0]));
      }
      g.appendChild(d);
    });
    c.appendChild(g); b.appendChild(c);
    return b;
  }
  function blocBadges(e) {
    var b = el('section', 'bloc s12');
    var ok = e.badges.filter(function (x) { return x.ok; }).length;
    var tete = el('div', 'bloc-tete'); tete.appendChild(icone('award', 'ic-sm')); tete.appendChild(el('h3', null, 'Badges'));
    tete.appendChild(el('span', 'sous-titre', ok + ' / ' + e.badges.length)); b.appendChild(tete);
    var c = el('div', 'bloc-corps'); var g = el('div', 'grille-badges');
    e.badges.forEach(function (x) {
      var d = el('div', 'badge-jeu' + (x.ok ? ' obtenu' : '')); d.title = x.desc + (x.ok ? ' (obtenu)' : '');
      var m = el('span', 'badge-medaille'); m.appendChild(icone(x.ok ? x.ic : 'lock')); d.appendChild(m);
      d.appendChild(el('strong', null, x.titre)); d.appendChild(el('span', null, x.desc));
      if (!x.ok && x.progression > 0) { var jg = el('div', 'jauge'); var s = el('span'); s.style.width = Math.round(100 * x.progression) + '%'; jg.appendChild(s); d.appendChild(jg); }
      g.appendChild(d);
    });
    c.appendChild(g); b.appendChild(c);
    return b;
  }
  function blocHistorique() {
    var liste = Tournees.liste().slice().reverse();
    var b = el('section', 'bloc s12');
    var tete = el('div', 'bloc-tete'); tete.appendChild(icone('history', 'ic-sm')); tete.appendChild(el('h3', null, 'Historique des tournées'));
    var lab = el('label', 'interrupteur'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = Celebration.actives(); cb.id = 'celebrations';
    cb.addEventListener('change', function () { Celebration.activer(cb.checked); });
    lab.appendChild(cb); lab.appendChild(el('span', 'piste')); lab.appendChild(document.createTextNode('Confettis')); tete.appendChild(lab);
    b.appendChild(tete);
    var c = el('div', 'bloc-corps');
    if (!liste.length) {
      var v = el('div', 'vide'); var m = el('div', 'medaillon'); m.appendChild(icone('route', 'ic-lg')); v.appendChild(m);
      v.appendChild(el('strong', null, 'Aucune tournée pour l\'instant'));
      v.appendChild(el('span', null, 'Démarrez une tournée depuis la carte (bouton lecture du dock) : durée, portes, contacts et records seront enregistrés.'));
      c.appendChild(v); b.appendChild(c); return b;
    }
    // Totaux
    var tot = liste.reduce(function (a, t) { var s = Tournees.stats(t); a.d += s.duree; a.p += s.portes; a.c += s.contacts; a.k += s.distance; return a; }, { d: 0, p: 0, c: 0, k: 0 });
    var g = el('div', 'grille-tuiles');
    g.appendChild(tuile(nb(liste.length), 'tournées', 'route')); g.appendChild(tuile(duree(tot.d), 'sur le terrain', 'timer'));
    g.appendChild(tuile(tot.d >= 10 * 60000 ? nb(Math.round(tot.p / (tot.d / 3600000))) : '—', 'portes / heure en moyenne', 'gauge'));
    g.appendChild(tuile(tot.k ? km(tot.k) : '—', 'parcourus', 'footprints'));
    c.appendChild(g);
    var tw = el('div', 'table-defilante'); tw.style.marginTop = '14px';
    var tb = el('table', 'tableau liste'); var h = el('tr');
    ['Date', 'Tournée', 'Durée', 'Portes', 'Contacts', 'Taux', 'Rythme', 'Distance', 'Résultats'].forEach(function (x, i) { var th = el('th', i > 1 ? 'num' : null, x); th.scope = 'col'; h.appendChild(th); });
    var thead = el('thead'); thead.appendChild(h); tb.appendChild(thead);
    var body = el('tbody');
    liste.forEach(function (t) {
      var s = Tournees.stats(t), tr = el('tr');
      tr.appendChild(el('td', 'date', new Date(t.debut).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' · ' + heure(t.debut)));
      var td = el('td'); td.appendChild(Ui.bouton(nomTournee(t), 'lien-ligne', function () { detail(t); }, { 'data-tournee': t.id })); tr.appendChild(td);
      [duree(s.duree), nb(s.portes), nb(s.contacts), s.tauxContact === null ? '—' : String(s.tauxContact).replace('.', ',') + ' %', s.rythme === null ? '—' : s.rythme + '/h', s.distance ? km(s.distance) : '—',
        (s.estimations ? s.estimations + ' estim. ' : '') + (s.mandats ? s.mandats + ' mandat' + (s.mandats > 1 ? 's' : '') : '') || '—'].forEach(function (v) { tr.appendChild(el('td', 'num', v)); });
      body.appendChild(tr);
    });
    tb.appendChild(body); tw.appendChild(tb); c.appendChild(tw);
    b.appendChild(c);
    return b;
  }

  function detail(t) {
    var s = Tournees.stats(t), dlg = document.getElementById('dlg-bilan-tournee');
    dlg.innerHTML = '';
    var tete = el('div', 'modale-tete');
    var m = el('span', 'medaillon-modale'); m.appendChild(icone('route')); tete.appendChild(m);
    var tt = el('div'); tt.style.flex = '1';
    var inp = el('input', 'saisie titre-saisie'); inp.value = nomTournee(t); inp.setAttribute('aria-label', 'Nom de la tournée'); inp.id = 'tournee-nom';
    inp.addEventListener('change', function () { Tournees.renommer(t.id, inp.value); });
    tt.appendChild(inp);
    tt.appendChild(el('p', 'sous-titre', dateLongue(t.debut) + ' · ' + heure(t.debut) + ' – ' + heure(t.fin) + (t.pauses.length ? ' · ' + t.pauses.length + ' pause(s)' : '')));
    tete.appendChild(tt); dlg.appendChild(tete);
    var corps = el('div', 'modale-corps'); corps.appendChild(grilleStats(t, s)); if (s.maisons) corps.appendChild(jaugeStatuts(s)); dlg.appendChild(corps);
    var pied = el('div', 'modale-pied');
    pied.appendChild(Ui.bouton([icone('trash-2', 'ic-sm'), 'Supprimer'], 'btn btn-danger', function () {
      dlg.close();
      Ui.confirmer({ titre: 'Supprimer cette tournée ?', message: 'Ses statistiques seront effacées. Les maisons et leurs statuts ne sont pas touchés.', bouton: 'Supprimer', danger: true })
        .then(function (ok) { if (ok) { Tournees.supprimer(t.id); Notif.afficher('Tournée supprimée.', { type: 'succes' }); } });
    }, { 'data-action': 'supprimer' }));
    var esp = el('span'); esp.style.flex = '1'; pied.appendChild(esp);
    if (s.maisons) pied.appendChild(Ui.bouton([icone('map', 'ic-sm'), 'Voir sur la carte'], 'btn', function () { dlg.close(); voirSurCarte(t); }, { 'data-action': 'carte' }));
    pied.appendChild(Ui.bouton('Fermer', 'btn btn-primaire', function () { dlg.close(); }));
    dlg.appendChild(pied);
    dlg.showModal();
  }

  function dessinerVue() {
    if (!vueOuverte) return;
    var racine = document.getElementById('vue-tournees'), y = racine.scrollTop;
    var e = Defis.etat();
    racine.innerHTML = '';
    var c = el('div', 'tableau-contenu');
    var tete = el('div', 'tableau-tete');
    var tt = el('div', 'titres'); var h = el('h1', null, 'Tournées et défis'); h.id = 'titre-tournees'; tt.appendChild(h);
    tt.appendChild(el('p', 'sous-titre', 'Votre progression, vos records et l\'historique de vos tournées.'));
    tete.appendChild(tt);
    var actif = Tournees.active();
    tete.appendChild(Ui.bouton([icone(actif ? 'square' : 'play', 'ic-sm'), actif ? 'Terminer la tournée' : 'Démarrer une tournée'], 'btn btn-primaire btn-lg', function () {
      if (actif) terminer(); else { Coquille.naviguer('carte'); ouvrirDemarrage(); }
    }, { id: 'vue-tournee-action' }));
    c.appendChild(tete);
    var g = el('div', 'grille-tableau');
    [blocNiveau(e), blocDefis(e), blocRecords(e), blocBadges(e), blocHistorique()].forEach(function (x, i) { x.style.animationDelay = i * 60 + 'ms'; g.appendChild(x); });
    c.appendChild(g);
    racine.appendChild(c);
    racine.scrollTop = y;
  }

  function init() {
    pilule = document.getElementById('tournee-pilule'); bouton = document.getElementById('btn-tournee');
    bouton.addEventListener('click', function () { if (Tournees.active()) terminer(); else ouvrirDemarrage(); });
    pilule.querySelector('.tp-pause').addEventListener('click', function () { if (Tournees.enPause()) Tournees.reprendre(); else Tournees.pause(); });
    pilule.querySelector('.tp-fin').addEventListener('click', function () { terminer(); });
    Tournees.surChangement(function (type) {
      majPilule();
      if (type !== 'position') Store.kvSet('tournees', Tournees.exporter());
      else { clearTimeout(init.t); init.t = setTimeout(function () { Store.kvSet('tournees', Tournees.exporter()); }, 5000); }
      if (vueOuverte && type !== 'passage' && type !== 'position') dessinerVue();
    });
    Coquille.enregistrerVue('tournees', { ouvrir: function () { vueOuverte = true; dessinerVue(); }, fermer: function () { vueOuverte = false; } });
    Progression.surVerification(function () { if (vueOuverte) dessinerVue(); });
    majPilule();
  }

  return { init: init, demarrer: ouvrirDemarrage, terminer: terminer, verifierOubli: verifierOubli, voirSurCarte: voirSurCarte };
})();
