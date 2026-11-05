/*
 * base.js – Vue « Base » : toutes les maisons connues et leurs données dans un grand tableau.
 * Colonnes au choix (et dans l'ordre voulu), tri sur plusieurs colonnes (Maj + clic), recherche,
 * filtres complets (statut, qualification, étiquettes, secteurs, dates, passages, contact…),
 * vues enregistrées, sélection avec actions groupées (statut, étiquette, carte, export CSV).
 * Le tableau est « virtualisé » : seules les lignes visibles sont dessinées (fluide avec des milliers de maisons).
 * Expose l'objet global Base.
 */
var Base = (function () {
  'use strict';

  var el = Ui.el, icone = Ui.icone;
  var HAUTEUR_LIGNE = 46;
  var racine, ouverte = false, lignes = [], filtrees = [], selection = {}, source = null;
  var pref = { colonnes: null, tri: [{ col: 'date', sens: -1 }], vues: [] };
  var etat = { recherche: '', filtres: {}, panneauFiltres: false };

  // ---------- Colonnes ----------
  function q(champ) { return function (r) { return Statuts.libelleQualif(champ, r[champ]); }; }
  function fmtDate(d) { if (!d) return ''; var p = d.slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0] + (d.length > 10 ? ' ' + d.slice(11, 16) : ''); }
  var POT = { chaud: ['flame', '#dc2626'], tiede: ['thermometer', '#d97706'], froid: ['snowflake', '#2563eb'] };
  var COLONNES = [
    { id: 'adresse', titre: 'Adresse', type: 'texte', l: 230, val: function (r) { return r.adresse || r.rue || ''; }, fixe: true,
      rendu: function (r) { var t = r.adresse || r.rue; if (t) { var x = el('span', null, t); x.title = t; return x; } return el('span', 'sous-titre', 'Adresse inconnue'); } },
    { id: 'nom', titre: 'Nom', type: 'texte', l: 160, val: function (r) { return r.nom; } },
    { id: 'tel', titre: 'Téléphone', type: 'texte', l: 140, val: function (r) { return r.tel; },
      rendu: function (r) { if (!r.tel) return null; var a = el('a', 'lien-tel', r.tel); a.href = 'tel:' + r.tel.replace(/[^0-9+]/g, ''); a.addEventListener('click', function (e) { e.stopPropagation(); }); return a; } },
    { id: 'statut', titre: 'Statut', type: 'enum', l: 180, val: function (r) { return Statuts.parId(r.statut).label; }, rendu: function (r) { return Ui.etiquetteStatut(Statuts.parId(r.statut)); } },
    { id: 'date', titre: 'Dernier passage', type: 'date', l: 150, val: function (r) { return r.date; }, texte: function (r) { return fmtDate(r.date); } },
    { id: 'premier', titre: 'Premier passage', type: 'date', l: 150, val: function (r) { return r.premier; }, texte: function (r) { return fmtDate(r.premier); } },
    { id: 'passages', titre: 'Passages', type: 'nombre', l: 96, val: function (r) { return r.passages; } },
    { id: 'potentiel', titre: 'Potentiel', type: 'enum', l: 120, val: q('potentiel'),
      rendu: function (r) { if (!r.potentiel) return null; var s = el('span', 'etiquette-statut'); s.style.setProperty('--c', POT[r.potentiel][1]); s.appendChild(icone(POT[r.potentiel][0])); s.appendChild(document.createTextNode(Statuts.libelleQualif('potentiel', r.potentiel))); return s; } },
    { id: 'projet', titre: 'Projet', type: 'enum', l: 150, val: q('projet') },
    { id: 'echeance', titre: 'Échéance', type: 'enum', l: 140, val: q('echeance'), triVal: function (r) { return { '3m': 1, '6m': 2, '12m': 3, plus: 4 }[r.echeance] || 9; } },
    { id: 'occupant', titre: 'Occupant', type: 'enum', l: 120, val: q('occupant') },
    { id: 'etiquettes', titre: 'Étiquettes', type: 'liste', l: 200, val: function (r) { return r.etiquettes.map(Etiquettes.nom).filter(Boolean).join(', '); },
      rendu: function (r) { var w = el('span', 'cellule-puces'); r.etiquettes.forEach(function (t) { var x = el('span', 'mini-etiquette', Etiquettes.nom(t)); x.style.setProperty('--c', Etiquettes.couleur(t)); w.appendChild(x); }); return w; } },
    { id: 'note', titre: 'Note', type: 'texte', l: 240, val: function (r) { return r.note; } },
    { id: 'logements', titre: 'Logements', type: 'nombre', l: 104, val: function (r) { return r.logements || ''; } },
    { id: 'secteurs', titre: 'Secteurs', type: 'liste', l: 160, val: function (r) { return r.secteursNoms; } },
    { id: 'rue', titre: 'Rue', type: 'texte', l: 180, val: function (r) { return r.rue; } },
    { id: 'type', titre: 'Type', type: 'texte', l: 130, val: function (r) { return r.type; } },
    { id: 'tournees', titre: 'Tournées', type: 'nombre', l: 96, val: function (r) { return r.nbTournees; } },
    { id: 'manuel', titre: 'Ajoutée à la main', type: 'bool', l: 150, val: function (r) { return r.manuel ? 'Oui' : ''; } },
    { id: 'lat', titre: 'Latitude', type: 'nombre', l: 110, val: function (r) { return r.lat === null ? '' : r.lat.toFixed(6); } },
    { id: 'lon', titre: 'Longitude', type: 'nombre', l: 110, val: function (r) { return r.lon === null ? '' : r.lon.toFixed(6); } },
    { id: 'id', titre: 'Identifiant', type: 'texte', l: 150, val: function (r) { return r.id; } }
  ];
  var PAR_DEFAUT = ['adresse', 'nom', 'tel', 'statut', 'date', 'passages', 'potentiel', 'projet', 'etiquettes', 'note'];
  function col(id) { return COLONNES.filter(function (c) { return c.id === id; })[0]; }
  function colonnesVisibles() { return (pref.colonnes || PAR_DEFAUT).map(col).filter(Boolean); }

  // ---------- Données ----------
  function charger() {
    if (source) return;
    var nbT = {};
    Tournees.liste().forEach(function (t) { var vu = {}; t.passages.forEach(function (p) { if (!vu[p.id]) { vu[p.id] = 1; nbT[p.id] = (nbT[p.id] || 0) + 1; } }); });
    lignes = Stats.elementsReels().map(function (e) {
      var f = DataImmo.batiment(e.id);
      e.passages = e.historique.length; e.premier = e.historique.length ? e.historique[0].date : '';
      e.secteursNoms = e.secteurs.map(function (s) { var x = Secteurs.liste().filter(function (y) { return y.id === s; })[0]; return x ? x.nom : ''; }).filter(Boolean).join(', ');
      e.type = e.id.indexOf('man/') === 0 ? 'Ajoutée à la main' : (f ? DataImmo.typeBatiment(f.properties) : '');
      e.manuel = e.id.indexOf('man/') === 0; e.nbTournees = nbT[e.id] || 0;
      return e;
    });
    source = true;
  }
  function invalider() { source = null; if (ouverte) { clearTimeout(invalider.t); invalider.t = setTimeout(function () { appliquer(); }, 200); } }

  // ---------- Filtres ----------
  // etat.filtres : { statut:[], potentiel:[], projet:[], echeance:[], occupant:[], etiquettes:[], modeEtiquettes:'une'|'toutes', secteurs:[],
  //   dateDe, dateA, jamais, passagesMin, passagesMax, avecNom, avecTel, avecNote, manuelles, qualifiees }
  function passeFiltres(r) {
    var f = etat.filtres;
    if (f.statut && f.statut.length && f.statut.indexOf(r.statut) < 0) return false;
    var enums = ['potentiel', 'projet', 'echeance', 'occupant'];
    for (var i = 0; i < enums.length; i++) { var k = enums[i]; if (f[k] && f[k].length && f[k].indexOf(r[k] || '—') < 0) return false; }
    if (f.etiquettes && f.etiquettes.length) {
      var a = r.etiquettes;
      if (f.modeEtiquettes === 'toutes' ? !f.etiquettes.every(function (t) { return a.indexOf(t) >= 0; }) : !f.etiquettes.some(function (t) { return a.indexOf(t) >= 0; })) return false;
    }
    if (f.secteurs && f.secteurs.length && !f.secteurs.some(function (s) { return s === '—' ? !r.secteurs.length : r.secteurs.indexOf(s) >= 0; })) return false;
    var j = r.date ? r.date.slice(0, 10) : '';
    if (f.jamais && j) return false;
    if (f.dateDe && (!j || j < f.dateDe)) return false;
    if (f.dateA && (!j || j > f.dateA)) return false;
    if (f.passagesMin !== undefined && f.passagesMin !== '' && r.passages < +f.passagesMin) return false;
    if (f.passagesMax !== undefined && f.passagesMax !== '' && r.passages > +f.passagesMax) return false;
    if (f.avecNom && !r.nom) return false;
    if (f.avecTel && !r.tel) return false;
    if (f.avecNote && !r.note) return false;
    if (f.manuelles && !r.manuel) return false;
    if (f.qualifiees && !r.potentiel) return false;
    return true;
  }
  function nbFiltres() {
    var f = etat.filtres, n = 0;
    Object.keys(f).forEach(function (k) { var v = f[k]; if (k === 'modeEtiquettes') return; if (Array.isArray(v) ? v.length : v !== undefined && v !== '' && v !== false) n++; });
    return n;
  }

  // ---------- Tri ----------
  function valeurTri(c, r) {
    if (c.triVal) return c.triVal(r);
    var v = c.val(r);
    if (c.type === 'nombre') return v === '' ? -Infinity : +v;
    return (v || '').toString().toLowerCase();
  }
  function trier() {
    var tri = pref.tri.filter(function (t) { return col(t.col); });
    filtrees.sort(function (a, b) {
      for (var i = 0; i < tri.length; i++) {
        var c = col(tri[i].col), x = valeurTri(c, a), y = valeurTri(c, b);
        // Les cellules vides vont toujours à la fin
        var vx = x === '' || x === -Infinity, vy = y === '' || y === -Infinity;
        if (vx !== vy) return vx ? 1 : -1;
        if (x < y) return -tri[i].sens; if (x > y) return tri[i].sens;
      }
      return 0;
    });
  }

  function appliquer() {
    if (!ouverte) return;
    charger();
    var qr = etat.recherche.trim().toLowerCase();
    filtrees = lignes.filter(function (r) {
      if (!passeFiltres(r)) return false;
      if (!qr) return true;
      return [r.adresse, r.rue, r.nom, r.tel, r.note, r.secteursNoms, Statuts.parId(r.statut).label, Statuts.libelleQualif('projet', r.projet)]
        .concat(r.etiquettes.map(Etiquettes.nom)).join(' ').toLowerCase().indexOf(qr) >= 0;
    });
    trier();
    Object.keys(selection).forEach(function (id) { if (!lignes.some(function (r) { return r.id === id; })) delete selection[id]; });
    dessinerTableau();
    majEntete();
  }

  // ---------- Rendu ----------
  var zone, corpsTable, teteTable, barreSel, compteur, puceFiltres;

  function majEntete() {
    compteur.textContent = Ui.nombre(filtrees.length) + (filtrees.length !== lignes.length ? ' sur ' + Ui.nombre(lignes.length) : '') + ' maison' + (lignes.length > 1 ? 's' : '');
    var n = nbFiltres();
    puceFiltres.textContent = n ? String(n) : ''; puceFiltres.hidden = !n;
    dessinerPucesActives();
    var ns = Object.keys(selection).length;
    barreSel.hidden = !ns;
    barreSel.querySelector('.nb-sel').textContent = ns + ' sélectionnée' + (ns > 1 ? 's' : '');
  }

  function dessinerTete() {
    teteTable.innerHTML = '';
    var tr = el('div', 'base-ligne base-tete-ligne'); tr.setAttribute('role', 'row');
    var cc = el('div', 'base-cellule base-case'); cc.setAttribute('role', 'columnheader');
    var tout = el('input'); tout.type = 'checkbox'; tout.setAttribute('aria-label', 'Tout sélectionner'); tout.id = 'base-tout';
    var nsel = Object.keys(selection).length;
    tout.checked = filtrees.length > 0 && filtrees.every(function (r) { return selection[r.id]; });
    tout.indeterminate = nsel > 0 && !tout.checked;
    tout.addEventListener('change', function () {
      if (tout.checked) filtrees.forEach(function (r) { selection[r.id] = true; }); else selection = {};
      dessinerTableau(); majEntete();
    });
    cc.appendChild(tout); tr.appendChild(cc);
    colonnesVisibles().forEach(function (c, i) {
      var th = el('div', 'base-cellule' + (i === 0 ? ' base-fixe' : '') + (c.type === 'nombre' ? ' num' : '')); th.setAttribute('role', 'columnheader');
      th.style.width = c.l + 'px';
      var k = pref.tri.map(function (t) { return t.col; }).indexOf(c.id);
      var b = Ui.bouton([c.titre], 'tri');
      if (k >= 0) {
        b.appendChild(icone(pref.tri[k].sens > 0 ? 'arrow-up' : 'arrow-down', 'ic-sm'));
        if (pref.tri.length > 1) b.appendChild(el('small', 'ordre-tri', String(k + 1)));
        th.setAttribute('aria-sort', pref.tri[k].sens > 0 ? 'ascending' : 'descending');
      }
      b.title = 'Trier (Maj + clic : tri secondaire)';
      b.dataset.col = c.id;
      b.addEventListener('click', function (e) {
        var i2 = pref.tri.map(function (t) { return t.col; }).indexOf(c.id);
        if (e.shiftKey) {
          if (i2 < 0) pref.tri.push({ col: c.id, sens: c.type === 'date' || c.type === 'nombre' ? -1 : 1 });
          else if (pref.tri[i2].sens === 1) pref.tri[i2].sens = -1; else pref.tri.splice(i2, 1);
        } else if (i2 === 0 && pref.tri.length === 1) pref.tri[0].sens = -pref.tri[0].sens;
        else pref.tri = [{ col: c.id, sens: c.type === 'date' || c.type === 'nombre' ? -1 : 1 }];
        memoriser(); trier(); dessinerTableau();
      });
      th.appendChild(b); tr.appendChild(th);
    });
    teteTable.appendChild(tr);
  }

  function cellule(c, r, i) {
    var td = el('div', 'base-cellule' + (i === 0 ? ' base-fixe' : '') + (c.type === 'nombre' ? ' num' : '')); td.setAttribute('role', 'cell');
    td.style.width = c.l + 'px';
    var n = c.rendu ? c.rendu(r) : null;
    if (n) td.appendChild(n); else { var t = c.texte ? c.texte(r) : c.val(r); td.textContent = t === undefined || t === null ? '' : t; if (t && c.type === 'texte') td.title = t; }
    return td;
  }

  function dessinerTableau() {
    dessinerTete();
    var largeur = 44 + colonnesVisibles().reduce(function (s, c) { return s + c.l; }, 0);
    teteTable.style.width = corpsTable.style.width = largeur + 'px';
    corpsTable.style.height = Math.max(1, filtrees.length) * HAUTEUR_LIGNE + 'px';
    zone.querySelector('.base-vide').hidden = !!filtrees.length;
    dessinerLignes(true);
  }

  var premierAffiche = -1, dernierAffiche = -1;
  function dessinerLignes(force) {
    var h = zone.clientHeight || 600, y = zone.scrollTop - HAUTEUR_LIGNE;   // l'en-tête collant occupe une ligne
    var debut = Math.max(0, Math.floor(y / HAUTEUR_LIGNE) - 8), fin = Math.min(filtrees.length, Math.ceil((y + h) / HAUTEUR_LIGNE) + 8);
    if (!force && debut === premierAffiche && fin === dernierAffiche) return;
    premierAffiche = debut; dernierAffiche = fin;
    var frag = document.createDocumentFragment(), cols = colonnesVisibles();
    for (var i = debut; i < fin; i++) {
      var r = filtrees[i];
      var tr = el('div', 'base-ligne' + (selection[r.id] ? ' choisie' : '')); tr.setAttribute('role', 'row');
      tr.style.transform = 'translateY(' + (i * HAUTEUR_LIGNE) + 'px)'; tr.dataset.id = r.id; tr.dataset.i = i;
      var cc = el('div', 'base-cellule base-case'); cc.setAttribute('role', 'cell'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!selection[r.id];
      cb.setAttribute('aria-label', 'Sélectionner ' + (r.adresse || r.id)); cc.appendChild(cb); tr.appendChild(cc);
      cols.forEach(function (c, k) { tr.appendChild(cellule(c, r, k)); });
      frag.appendChild(tr);
    }
    corpsTable.innerHTML = '';
    corpsTable.appendChild(frag);
  }

  // Sélection et ouverture (délégation d'évènements : un seul écouteur pour toutes les lignes)
  var dernierClic = null;
  function clicCorps(e) {
    var tr = e.target.closest('.base-ligne'); if (!tr) return;
    var r = filtrees[+tr.dataset.i]; if (!r) return;
    if (e.target.type === 'checkbox') {
      var i = +tr.dataset.i;
      if (e.shiftKey && dernierClic !== null) {   // Maj + clic : sélection d'une plage
        var a = Math.min(i, dernierClic), b = Math.max(i, dernierClic);
        for (var k = a; k <= b; k++) selection[filtrees[k].id] = e.target.checked;
      } else if (e.target.checked) selection[r.id] = true; else delete selection[r.id];
      Object.keys(selection).forEach(function (id) { if (!selection[id]) delete selection[id]; });
      dernierClic = i;
      dessinerLignes(true); dessinerTete(); majEntete();
      return;
    }
    if (e.target.closest('a')) return;
    ouvrirFiche(r);
  }
  function ouvrirFiche(r) {
    if (r.lat === null) { Notif.alerter('Position inconnue pour cette maison.'); return; }
    Coquille.allerVue('carte'); Outils.setMode('consulter');
    CarteImmo.getMap().setView([r.lat, r.lon], 19, { animate: false });
    Panneau.ouvrir(r.id);
  }

  // ---------- Panneau de filtres ----------
  function bascule(cle, valeur) {
    var l = etat.filtres[cle] || (etat.filtres[cle] = []);
    var i = l.indexOf(valeur); if (i >= 0) l.splice(i, 1); else l.push(valeur);
    appliquer(); dessinerFiltres();
  }
  function groupePuces(titre, cle, options) {
    var g = el('div', 'groupe-filtre'); g.appendChild(el('span', 'etiquette', titre));
    var p = el('div', 'puces');
    options.forEach(function (o) {
      var actif = (etat.filtres[cle] || []).indexOf(o.v) >= 0;
      var contenu = [o.t]; if (o.c) { var d = el('span', 'pastille'); contenu.unshift(d); }
      var b = Ui.bouton(contenu, 'puce', function () { bascule(cle, o.v); }, { 'aria-pressed': actif ? 'true' : 'false', 'data-filtre': cle + ':' + o.v });
      if (o.c) b.style.setProperty('--c', o.c);
      p.appendChild(b);
    });
    g.appendChild(p);
    return g;
  }
  function dessinerFiltres() {
    var pf = racine.querySelector('.base-filtres');
    pf.hidden = !etat.panneauFiltres;
    racine.querySelector('#base-btn-filtres').setAttribute('aria-expanded', etat.panneauFiltres ? 'true' : 'false');
    if (!etat.panneauFiltres) return;
    pf.innerHTML = '';
    var f = etat.filtres;
    pf.appendChild(groupePuces('Statut', 'statut', Statuts.ORDRE_CHOIX.map(function (s) { return { v: s, t: Statuts.parId(s).court, c: 'var(--st-' + s + ')' }; })));
    var vide = { v: '—', t: 'Non renseigné' };
    ['potentiel', 'projet', 'echeance', 'occupant'].forEach(function (k) {
      pf.appendChild(groupePuces(Statuts.QUALIF[k].titre, k, Statuts.QUALIF[k].valeurs.map(function (x) { return { v: x[0], t: x[1], c: k === 'potentiel' ? POT[x[0]][1] : null }; }).concat([vide])));
    });
    if (Etiquettes.liste().length) {
      var ge = groupePuces('Étiquettes', 'etiquettes', Etiquettes.liste().map(function (e) { return { v: e.id, t: e.nom, c: e.couleur }; }));
      var seg = el('div', 'segments segments-sm');
      [['une', 'Au moins une'], ['toutes', 'Toutes']].forEach(function (x) {
        seg.appendChild(Ui.bouton(x[1], '', function () { f.modeEtiquettes = x[0]; appliquer(); dessinerFiltres(); }, { 'aria-pressed': (f.modeEtiquettes || 'une') === x[0] ? 'true' : 'false' }));
      });
      ge.querySelector('.etiquette').appendChild(seg);
      pf.appendChild(ge);
    }
    if (Secteurs.liste().length) pf.appendChild(groupePuces('Secteurs', 'secteurs', Secteurs.liste().map(function (s) { return { v: s.id, t: s.nom, c: s.couleur }; }).concat([{ v: '—', t: 'Hors secteur' }])));
    // Dates et nombres
    var gd = el('div', 'groupe-filtre'); gd.appendChild(el('span', 'etiquette', 'Dernier passage'));
    var ld = el('div', 'ligne-champs');
    function champ(type, cle, texte, attrs) {
      var l = el('label', 'champ-mini'); l.appendChild(el('span', null, texte));
      var i = el('input', 'saisie'); i.type = type; i.value = f[cle] === undefined ? '' : f[cle]; i.dataset.filtre = cle;
      Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
      i.addEventListener('change', function () { f[cle] = i.value; appliquer(); });
      l.appendChild(i); return l;
    }
    ld.appendChild(champ('date', 'dateDe', 'Du')); ld.appendChild(champ('date', 'dateA', 'Au'));
    var pres = el('div', 'puces');
    [[7, '7 j'], [30, '30 j'], [90, '90 j']].forEach(function (x) {
      pres.appendChild(Ui.bouton('Moins de ' + x[1], 'puce', function () { f.dateDe = Stats.jourDe(new Date(Date.now() - (x[0] - 1) * 86400000)); f.dateA = ''; f.jamais = false; appliquer(); dessinerFiltres(); }));
    });
    pres.appendChild(Ui.bouton('Plus de 90 j', 'puce', function () { f.dateA = Stats.jourDe(new Date(Date.now() - 90 * 86400000)); f.dateDe = ''; f.jamais = false; appliquer(); dessinerFiltres(); }));
    gd.appendChild(ld); gd.appendChild(pres); pf.appendChild(gd);
    var gn = el('div', 'groupe-filtre'); gn.appendChild(el('span', 'etiquette', 'Nombre de passages'));
    var ln = el('div', 'ligne-champs'); ln.appendChild(champ('number', 'passagesMin', 'Au moins', { min: 0 })); ln.appendChild(champ('number', 'passagesMax', 'Au plus', { min: 0 }));
    gn.appendChild(ln); pf.appendChild(gn);
    var gb = el('div', 'groupe-filtre'); gb.appendChild(el('span', 'etiquette', 'Informations'));
    var pb = el('div', 'puces');
    [['avecNom', 'Avec un nom'], ['avecTel', 'Avec un téléphone'], ['avecNote', 'Avec une note'], ['qualifiees', 'Qualifiées'], ['manuelles', 'Ajoutées à la main'], ['jamais', 'Jamais visitées']].forEach(function (x) {
      pb.appendChild(Ui.bouton(x[1], 'puce', function () { f[x[0]] = !f[x[0]]; if (x[0] === 'jamais' && f.jamais) { f.dateDe = ''; f.dateA = ''; } appliquer(); dessinerFiltres(); }, { 'aria-pressed': f[x[0]] ? 'true' : 'false', 'data-filtre': x[0] }));
    });
    gb.appendChild(pb); pf.appendChild(gb);
  }

  // Résumé des filtres actifs (puces avec ×)
  function dessinerPucesActives() {
    var w = racine.querySelector('.base-filtres-actifs'); w.innerHTML = '';
    var f = etat.filtres, libs = [];
    function ajouter(t, retirer) { libs.push(1); w.appendChild(Ui.bouton([t, icone('x', 'ic-sm')], 'puce puce-active', function () { retirer(); appliquer(); dessinerFiltres(); }, { 'aria-label': 'Retirer le filtre ' + t })); }
    (f.statut || []).forEach(function (s) { ajouter(Statuts.parId(s).court, function () { bascule('statut', s); }); });
    ['potentiel', 'projet', 'echeance', 'occupant'].forEach(function (k) { (f[k] || []).forEach(function (v) { ajouter(Statuts.QUALIF[k].titre + ' : ' + (v === '—' ? 'non renseigné' : Statuts.libelleQualif(k, v).toLowerCase()), function () { bascule(k, v); }); }); });
    (f.etiquettes || []).forEach(function (t) { ajouter(Etiquettes.nom(t), function () { bascule('etiquettes', t); }); });
    (f.secteurs || []).forEach(function (s) { var x = Secteurs.liste().filter(function (y) { return y.id === s; })[0]; ajouter(s === '—' ? 'Hors secteur' : x ? x.nom : 'Secteur', function () { bascule('secteurs', s); }); });
    if (f.dateDe) ajouter('Depuis le ' + fmtDate(f.dateDe), function () { f.dateDe = ''; });
    if (f.dateA) ajouter('Jusqu\'au ' + fmtDate(f.dateA), function () { f.dateA = ''; });
    if (f.passagesMin) ajouter('≥ ' + f.passagesMin + ' passage(s)', function () { f.passagesMin = ''; });
    if (f.passagesMax) ajouter('≤ ' + f.passagesMax + ' passage(s)', function () { f.passagesMax = ''; });
    [['avecNom', 'Avec un nom'], ['avecTel', 'Avec un téléphone'], ['avecNote', 'Avec une note'], ['qualifiees', 'Qualifiées'], ['manuelles', 'Ajoutées à la main'], ['jamais', 'Jamais visitées']]
      .forEach(function (x) { if (f[x[0]]) ajouter(x[1], function () { f[x[0]] = false; }); });
    if (libs.length > 1) w.appendChild(Ui.bouton('Tout effacer', 'btn btn-sm btn-fantome', function () { etat.filtres = {}; appliquer(); dessinerFiltres(); }, { id: 'base-effacer-filtres' }));
    w.hidden = !libs.length;
  }

  // ---------- Colonnes (choix et ordre) ----------
  function menuColonnes(ancre) {
    var pop = racine.querySelector('.base-pop-colonnes');
    if (!pop.hidden) { pop.hidden = true; return; }
    function dessiner() {
      pop.innerHTML = '';
      pop.appendChild(el('h3', null, 'Colonnes affichées'));
      var vis = (pref.colonnes || PAR_DEFAUT).slice();
      var ordre = vis.concat(COLONNES.map(function (c) { return c.id; }).filter(function (id) { return vis.indexOf(id) < 0; }));
      var ul = el('ul', 'liste-colonnes');
      ordre.forEach(function (id) {
        var c = col(id), li = el('li');
        var l = el('label'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = vis.indexOf(id) >= 0; cb.disabled = !!c.fixe; cb.dataset.col = id;
        cb.addEventListener('change', function () {
          var v = (pref.colonnes || PAR_DEFAUT).slice();
          if (cb.checked) v.push(id); else v = v.filter(function (x) { return x !== id; });
          pref.colonnes = v; memoriser(); dessinerTableau(); dessiner();
        });
        l.appendChild(cb); l.appendChild(document.createTextNode(c.titre)); li.appendChild(l);
        var i = vis.indexOf(id);
        if (i > 0 && !c.fixe) {   // la colonne « Adresse » reste en premier
          li.appendChild(Ui.bouton(icone('arrow-up', 'ic-sm'), 'btn btn-fantome btn-icone btn-sm', function () {
            var v = vis.slice(); if (v[i - 1] === 'adresse') return; v.splice(i, 1); v.splice(i - 1, 0, id); pref.colonnes = v; memoriser(); dessinerTableau(); dessiner();
          }, { 'aria-label': 'Monter ' + c.titre }));
        }
        if (i >= 0 && i < vis.length - 1 && !c.fixe) {
          li.appendChild(Ui.bouton(icone('arrow-down', 'ic-sm'), 'btn btn-fantome btn-icone btn-sm', function () {
            var v = vis.slice(); v.splice(i, 1); v.splice(i + 1, 0, id); pref.colonnes = v; memoriser(); dessinerTableau(); dessiner();
          }, { 'aria-label': 'Descendre ' + c.titre }));
        }
        ul.appendChild(li);
      });
      pop.appendChild(ul);
      var p = el('div', 'actions');
      p.appendChild(Ui.bouton('Toutes', 'btn btn-sm', function () { pref.colonnes = COLONNES.map(function (c) { return c.id; }); memoriser(); dessinerTableau(); dessiner(); }));
      p.appendChild(Ui.bouton('Par défaut', 'btn btn-sm', function () { pref.colonnes = null; memoriser(); dessinerTableau(); dessiner(); }));
      pop.appendChild(p);
    }
    dessiner();
    pop.hidden = false;
  }

  // ---------- Vues enregistrées ----------
  function menuVues() {
    var pop = racine.querySelector('.base-pop-vues');
    if (!pop.hidden) { pop.hidden = true; return; }
    function dessiner() {
      pop.innerHTML = '';
      pop.appendChild(el('h3', null, 'Vues enregistrées'));
      if (!pref.vues.length) pop.appendChild(el('p', 'sous-titre', 'Enregistrez une combinaison de filtres, de tri et de colonnes pour la retrouver en un clic.'));
      var ul = el('ul', 'liste-vues');
      pref.vues.forEach(function (v, i) {
        var li = el('li');
        li.appendChild(Ui.bouton([icone('bookmark', 'ic-sm'), v.nom], 'lien-vue', function () {
          etat.filtres = JSON.parse(JSON.stringify(v.filtres || {})); etat.recherche = v.recherche || ''; pref.tri = JSON.parse(JSON.stringify(v.tri || pref.tri)); pref.colonnes = v.colonnes ? v.colonnes.slice() : null;
          racine.querySelector('#base-recherche').value = etat.recherche; memoriser(); pop.hidden = true; appliquer(); dessinerFiltres();
          Notif.afficher('Vue « ' + v.nom + ' » appliquée.', { cle: 'vue' });
        }, { 'data-vue': v.nom }));
        li.appendChild(Ui.bouton(icone('trash-2', 'ic-sm'), 'btn btn-fantome btn-icone btn-sm', function () { pref.vues.splice(i, 1); memoriser(); dessiner(); }, { 'aria-label': 'Supprimer la vue ' + v.nom }));
        ul.appendChild(li);
      });
      pop.appendChild(ul);
      var f = el('form', 'ajout-etiquette');
      var i = el('input', 'saisie'); i.placeholder = 'Nom de la vue (ex. Prospects chauds)'; i.maxLength = 50; i.id = 'base-nom-vue';
      f.appendChild(i);
      var b = Ui.bouton([icone('plus', 'ic-sm'), 'Enregistrer'], 'btn btn-primaire btn-sm'); b.type = 'submit'; f.appendChild(b);
      f.addEventListener('submit', function (e) {
        e.preventDefault(); var n = i.value.trim(); if (!n) return;
        pref.vues = pref.vues.filter(function (x) { return x.nom !== n; });
        pref.vues.push({ nom: n, filtres: JSON.parse(JSON.stringify(etat.filtres)), recherche: etat.recherche, tri: JSON.parse(JSON.stringify(pref.tri)), colonnes: pref.colonnes ? pref.colonnes.slice() : null });
        memoriser(); dessiner(); Notif.afficher('Vue « ' + n + ' » enregistrée.', { type: 'succes', cle: 'vue' });
      });
      pop.appendChild(f);
    }
    dessiner();
    pop.hidden = false;
  }

  // ---------- Actions groupées ----------
  function idsSelection() { return Object.keys(selection); }
  function exporter(idsChoisis) {
    var cols = colonnesVisibles(), rs = idsChoisis ? filtrees.filter(function (r) { return selection[r.id]; }) : filtrees;
    var cel = function (v) { v = v === undefined || v === null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v)) v = "'" + v; return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var txt = '﻿' + [cols.map(function (c) { return cel(c.titre); }).join(';')].concat(rs.map(function (r) {
      return cols.map(function (c) { return cel(c.texte ? c.texte(r) : c.val(r)); }).join(';');
    })).join('\r\n') + '\r\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    a.download = 'secteurimmo-base-' + Stats.jourDe(new Date()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    Notif.afficher(rs.length + ' ligne(s) exportée(s).', { type: 'succes', cle: 'export' });
  }
  function construireBarreSel() {
    barreSel.innerHTML = '';
    barreSel.appendChild(el('strong', 'nb-sel'));
    var st = el('select', 'saisie saisie-sm'); st.id = 'base-sel-statut'; st.setAttribute('aria-label', 'Changer le statut de la sélection');
    var o = el('option', null, 'Changer le statut…'); o.value = ''; st.appendChild(o);
    Statuts.ORDRE_CHOIX.forEach(function (s) { var x = el('option', null, Statuts.parId(s).label); x.value = s; st.appendChild(x); });
    st.addEventListener('change', function () {
      if (!st.value) return;
      var n = Statuts.modifier(idsSelection(), { statut: st.value });
      Notif.afficher(n + ' maison(s) → ' + Statuts.parId(st.value).label, { type: 'succes', action: { texte: 'Annuler', fn: function () { Outils.annuler(); } } });
      st.value = '';
    });
    barreSel.appendChild(st);
    var et = el('select', 'saisie saisie-sm'); et.id = 'base-sel-etiquette'; et.setAttribute('aria-label', 'Ajouter une étiquette à la sélection');
    var o2 = el('option', null, 'Ajouter une étiquette…'); o2.value = ''; et.appendChild(o2);
    Etiquettes.liste().forEach(function (e) { var x = el('option', null, e.nom); x.value = e.id; et.appendChild(x); });
    et.addEventListener('change', function () {
      var eid = et.value; if (!eid) return;
      var patchs = {};
      idsSelection().forEach(function (id) { var l = ((Statuts.get(id) || {}).etiquettes || []); if (l.indexOf(eid) < 0) patchs[id] = { etiquettes: l.concat([eid]) }; });
      var n = Statuts.modifierChacun(patchs);
      Notif.afficher('« ' + Etiquettes.nom(eid) + ' » ajoutée à ' + n + ' maison(s).', { type: 'succes', action: { texte: 'Annuler', fn: function () { Outils.annuler(); } } });
      et.value = '';
    });
    barreSel.appendChild(et);
    barreSel.appendChild(Ui.bouton([icone('map', 'ic-sm'), 'Voir sur la carte'], 'btn btn-sm', function () {
      var ids = idsSelection(), pts = ids.map(CarteImmo.centre).filter(Boolean);
      Coquille.allerVue('carte'); CarteImmo.mettreEnEvidence(ids);
      if (pts.length) CarteImmo.getMap().fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 19 });
      Notif.afficher(ids.length + ' maison(s) en évidence', { cle: 'trace', duree: 10000, action: { texte: 'Masquer', fn: function () { CarteImmo.mettreEnEvidence([]); } } });
    }, { id: 'base-sel-carte' }));
    barreSel.appendChild(Ui.bouton([icone('download', 'ic-sm'), 'Exporter'], 'btn btn-sm', function () { exporter(true); }, { id: 'base-sel-export' }));
    barreSel.appendChild(Ui.bouton('Désélectionner', 'btn btn-sm btn-fantome', function () { selection = {}; dessinerTableau(); majEntete(); }));
  }

  // ---------- Construction de la vue ----------
  function construire() {
    racine.innerHTML = '';
    var c = el('div', 'base-contenu');
    var tete = el('div', 'tableau-tete');
    var tt = el('div', 'titres'); var h = el('h1', null, 'Base des maisons'); h.id = 'titre-base'; tt.appendChild(h);
    compteur = el('p', 'sous-titre'); tt.appendChild(compteur); tete.appendChild(tt);
    c.appendChild(tete);

    var barre = el('div', 'base-barre');
    var rch = el('label', 'saisie-icone'); rch.appendChild(icone('search', 'ic-sm'));
    var inp = el('input', 'saisie'); inp.type = 'search'; inp.id = 'base-recherche'; inp.placeholder = 'Rechercher une adresse, un nom, une note, une étiquette…'; inp.value = etat.recherche;
    inp.setAttribute('aria-label', 'Rechercher dans la base');
    inp.addEventListener('input', function () { etat.recherche = inp.value; clearTimeout(inp.t); inp.t = setTimeout(appliquer, 120); });
    rch.appendChild(inp); barre.appendChild(rch);
    var bf = Ui.bouton([icone('list-filter', 'ic-sm'), 'Filtres'], 'btn', function () { etat.panneauFiltres = !etat.panneauFiltres; dessinerFiltres(); }, { id: 'base-btn-filtres', 'aria-expanded': 'false' });
    puceFiltres = el('span', 'badge'); puceFiltres.hidden = true; bf.appendChild(puceFiltres);
    barre.appendChild(bf);
    var wc = el('div', 'base-ancre');
    wc.appendChild(Ui.bouton([icone('columns-3', 'ic-sm'), 'Colonnes'], 'btn', function (e) { e.stopPropagation(); racine.querySelector('.base-pop-vues').hidden = true; menuColonnes(); }, { id: 'base-btn-colonnes' }));
    var pc = el('div', 'base-pop base-pop-colonnes verre'); pc.hidden = true; pc.addEventListener('click', function (e) { e.stopPropagation(); }); wc.appendChild(pc);
    barre.appendChild(wc);
    var wv = el('div', 'base-ancre');
    wv.appendChild(Ui.bouton([icone('bookmark', 'ic-sm'), 'Vues'], 'btn', function (e) { e.stopPropagation(); racine.querySelector('.base-pop-colonnes').hidden = true; menuVues(); }, { id: 'base-btn-vues' }));
    var pv = el('div', 'base-pop base-pop-vues verre'); pv.hidden = true; pv.addEventListener('click', function (e) { e.stopPropagation(); }); wv.appendChild(pv);
    barre.appendChild(wv);
    barre.appendChild(Ui.bouton([icone('download', 'ic-sm'), 'Exporter'], 'btn', function () { exporter(false); }, { id: 'base-btn-export', title: 'Exporter les lignes filtrées et les colonnes affichées (CSV)' }));
    c.appendChild(barre);
    var pf = el('div', 'base-filtres bloc'); pf.hidden = true; c.appendChild(pf);
    var fa = el('div', 'base-filtres-actifs'); fa.hidden = true; c.appendChild(fa);
    barreSel = el('div', 'base-selection verre'); barreSel.hidden = true; construireBarreSel(); c.appendChild(barreSel);

    zone = el('div', 'base-zone bloc'); zone.setAttribute('role', 'table'); zone.setAttribute('aria-label', 'Base des maisons');
    teteTable = el('div', 'base-tete'); teteTable.setAttribute('role', 'rowgroup');
    corpsTable = el('div', 'base-corps'); corpsTable.setAttribute('role', 'rowgroup');
    zone.appendChild(teteTable); zone.appendChild(corpsTable);
    var vide = el('div', 'vide base-vide'); var m = el('div', 'medaillon'); m.appendChild(icone('table', 'ic-lg')); vide.appendChild(m);
    vide.appendChild(el('strong', null, 'Aucune maison ne correspond')); vide.appendChild(el('span', null, 'Modifiez la recherche ou les filtres, ou chargez des maisons depuis la carte.'));
    zone.appendChild(vide);
    zone.addEventListener('scroll', function () { if (!zone.raf) zone.raf = requestAnimationFrame(function () { zone.raf = null; dessinerLignes(false); }); });
    corpsTable.addEventListener('click', clicCorps);
    c.appendChild(zone);
    racine.appendChild(c);
    document.addEventListener('click', function () { if (!ouverte) return; racine.querySelectorAll('.base-pop').forEach(function (p) { p.hidden = true; }); });
    // Échap ferme d'abord un menu ouvert (colonnes, vues) sans quitter la vue Base
    document.addEventListener('keydown', function (e) {
      if (!ouverte || e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      var ouverts = [].filter.call(racine.querySelectorAll('.base-pop'), function (p) { return !p.hidden; });
      if (!ouverts.length) return;
      e.stopPropagation(); e.preventDefault();
      ouverts.forEach(function (p) {
        p.hidden = true;
        var b = p.parentNode.querySelector('.btn'); if (b && p.contains(document.activeElement)) b.focus();
      });
    }, true);
  }

  function memoriser() { Store.kvSet('base', { colonnes: pref.colonnes, tri: pref.tri, vues: pref.vues }); }

  function ouvrir() {
    ouverte = true; source = null;
    if (!zone) construire();
    construireBarreSel();
    dessinerFiltres();
    appliquer();
  }

  function init() {
    racine = document.getElementById('vue-base');
    Coquille.enregistrerVue('base', { ouvrir: ouvrir, fermer: function () { ouverte = false; } });
    Statuts.surChangement(invalider);
    Etiquettes.surChangement(invalider);
    CarteImmo.surElements(invalider);
    Tournees.surChangement(function (t) { if (t === 'fin' || t === 'suppression' || t === 'chargement') invalider(); });
    window.addEventListener('resize', function () { if (ouverte) dessinerLignes(true); });
  }
  // Préférences restaurées au démarrage
  function chargerPreferences(d) {
    if (!d) return;
    if (Array.isArray(d.colonnes)) pref.colonnes = d.colonnes.filter(function (c) { return col(c); });
    if (Array.isArray(d.tri) && d.tri.length) pref.tri = d.tri.filter(function (t) { return t && col(t.col) && (t.sens === 1 || t.sens === -1); });
    if (Array.isArray(d.vues)) pref.vues = d.vues.slice(0, 30);
    if (!pref.tri.length) pref.tri = [{ col: 'date', sens: -1 }];
  }

  return { init: init, chargerPreferences: chargerPreferences, filtrer: function (f) { etat.filtres = f || {}; appliquer(); dessinerFiltres(); }, nbLignes: function () { return filtrees.length; } };
})();
