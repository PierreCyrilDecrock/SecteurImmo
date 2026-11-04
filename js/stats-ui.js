/*
 * stats-ui.js – Écran « Statistiques » : résumé, évolution, rues, liste, à rappeler.
 * Les filtres (période, secteur) s'appliquent à tous les onglets.
 * Les textes issus des données sont toujours insérés avec textContent (jamais innerHTML).
 * Expose l'objet global StatsUi.
 */
var StatsUi = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var ONGLETS = [['resume', 'Résumé'], ['evolution', 'Évolution'], ['rues', 'Rues'], ['liste', 'Liste'], ['rappels', 'À rappeler']];
  var LIGNES_MAX = 200;

  var racine, contenu, tip, alerter = function () {};
  var etat = { demo: false, periode: 0, secteur: '', onglet: 'resume', gran: 'jour', tri: 'date', ordre: -1, filtreStatut: '', recherche: '', ruesTexte: '', ruesNonTerminees: false, lignes: LIGNES_MAX };
  var items = [];          // éléments filtrés par période et secteur
  var tous = [];           // éléments non filtrés (réels ou démo)

  // ---------- Petits outils DOM ----------

  function el(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte !== undefined) e.textContent = texte;
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function couleur(id) { return 'var(--st-' + id + ')'; }
  function nombre(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function formatDate(d) {
    if (!d) return '';
    var p = d.slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0] + (d.length > 10 ? ' ' + d.slice(11, 16) : '');
  }
  function pastille(id) { var s = el('span', 'pastille'); s.style.background = couleur(id); s.style.borderColor = couleur(id); return s; }
  function nomSecteur(id) {
    if (Stats.nomsDemo[id]) return Stats.nomsDemo[id];
    var s = Secteurs.liste().filter(function (x) { return x.id === id; })[0];
    return s ? s.nom : '';
  }

  // ---------- Ouverture / données ----------

  function charger() {
    tous = etat.demo ? Stats.elementsDemo() : Stats.elementsReels();
    items = Stats.filtrer(tous, etat.periode, etat.secteur);
  }

  function majSecteurs() {
    var sel = document.getElementById('stats-secteur');
    sel.innerHTML = '';
    var o = el('option', null, 'Tous les secteurs'); o.value = ''; sel.appendChild(o);
    var liste = etat.demo ? Object.keys(Stats.nomsDemo).map(function (id) { return { id: id, nom: Stats.nomsDemo[id] }; }) : Secteurs.liste();
    liste.forEach(function (s) { var x = el('option', null, s.nom); x.value = s.id; sel.appendChild(x); });
    if (!liste.some(function (s) { return s.id === etat.secteur; })) etat.secteur = '';
    sel.value = etat.secteur;
  }

  function ouvrir() {
    Ui.fermerVolets(); Panneau.fermer();
    racine.hidden = false;
    document.getElementById('btn-stats').setAttribute('aria-pressed', 'true');
    // Le reste de la page est rendu inerte (clavier et lecteur d'écran restent dans les statistiques)
    Array.prototype.forEach.call(racine.parentNode.children, function (c) { if (c !== racine && c !== tip) c.inert = true; });
    majSecteurs(); dessiner();
    document.getElementById('stats-fermer').focus();
  }
  function fermer() {
    racine.hidden = true; tip.hidden = true;
    Array.prototype.forEach.call(racine.parentNode.children, function (c) { c.inert = false; });
    var b = document.getElementById('btn-stats'); b.setAttribute('aria-pressed', 'false'); b.focus();
  }

  function dessiner() {
    charger();
    document.getElementById('stats-demo-bandeau').hidden = !etat.demo;
    document.querySelectorAll('#stats-onglets [role=tab]').forEach(function (b) {
      var actif = b.dataset.onglet === etat.onglet;
      b.setAttribute('aria-selected', actif ? 'true' : 'false'); b.tabIndex = actif ? 0 : -1;
    });
    contenu.innerHTML = ''; tip.hidden = true;
    contenu.setAttribute('aria-labelledby', 'onglet-' + etat.onglet);
    ({ resume: resume, evolution: evolution, rues: ruesVue, liste: liste, rappels: rappels })[etat.onglet]();
  }

  // ---------- Résumé ----------

  function tuile(valeur, libelle, aide, statut) {
    var t = el('div', 'tuile');
    if (aide) t.title = aide;
    var v = el('div', 'tuile-valeur'); if (statut) v.appendChild(pastille(statut)); v.appendChild(document.createTextNode(valeur));
    t.appendChild(v); t.appendChild(el('div', 'tuile-libelle', libelle));
    return t;
  }

  function resume() {
    var c = Stats.chiffres(items);
    var g = el('div', 'tuiles');
    g.appendChild(tuile(nombre(c.faits), 'Maisons faites' + (etat.periode ? '' : ' (sur ' + nombre(c.total) + ')'), 'Toutes les maisons ayant un statut autre que « Non fait »'));
    g.appendChild(tuile(c.tauxContact === null ? '—' : String(c.tauxContact).replace('.', ',') + ' %', 'Taux de contact', 'Contacts personnels ÷ maisons faites'));
    g.appendChild(tuile(nombre(c.par.prospectus), 'Prospectus déposés', null, 'prospectus'));
    g.appendChild(tuile(nombre(c.par.contact), 'Contacts personnels', null, 'contact'));
    g.appendChild(tuile(nombre(c.par.rappeler), 'À rappeler', null, 'rappeler'));
    g.appendChild(tuile(nombre(c.par.absent), 'Absents / à repasser', null, 'absent'));
    g.appendChild(tuile(nombre(c.par.refus), 'Refus / Stop pub', null, 'refus'));
    g.appendChild(tuile(nombre(c.logements), 'Logements touchés', 'Somme des logements déclarés (1 par défaut)'));
    contenu.appendChild(g);

    if (!c.total) { contenu.appendChild(el('p', 'vide', 'Aucune donnée pour ces filtres.')); return; }
    contenu.appendChild(el('h3', null, 'Répartition' + (etat.periode ? '' : ' (avec les maisons non faites)')));
    var ordre = Statuts.ORDRE_GRAPHIQUE.concat(etat.periode ? [] : ['aucun']);
    var total = ordre.reduce(function (s, id) { return s + c.par[id]; }, 0);
    var barre = el('div', 'rep-barre'); barre.setAttribute('role', 'img');
    barre.setAttribute('aria-label', 'Répartition des ' + total + ' maisons par statut');
    ordre.forEach(function (id) {
      if (!c.par[id]) return;
      var s = el('span'); s.style.width = (100 * c.par[id] / total) + '%'; s.style.background = couleur(id);
      s.title = Statuts.parId(id).label + ' : ' + c.par[id];
      barre.appendChild(s);
    });
    contenu.appendChild(barre);
    var ul = el('ul', 'rep-legende');
    ordre.forEach(function (id) {
      var li = el('li'); li.appendChild(pastille(id));
      li.appendChild(el('span', 'rep-nom', Statuts.parId(id).label));
      li.appendChild(el('span', 'rep-n', nombre(c.par[id])));
      li.appendChild(el('span', 'rep-pct', total ? Math.round(100 * c.par[id] / total) + ' %' : ''));
      ul.appendChild(li);
    });
    contenu.appendChild(ul);
  }

  // ---------- Évolution (colonnes empilées par statut) ----------

  function echelle(max) {
    var pas = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].filter(function (p) { return max / p <= 5; })[0] || 1000;
    return { pas: pas, max: Math.max(pas, Math.ceil(max / pas) * pas) };
  }

  function colonneArrondie(x, y, w, h, r) { // coins arrondis en haut seulement ; carré sur la ligne de base
    r = Math.min(r, h, w / 2);
    return 'M' + x + ',' + (y + h) + 'L' + x + ',' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'L' + (x + w - r) + ',' + y + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'L' + (x + w) + ',' + (y + h) + 'Z';
  }

  function infobulle(b, evt, ancre) {
    tip.innerHTML = '';
    tip.appendChild(el('div', 'tip-titre', b.libelleLong));
    tip.appendChild(el('div', 'tip-total', nombre(b.total) + ' maison' + (b.total > 1 ? 's' : '')));
    Statuts.ORDRE_GRAPHIQUE.forEach(function (id) {
      if (!b.par[id]) return;
      var l = el('div', 'tip-ligne'); var cle = el('span', 'tip-cle'); cle.style.background = couleur(id);
      l.appendChild(cle); l.appendChild(el('span', 'tip-n', nombre(b.par[id]))); l.appendChild(el('span', 'tip-nom', Statuts.parId(id).label));
      tip.appendChild(l);
    });
    tip.hidden = false;
    var r = ancre.getBoundingClientRect(), t = tip.getBoundingClientRect();
    var x = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
    var y = Math.max(8, r.top - t.height - 6);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  function evolution() {
    var barreOutils = el('div', 'barre-outils');
    barreOutils.appendChild(el('span', null, 'Maisons faites par'));
    [['jour', 'Jour'], ['semaine', 'Semaine']].forEach(function (x) {
      var b = el('button', 'btn-seg', x[1]); b.type = 'button'; b.setAttribute('aria-pressed', etat.gran === x[0] ? 'true' : 'false');
      b.addEventListener('click', function () { etat.gran = x[0]; dessiner(); });
      barreOutils.appendChild(b);
    });
    contenu.appendChild(barreOutils);

    var s = Stats.serie(items, etat.periode, etat.gran);
    var totalPeriode = s.buckets.reduce(function (t, b) { return t + b.total; }, 0);
    contenu.appendChild(el('p', 'aide', nombre(totalPeriode) + ' maison(s) faite(s) sur la période' +
      (s.auto ? ' — regroupées par semaine (trop de jours à afficher).' : '.') +
      ' La date retenue est celle du dernier changement de statut de chaque maison.'));
    if (!totalPeriode) { contenu.appendChild(el('p', 'vide', 'Aucune maison faite sur cette période.')); return; }

    var largeur = Math.max(300, contenu.clientWidth || 600), hauteur = 260;
    var m = { g: 36, d: 8, h: 12, b: 40 }, W = largeur - m.g - m.d, H = hauteur - m.h - m.b;
    var max = s.buckets.reduce(function (mx, b) { return Math.max(mx, b.total); }, 0), ech = echelle(max);
    var y = function (v) { return m.h + H - v / ech.max * H; };
    var n = s.buckets.length, fente = W / n, barL = Math.min(24, Math.max(3, fente * 0.72));

    var c = svg('svg', { viewBox: '0 0 ' + largeur + ' ' + hauteur, width: largeur, height: hauteur, class: 'graphique', role: 'group', 'aria-label': 'Maisons faites par ' + s.granularite + ', colonnes empilées par statut' });
    for (var v = 0; v <= ech.max; v += ech.pas) {
      c.appendChild(svg('line', { x1: m.g, x2: m.g + W, y1: y(v), y2: y(v), class: 'grille' }));
      var t = svg('text', { x: m.g - 6, y: y(v) + 4, class: 'axe', 'text-anchor': 'end' }); t.textContent = v; c.appendChild(t);
    }
    var pasX = Math.max(1, Math.ceil(46 / fente));
    s.buckets.forEach(function (b, i) {
      var cx = m.g + fente * i + fente / 2, x0 = cx - barL / 2, cumul = 0;
      var gr = svg('g', { class: 'colonne' });
      Statuts.ORDRE_GRAPHIQUE.forEach(function (id) {
        var nb = b.par[id]; if (!nb) return;
        var haut = y(cumul + nb), hSeg = (y(cumul) - haut) - (cumul ? 2 : 0); // écart de 2 px entre segments empilés
        var estDernier = (cumul + nb) === b.total;
        var d = estDernier ? colonneArrondie(x0, haut, barL, Math.max(1, hSeg), 4) : 'M' + x0 + ',' + haut + 'h' + barL + 'v' + Math.max(1, hSeg) + 'h' + (-barL) + 'Z';
        var p = svg('path', { d: d, class: 'segment' }); p.style.fill = couleur(id);
        gr.appendChild(p);
        cumul += nb;
      });
      if (i % pasX === 0 || i === n - 1) {
        var lab = svg('text', { x: cx, y: hauteur - m.b + 16, class: 'axe', 'text-anchor': pasX > 1 || n > 14 ? 'end' : 'middle' });
        if (pasX > 1 || n > 14) lab.setAttribute('transform', 'rotate(-40 ' + cx + ' ' + (hauteur - m.b + 16) + ')');
        lab.textContent = b.label; c.appendChild(lab);
      }
      // Zone de survol plus large que la colonne (toute la fente, toute la hauteur) ; accessible au clavier
      var hit = svg('rect', { x: m.g + fente * i, y: m.h, width: fente, height: H, class: 'zone', tabindex: 0, role: 'img',
        'aria-label': b.libelleLong + ' : ' + b.total + ' maison(s)' });
      hit.addEventListener('pointerenter', function (e) { infobulle(b, e, gr.firstChild || hit); });
      hit.addEventListener('focus', function () { infobulle(b, null, gr.firstChild || hit); });
      hit.addEventListener('pointerleave', function () { tip.hidden = true; });
      hit.addEventListener('blur', function () { tip.hidden = true; });
      c.appendChild(gr); c.appendChild(hit);
    });
    c.appendChild(svg('line', { x1: m.g, x2: m.g + W, y1: y(0), y2: y(0), class: 'ligne-base' }));
    var cadre = el('div', 'cadre-graphique'); cadre.appendChild(c); contenu.appendChild(cadre);

    var leg = el('ul', 'rep-legende en-ligne');
    Statuts.ORDRE_GRAPHIQUE.forEach(function (id) {
      var li = el('li'); li.appendChild(pastille(id)); li.appendChild(el('span', 'rep-nom', Statuts.parId(id).label)); leg.appendChild(li);
    });
    contenu.appendChild(leg);

    // Vue tableau : les valeurs restent accessibles sans survol
    var det = el('details'); det.appendChild(el('summary', null, 'Afficher les valeurs en tableau'));
    var tb = el('table', 'tableau'); var th = el('tr'); th.appendChild(el('th', null, s.granularite === 'semaine' ? 'Semaine' : 'Jour'));
    Statuts.ORDRE_GRAPHIQUE.forEach(function (id) { th.appendChild(el('th', null, Statuts.parId(id).label)); }); th.appendChild(el('th', null, 'Total'));
    var thead = el('thead'); thead.appendChild(th); tb.appendChild(thead);
    var tbody = el('tbody');
    s.buckets.forEach(function (b) {
      if (!b.total) return;
      var tr = el('tr'); tr.appendChild(el('th', null, b.libelleLong));
      Statuts.ORDRE_GRAPHIQUE.forEach(function (id) { tr.appendChild(el('td', 'num', b.par[id])); });
      tr.appendChild(el('td', 'num', b.total)); tbody.appendChild(tr);
    });
    tb.appendChild(tbody); det.appendChild(tb); contenu.appendChild(det);
  }

  // ---------- Rues ----------

  function ruesVue() {
    var outils = el('div', 'barre-outils');
    var rech = el('input'); rech.type = 'search'; rech.placeholder = 'Chercher une rue…'; rech.value = etat.ruesTexte; rech.setAttribute('aria-label', 'Chercher une rue');
    rech.addEventListener('input', function () { etat.ruesTexte = rech.value; rendreLignesRues(); });
    var lab = el('label', 'case-inline'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = etat.ruesNonTerminees;
    cb.addEventListener('change', function () { etat.ruesNonTerminees = cb.checked; rendreLignesRues(); });
    lab.appendChild(cb); lab.appendChild(document.createTextNode(' Seulement les rues non terminées'));
    outils.appendChild(rech); outils.appendChild(lab); contenu.appendChild(outils);
    contenu.appendChild(el('p', 'aide', 'La rue vient de l\'adresse OpenStreetMap du bâtiment ou de celle trouvée à l\'ouverture de sa fiche. ' +
      'Les maisons dont la rue est inconnue sont regroupées à part : le total d\'une rue ne compte que les maisons dont la rue est connue.'));
    var zone = el('div', 'zone-rues'); contenu.appendChild(zone);

    function rendreLignesRues() {
      zone.innerHTML = '';
      var rs = Stats.rues(items).filter(function (r) {
        return (!etat.ruesNonTerminees || !r.termine) && (!etat.ruesTexte || r.nom.toLowerCase().indexOf(etat.ruesTexte.toLowerCase()) >= 0);
      });
      rs.sort(function (a, b) {
        if (!a.nom !== !b.nom) return a.nom ? -1 : 1;                       // rue inconnue en dernier
        if (a.termine !== b.termine) return a.termine ? 1 : -1;            // non terminées d'abord
        return (b.total - b.faits) - (a.total - a.faits) || a.nom.localeCompare(b.nom, 'fr');
      });
      var nonTerm = rs.filter(function (r) { return r.nom && !r.termine; }).length;
      zone.appendChild(el('p', 'aide', rs.length + ' rue(s) — ' + nonTerm + ' non terminée(s).'));
      if (!rs.length) { zone.appendChild(el('p', 'vide', 'Aucune rue ne correspond.')); return; }
      var tb = el('table', 'tableau');
      var h = el('tr'); ['Rue', 'Avancement', 'Faites', 'Reste'].forEach(function (x) { h.appendChild(el('th', null, x)); });
      var th = el('thead'); th.appendChild(h); tb.appendChild(th);
      var body = el('tbody');
      rs.forEach(function (r) {
        var tr = el('tr'); tr.appendChild(el('th', 'rue', r.nom || 'Rue inconnue'));
        var td = el('td'); var pb = el('div', 'prog'); pb.setAttribute('role', 'img'); pb.setAttribute('aria-label', r.pct + ' % faits');
        var f = el('span'); f.style.width = r.pct + '%'; pb.appendChild(f); td.appendChild(pb); td.appendChild(el('span', 'prog-pct', r.pct + ' %'));
        tr.appendChild(td); tr.appendChild(el('td', 'num', r.faits + ' / ' + r.total)); tr.appendChild(el('td', 'num', r.total - r.faits));
        body.appendChild(tr);
      });
      tb.appendChild(body); zone.appendChild(tb);
    }
    rendreLignesRues();
  }

  // ---------- Aller voir une maison sur la carte ----------

  function aller(e) {
    if (etat.demo) { alerter('Données de démonstration : ces maisons n\'existent pas sur la carte.'); return; }
    if (e.lat === null) { alerter('Position inconnue pour cette maison.'); return; }
    fermer();
    Outils.setMode('consulter');
    CarteImmo.getMap().setView([e.lat, e.lon], 19, { animate: false });
    if (DataImmo.batiment(e.id) || e.id.indexOf('man/') === 0) Panneau.ouvrir(e.id);
  }

  function celluleAdresse(e) {
    var td = el('td'); var b = el('button', 'btn-lien-ligne', e.adresse || e.rue || e.id);
    b.type = 'button'; b.title = 'Voir sur la carte'; b.addEventListener('click', function () { aller(e); });
    td.appendChild(b); return td;
  }
  function celluleStatut(e) {
    var td = el('td'); td.appendChild(pastille(e.statut)); td.appendChild(document.createTextNode(Statuts.parId(e.statut).label)); return td;
  }

  // ---------- Liste filtrable et triable ----------

  function liste() {
    var outils = el('div', 'barre-outils');
    var sel = el('select'); sel.setAttribute('aria-label', 'Filtrer par statut');
    var o0 = el('option', null, 'Tous les statuts'); o0.value = ''; sel.appendChild(o0);
    Statuts.LISTE.filter(function (s) { return s.id !== 'aucun'; }).forEach(function (s) { var o = el('option', null, s.label); o.value = s.id; sel.appendChild(o); });
    sel.value = etat.filtreStatut;
    sel.addEventListener('change', function () { etat.filtreStatut = sel.value; etat.lignes = LIGNES_MAX; rendre(); });
    var rech = el('input'); rech.type = 'search'; rech.placeholder = 'Chercher dans les notes et adresses…'; rech.value = etat.recherche; rech.setAttribute('aria-label', 'Chercher dans les notes et adresses');
    rech.addEventListener('input', function () { etat.recherche = rech.value; etat.lignes = LIGNES_MAX; rendre(); });
    var exp = el('button', 'btn-petit', '⬇ Exporter la sélection (CSV)'); exp.type = 'button'; exp.id = 'stats-export';
    exp.disabled = etat.demo; if (etat.demo) exp.title = 'Indisponible avec les données de démonstration';
    outils.appendChild(sel); outils.appendChild(rech); outils.appendChild(exp); contenu.appendChild(outils);
    var zone = el('div'); contenu.appendChild(zone);
    var selection = [];

    exp.addEventListener('click', function () { Echange.exporterCsv(selection.map(function (e) { return e.id; })); });

    function rendre() {
      zone.innerHTML = '';
      var q = etat.recherche.trim().toLowerCase();
      selection = items.filter(function (e) {
        return e.statut !== 'aucun' && (!etat.filtreStatut || e.statut === etat.filtreStatut) &&
          (!q || (e.note + ' ' + e.adresse + ' ' + e.rue).toLowerCase().indexOf(q) >= 0);
      });
      var cle = { date: function (e) { return e.date; }, adresse: function (e) { return (e.rue + ' ' + e.adresse).toLowerCase(); },
        statut: function (e) { return Statuts.parId(e.statut).label; }, secteur: function (e) { return e.secteurs.map(nomSecteur).join(', '); } }[etat.tri];
      selection.sort(function (a, b) {
        var x = cle(a), y = cle(b);
        return (x < y ? -1 : x > y ? 1 : 0) * etat.ordre;
      });
      exp.disabled = etat.demo || !selection.length;
      zone.appendChild(el('p', 'aide', nombre(selection.length) + ' maison(s).'));
      if (!selection.length) { zone.appendChild(el('p', 'vide', 'Aucune maison ne correspond.')); return; }
      var tb = el('table', 'tableau liste');
      var h = el('tr');
      [['date', 'Date'], ['adresse', 'Adresse'], ['statut', 'Statut'], ['secteur', 'Secteur'], [null, 'Note'], [null, 'Log.']].forEach(function (c) {
        var th = el('th'); th.scope = 'col';
        if (c[0]) {
          var b = el('button', 'tri', c[1] + (etat.tri === c[0] ? (etat.ordre > 0 ? ' ▲' : ' ▼') : '')); b.type = 'button';
          th.setAttribute('aria-sort', etat.tri === c[0] ? (etat.ordre > 0 ? 'ascending' : 'descending') : 'none');
          b.addEventListener('click', function () { if (etat.tri === c[0]) etat.ordre = -etat.ordre; else { etat.tri = c[0]; etat.ordre = c[0] === 'date' ? -1 : 1; } rendre(); });
          th.appendChild(b);
        } else th.textContent = c[1];
        h.appendChild(th);
      });
      var thead = el('thead'); thead.appendChild(h); tb.appendChild(thead);
      var body = el('tbody');
      selection.slice(0, etat.lignes).forEach(function (e) {
        var tr = el('tr'); tr.appendChild(el('td', 'date', formatDate(e.date))); tr.appendChild(celluleAdresse(e)); tr.appendChild(celluleStatut(e));
        tr.appendChild(el('td', null, e.secteurs.map(nomSecteur).filter(Boolean).join(', '))); tr.appendChild(el('td', 'note', e.note)); tr.appendChild(el('td', 'num', e.logements || ''));
        body.appendChild(tr);
      });
      tb.appendChild(body); zone.appendChild(tb);
      if (selection.length > etat.lignes) {
        var plus = el('button', 'btn-petit', 'Afficher plus (' + (selection.length - etat.lignes) + ' restantes)'); plus.type = 'button';
        plus.addEventListener('click', function () { etat.lignes += LIGNES_MAX; rendre(); }); zone.appendChild(plus);
      }
    }
    rendre();
  }

  // ---------- À rappeler ----------

  function rappels() {
    var rs = items.filter(function (e) { return e.statut === 'rappeler'; })
      .sort(function (a, b) { return (a.date || '9') < (b.date || '9') ? -1 : 1; }); // le plus ancien d'abord
    contenu.appendChild(el('p', 'aide', nombre(rs.length) + ' maison(s) à rappeler, de la plus ancienne à la plus récente.'));
    if (!rs.length) { contenu.appendChild(el('p', 'vide', 'Rien à rappeler pour ces filtres.')); return; }
    var tb = el('table', 'tableau liste'); var h = el('tr');
    ['Depuis', 'Date', 'Adresse', 'Note'].forEach(function (x) { h.appendChild(el('th', null, x)); });
    var thead = el('thead'); thead.appendChild(h); tb.appendChild(thead);
    var body = el('tbody'), auj = Stats.aujourdhui();
    rs.forEach(function (e) {
      var tr = el('tr');
      var jours = e.date ? Math.round((auj - Stats.dateDepuisJour(e.date.slice(0, 10))) / 86400000) : null;
      tr.appendChild(el('td', 'num', jours === null ? '' : (jours === 0 ? 'aujourd\'hui' : jours + ' j')));
      tr.appendChild(el('td', 'date', formatDate(e.date))); tr.appendChild(celluleAdresse(e)); tr.appendChild(el('td', 'note', e.note));
      body.appendChild(tr);
    });
    tb.appendChild(body); contenu.appendChild(tb);
  }

  // ---------- Initialisation ----------

  function init(fnAlerter) {
    alerter = fnAlerter;
    racine = document.getElementById('stats'); contenu = document.getElementById('stats-contenu'); tip = document.getElementById('stats-tip');
    var onglets = document.getElementById('stats-onglets');
    ONGLETS.forEach(function (o) {
      var b = el('button', 'onglet', o[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.onglet = o[0]; b.id = 'onglet-' + o[0];
      b.addEventListener('click', function () { etat.onglet = o[0]; dessiner(); });
      b.addEventListener('keydown', function (e) {
        var i = ONGLETS.map(function (x) { return x[0]; }).indexOf(etat.onglet);
        if (e.key === 'ArrowRight') i = (i + 1) % ONGLETS.length; else if (e.key === 'ArrowLeft') i = (i + ONGLETS.length - 1) % ONGLETS.length; else return;
        etat.onglet = ONGLETS[i][0]; dessiner(); document.getElementById('onglet-' + etat.onglet).focus();
      });
      onglets.appendChild(b);
    });
    document.getElementById('btn-stats').addEventListener('click', function () { if (racine.hidden) ouvrir(); else fermer(); });
    document.getElementById('stats-fermer').addEventListener('click', fermer);
    document.getElementById('stats-periode').addEventListener('change', function (e) { etat.periode = +e.target.value; etat.lignes = LIGNES_MAX; dessiner(); });
    document.getElementById('stats-secteur').addEventListener('change', function (e) { etat.secteur = e.target.value; etat.lignes = LIGNES_MAX; dessiner(); });
    document.getElementById('stats-demo').addEventListener('change', function (e) { etat.demo = e.target.checked; etat.secteur = ''; majSecteurs(); dessiner(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !racine.hidden) { e.stopPropagation(); fermer(); } }, true);
    var timer; window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { if (!racine.hidden && etat.onglet === 'evolution') dessiner(); }, 200); });
  }

  return { init: init, ouvrir: ouvrir, fermer: fermer };
})();
