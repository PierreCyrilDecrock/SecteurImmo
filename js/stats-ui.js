/*
 * stats-ui.js – Vue « Bilan » (tableau de bord) : indicateurs clés comparés à la période précédente,
 * objectif de la semaine, activité (colonnes empilées par statut), répartition (anneau), secteurs,
 * rues à terminer, journal filtrable avec export CSV. Les filtres (période, secteur) s'appliquent à tout.
 * Les textes issus des données sont toujours insérés avec textContent.
 * Expose l'objet global StatsUi.
 */
var StatsUi = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var LIGNES_MAX = 50;
  var el = Ui.el, icone = Ui.icone;
  var racine, tip;
  var etat = { demo: false, periode: 30, secteur: '', gran: 'jour', tri: 'date', ordre: -1, filtreStatut: '', recherche: '', lignes: LIGNES_MAX };
  var objectif = 80;
  var tous = [], items = [], ouvert = false;

  function svg(tag, attrs) { var e = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function couleur(id) { return 'var(--st-' + id + ')'; }
  function nombre(n) { return Ui.nombre(n); }
  function nomSecteur(id) {
    if (Stats.nomsDemo[id]) return Stats.nomsDemo[id];
    var s = Secteurs.liste().filter(function (x) { return x.id === id; })[0];
    return s ? s.nom : '';
  }
  function formatDate(d) { if (!d) return ''; var p = d.slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0] + (d.length > 10 ? ' ' + d.slice(11, 16) : ''); }
  function bloc(classes, titre, ic, droite) {
    var b = el('section', 'bloc ' + classes);
    var t = el('div', 'bloc-tete');
    if (ic) t.appendChild(icone(ic, 'ic-sm'));
    t.appendChild(el('h3', null, titre));
    if (droite) t.appendChild(droite);
    b.appendChild(t);
    var c = el('div', 'bloc-corps'); b.appendChild(c);
    return { bloc: b, corps: c };
  }
  function videBloc(texte, ic) {
    var v = el('div', 'vide'); var m = el('div', 'medaillon'); m.appendChild(icone(ic || 'inbox', 'ic-lg')); v.appendChild(m); v.appendChild(el('span', null, texte)); return v;
  }

  // ---------- Données ----------
  function charger() {
    tous = etat.demo ? Stats.elementsDemo() : Stats.elementsReels();
    items = Stats.filtrer(tous, etat.periode, etat.secteur);
  }

  // ---------- En-tête et filtres ----------
  function entete() {
    var t = el('div', 'tableau-tete');
    var titres = el('div', 'titres');
    var h = el('h1', null, 'Bilan'); h.id = 'titre-tableau'; titres.appendChild(h);
    var auj = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    titres.appendChild(el('p', 'sous-titre', auj.charAt(0).toUpperCase() + auj.slice(1) + ' · ' + (etat.periode ? etat.periode + ' derniers jours' : 'depuis le début')));
    t.appendChild(titres);

    var f = el('div', 'filtres');
    var seg = el('div', 'segments'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Période');
    [[7, '7 j'], [30, '30 j'], [90, '90 j'], [0, 'Tout']].forEach(function (p) {
      var b = Ui.bouton(p[1], '', function () { etat.periode = p[0]; etat.lignes = LIGNES_MAX; dessiner(); }, { 'aria-pressed': etat.periode === p[0] ? 'true' : 'false' });
      b.dataset.periode = p[0]; seg.appendChild(b);
    });
    f.appendChild(seg);
    var sel = el('select', 'saisie'); sel.id = 'stats-secteur'; sel.setAttribute('aria-label', 'Secteur');
    var o0 = el('option', null, 'Tous les secteurs'); o0.value = ''; sel.appendChild(o0);
    var liste = etat.demo ? Object.keys(Stats.nomsDemo).map(function (id) { return { id: id, nom: Stats.nomsDemo[id] }; }) : Secteurs.liste();
    liste.forEach(function (s) { var o = el('option', null, s.nom); o.value = s.id; sel.appendChild(o); });
    if (!liste.some(function (s) { return s.id === etat.secteur; })) etat.secteur = '';
    sel.value = etat.secteur;
    sel.addEventListener('change', function () { etat.secteur = sel.value; etat.lignes = LIGNES_MAX; dessiner(); });
    f.appendChild(sel);
    var demo = el('label', 'interrupteur'); var cb = el('input'); cb.type = 'checkbox'; cb.id = 'stats-demo'; cb.checked = etat.demo;
    cb.addEventListener('change', function () { etat.demo = cb.checked; etat.secteur = ''; dessiner(); });
    demo.appendChild(cb); demo.appendChild(el('span', 'piste')); demo.appendChild(document.createTextNode('Données d\'exemple'));
    f.appendChild(demo);
    t.appendChild(f);
    return t;
  }

  // ---------- Indicateurs ----------
  function ecart(actuel, precedent, suffixe, decimal) {
    if (precedent === null || precedent === undefined || actuel === null) return null;
    var d = actuel - precedent;
    var s = el('span', 'ecart ' + (d > 0 ? 'hausse' : d < 0 ? 'baisse' : 'stable'));
    s.appendChild(icone(d > 0 ? 'trending-up' : d < 0 ? 'trending-down' : 'arrow-right'));
    s.appendChild(document.createTextNode((d > 0 ? '+' : '') + (decimal ? String(Math.round(d * 10) / 10).replace('.', ',') : Math.round(d)) + (suffixe || '')));
    return s;
  }
  function kpi(ic, c, libelle, valeur, fmt, pied, onClick, i) {
    var k = el('div', 'bloc kpi' + (onClick ? ' cliquable' : ''));
    k.style.animationDelay = i * 50 + 'ms';
    if (onClick) { k.tabIndex = 0; k.setAttribute('role', 'button'); k.addEventListener('click', onClick); k.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }); }
    var t = el('div', 'kpi-tete'); var ki = el('span', 'kpi-ic'); ki.style.setProperty('--c', c); ki.appendChild(icone(ic, 'ic-sm')); t.appendChild(ki); t.appendChild(el('span', null, libelle));
    k.appendChild(t);
    var v = el('div', 'kpi-valeur'); k.appendChild(v);
    if (valeur === null) v.textContent = '—'; else Ui.compter(v, valeur, fmt);
    var p = el('div', 'kpi-pied'); (pied || []).forEach(function (x) { if (x) p.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    k.appendChild(p);
    return k;
  }
  function indicateurs() {
    var c = Stats.chiffres(items);
    var prec = Stats.precedente(tous, etat.periode, etat.secteur);
    var g = el('div', 'kpis');
    var vsTxt = prec ? 'vs ' + etat.periode + ' j précédents' : null;
    g.appendChild(kpi('house', 'var(--texte)', 'Maisons faites', c.faits, nombre,
      prec ? [ecart(c.faits, prec.faits), vsTxt] : ['sur ' + nombre(c.total) + ' maisons connues'], null, 0));
    g.appendChild(kpi('message-circle', 'var(--st-contact)', 'Taux de contact', c.tauxContact, function (v) { return String(Math.round(v * 10) / 10).replace('.', ',') + ' %'; },
      [prec && prec.tauxContact !== null && c.tauxContact !== null ? ecart(c.tauxContact, prec.tauxContact, ' pt', true) : null, 'contacts ÷ maisons faites'], null, 1));
    g.appendChild(kpi('user', 'var(--st-contact)', 'Contacts personnels', c.par.contact, nombre, prec ? [ecart(c.par.contact, prec.par.contact), vsTxt] : [nombre(c.par.prospectus) + ' prospectus déposés'], null, 2));
    g.appendChild(kpi('phone-call', 'var(--st-rappeler)', 'À rappeler', c.par.rappeler, nombre, ['Voir la liste', icone('arrow-right', 'ic-sm')],
      etat.demo ? null : function () { Coquille.ouvrirTiroir('rappels'); }, 3));
    return g;
  }

  // ---------- Objectif de la semaine ----------
  function blocObjectif() {
    var r = Stats.rythme(tous, etat.secteur);
    var b = bloc('s4', 'Objectif de la semaine', 'goal', Ui.bouton(icone('pencil', 'ic-sm'), 'btn btn-fantome btn-icone btn-sm', function () { editer(); }, { 'aria-label': 'Modifier l\'objectif', 'data-tip': 'Modifier', id: 'objectif-modifier' }));
    var o = el('div', 'objectif');
    var pct = objectif ? Math.min(100, Math.round(100 * r.semaine / objectif)) : 0;
    var centre = el('span'); centre.style.display = 'flex'; centre.style.flexDirection = 'column'; centre.style.alignItems = 'center';
    var nb = el('span', 'num'); Ui.compter(nb, r.semaine, nombre); centre.appendChild(nb); centre.appendChild(el('small', null, 'sur ' + nombre(objectif)));
    var an = Ui.anneau(pct, 132, 12, r.semaine >= objectif ? 'var(--st-contact)' : 'var(--primaire)', centre);
    o.appendChild(an);
    var tx = el('div', 'objectif-texte');
    tx.appendChild(el('p', 'sous-titre', r.semaine >= objectif ? 'Objectif atteint, bravo !' : 'Encore ' + nombre(objectif - r.semaine) + ' maison' + (objectif - r.semaine > 1 ? 's' : '') + ' d\'ici dimanche.'));
    var ms = el('div', 'mini-stats');
    function mini(ic, valeur, libelle) { var d = el('div', 'mini-stat'); var s = el('strong'); if (ic) s.appendChild(icone(ic)); s.appendChild(document.createTextNode(valeur)); d.appendChild(s); d.appendChild(el('span', null, libelle)); return d; }
    ms.appendChild(mini(null, nombre(r.aujourdhui), 'aujourd\'hui'));
    ms.appendChild(mini(r.serie ? 'flame' : null, r.serie + ' j', 'série d\'activité'));
    tx.appendChild(ms);
    o.appendChild(tx);
    b.corps.appendChild(o);

    function editer() {
      b.corps.innerHTML = '';
      var f = el('form'); f.style.display = 'flex'; f.style.gap = '8px'; f.style.alignItems = 'flex-end';
      var i = el('input', 'saisie'); i.type = 'number'; i.min = '1'; i.max = '5000'; i.value = objectif; i.id = 'objectif-saisie';
      var c = el('label', 'champ'); c.style.flex = '1'; c.appendChild(el('span', null, 'Maisons à faire par semaine')); c.appendChild(i);
      f.appendChild(c); f.appendChild(Ui.bouton('Enregistrer', 'btn btn-primaire', null, { type: 'submit' }));
      f.querySelector('button').type = 'submit';
      f.addEventListener('submit', function (e) { e.preventDefault(); var n = parseInt(i.value, 10); if (n > 0) definirObjectif(n); dessiner(); });
      b.corps.appendChild(f); i.focus(); i.select();
    }
    return b.bloc;
  }

  // ---------- Activité (colonnes empilées) ----------
  function echelle(max) {
    var pas = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].filter(function (p) { return max / p <= 4; })[0] || 1000;
    return { pas: pas, max: Math.max(pas, Math.ceil(max / pas) * pas) };
  }
  function colonneArrondie(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    return 'M' + x + ',' + (y + h) + 'L' + x + ',' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'L' + (x + w - r) + ',' + y + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'L' + (x + w) + ',' + (y + h) + 'Z';
  }
  function placerTip(ancre) {
    tip.hidden = false;
    var r = ancre.getBoundingClientRect(), t = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2)) + 'px';
    tip.style.top = Math.max(8, r.top - t.height - 8) + 'px';
  }
  function tipLignes(titre, total, lignes) {
    tip.innerHTML = '';
    tip.appendChild(el('div', 't', titre));
    tip.appendChild(el('div', 'v', total));
    lignes.forEach(function (l) {
      var d = el('div', 'l'); var k = el('i'); k.style.background = couleur(l.id); d.appendChild(k); d.appendChild(el('b', null, nombre(l.n))); d.appendChild(el('span', null, Statuts.parId(l.id).label)); tip.appendChild(d);
    });
  }

  function blocActivite() {
    var seg = el('div', 'segments');
    [['jour', 'Jour'], ['semaine', 'Semaine']].forEach(function (x) {
      seg.appendChild(Ui.bouton(x[1], '', function () { etat.gran = x[0]; dessiner(); }, { 'aria-pressed': etat.gran === x[0] ? 'true' : 'false', 'data-gran': x[0] }));
    });
    var b = bloc('s8 large', 'Activité', 'chart-column', seg);
    var s = Stats.serie(items, etat.periode, etat.gran);
    var total = s.buckets.reduce(function (t, x) { return t + x.total; }, 0);
    b.corps.appendChild(el('p', 'sous-titre', nombre(total) + ' maison' + (total > 1 ? 's' : '') + ' faite' + (total > 1 ? 's' : '') + (s.auto ? ' · regroupées par semaine' : '') + ' · date du dernier passage'));
    if (!total) { b.corps.appendChild(videBloc('Aucune maison faite sur cette période.', 'chart-column')); return b.bloc; }

    var cadre = el('div', 'cadre-graphique'); b.corps.appendChild(cadre);
    // Dessin après insertion (largeur réelle connue)
    requestAnimationFrame(function () {
      var largeur = Math.max(300, cadre.clientWidth || 640), hauteur = 230;
      var m = { g: 34, d: 6, h: 10, b: 36 }, W = largeur - m.g - m.d, H = hauteur - m.h - m.b;
      var max = s.buckets.reduce(function (mx, x) { return Math.max(mx, x.total); }, 0), ech = echelle(max);
      var y = function (v) { return m.h + H - v / ech.max * H; };
      var n = s.buckets.length, fente = W / n, barL = Math.min(24, Math.max(3, fente * 0.62));
      var c = svg('svg', { viewBox: '0 0 ' + largeur + ' ' + hauteur, width: largeur, height: hauteur, class: 'graphique', role: 'group', 'aria-label': 'Maisons faites par ' + s.granularite + ', colonnes empilées par statut' });
      for (var v = 0; v <= ech.max; v += ech.pas) {
        c.appendChild(svg('line', { x1: m.g, x2: m.g + W, y1: y(v), y2: y(v), class: 'grille' }));
        var tx = svg('text', { x: m.g - 8, y: y(v) + 4, class: 'axe', 'text-anchor': 'end' }); tx.textContent = v; c.appendChild(tx);
      }
      var pasX = Math.max(1, Math.ceil(52 / fente));
      s.buckets.forEach(function (bk, i) {
        var cx = m.g + fente * i + fente / 2, x0 = cx - barL / 2, cumul = 0;
        var gr = svg('g', { class: 'colonne' });
        Statuts.ORDRE_GRAPHIQUE.forEach(function (id) {
          var nb = bk.par[id]; if (!nb) return;
          var haut = y(cumul + nb), hSeg = (y(cumul) - haut) - (cumul ? 2 : 0);
          var dernier = cumul + nb === bk.total;
          var d = dernier ? colonneArrondie(x0, haut, barL, Math.max(1, hSeg), 4) : 'M' + x0 + ',' + haut + 'h' + barL + 'v' + Math.max(1, hSeg) + 'h' + (-barL) + 'Z';
          var p = svg('path', { d: d, class: 'segment' }); p.style.fill = couleur(id); p.style.animationDelay = Math.min(i * 12, 400) + 'ms';
          gr.appendChild(p); cumul += nb;
        });
        if (i % pasX === 0 || i === n - 1) {
          var lab = svg('text', { x: cx, y: hauteur - m.b + 18, class: 'axe', 'text-anchor': 'middle' });
          lab.textContent = bk.label.replace('Sem. du ', ''); c.appendChild(lab);
        }
        var hit = svg('rect', { x: m.g + fente * i, y: m.h, width: fente, height: H, class: 'zone', tabindex: 0, role: 'img', 'aria-label': bk.libelleLong + ' : ' + bk.total + ' maison(s)' });
        var montrer = function () {
          tipLignes(bk.libelleLong, nombre(bk.total) + ' maison' + (bk.total > 1 ? 's' : ''), Statuts.ORDRE_GRAPHIQUE.filter(function (id) { return bk.par[id]; }).map(function (id) { return { id: id, n: bk.par[id] }; }));
          placerTip(gr.firstChild || hit);
        };
        hit.addEventListener('pointerenter', montrer); hit.addEventListener('focus', montrer);
        hit.addEventListener('pointerleave', function () { tip.hidden = true; }); hit.addEventListener('blur', function () { tip.hidden = true; });
        c.appendChild(gr); c.appendChild(hit);
      });
      c.appendChild(svg('line', { x1: m.g, x2: m.g + W, y1: y(0), y2: y(0), class: 'ligne-base' }));
      cadre.appendChild(c);
    });

    var leg = el('ul', 'legende-graphique');
    Statuts.ORDRE_GRAPHIQUE.forEach(function (id) { var li = el('li'); var p = el('span', 'pastille'); p.style.setProperty('--c', couleur(id)); li.appendChild(p); li.appendChild(document.createTextNode(Statuts.parId(id).label)); leg.appendChild(li); });
    b.corps.appendChild(leg);
    var det = el('details', 'valeurs'); det.appendChild(el('summary', null, 'Voir les valeurs en tableau'));
    var tw = el('div', 'table-defilante'); tw.style.marginTop = '8px';
    var tb = el('table', 'tableau'); var th = el('tr'); th.appendChild(el('th', null, s.granularite === 'semaine' ? 'Semaine' : 'Jour'));
    Statuts.ORDRE_GRAPHIQUE.forEach(function (id) { th.appendChild(el('th', 'num', Statuts.parId(id).court)); }); th.appendChild(el('th', 'num', 'Total'));
    var thead = el('thead'); thead.appendChild(th); tb.appendChild(thead);
    var tbody = el('tbody');
    s.buckets.forEach(function (bk) {
      if (!bk.total) return;
      var tr = el('tr'); tr.appendChild(el('th', null, bk.libelleLong));
      Statuts.ORDRE_GRAPHIQUE.forEach(function (id) { tr.appendChild(el('td', 'num', bk.par[id])); }); tr.appendChild(el('td', 'num', bk.total));
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody); tw.appendChild(tb); det.appendChild(tw); b.corps.appendChild(det);
    return b.bloc;
  }

  // ---------- Répartition (anneau) ----------
  function arc(cx, cy, R, r, a0, a1) {
    function pt(rad, a) { return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; }
    var grand = a1 - a0 > Math.PI ? 1 : 0, p0 = pt(R, a0), p1 = pt(R, a1), p2 = pt(r, a1), p3 = pt(r, a0);
    return 'M' + p0 + 'A' + R + ',' + R + ' 0 ' + grand + ' 1 ' + p1 + 'L' + p2 + 'A' + r + ',' + r + ' 0 ' + grand + ' 0 ' + p3 + 'Z';
  }
  function blocRepartition() {
    var b = bloc('s4', 'Répartition', 'chart-pie');
    var c = Stats.chiffres(items);
    var ordre = Statuts.ORDRE_GRAPHIQUE.concat(etat.periode ? [] : ['aucun']);
    var total = ordre.reduce(function (t, id) { return t + c.par[id]; }, 0);
    if (!total) { b.corps.appendChild(videBloc('Rien à afficher pour ces filtres.', 'chart-pie')); return b.bloc; }
    var w = el('div', 'repartition');
    var T = 132, cx = T / 2, R = 62, r = 44;
    var s = svg('svg', { width: T, height: T, viewBox: '0 0 ' + T + ' ' + T, role: 'img', 'aria-label': 'Répartition de ' + total + ' maisons par statut' });
    var a = -Math.PI / 2, ecartA = ordre.filter(function (id) { return c.par[id]; }).length > 1 ? 0.025 : 0;
    ordre.forEach(function (id) {
      var n = c.par[id]; if (!n) return;
      var da = 2 * Math.PI * n / total;
      var p = svg('path', { d: arc(cx, cx, R, r, a + ecartA / 2, a + Math.max(da - ecartA / 2, ecartA / 2 + 0.001) - (da >= 2 * Math.PI ? 0.0001 : 0)) });
      p.style.fill = couleur(id);
      p.addEventListener('pointerenter', function () { tipLignes(Statuts.parId(id).label, nombre(n) + ' · ' + Math.round(100 * n / total) + ' %', []); placerTip(p); });
      p.addEventListener('pointerleave', function () { tip.hidden = true; });
      s.appendChild(p); a += da;
    });
    var t1 = svg('text', { x: cx, y: cx + 4, 'text-anchor': 'middle', class: 'centre-anneau' }); t1.textContent = nombre(total); s.appendChild(t1);
    var t2 = svg('text', { x: cx, y: cx + 20, 'text-anchor': 'middle', class: 'centre-libelle' }); t2.textContent = 'maisons'; s.appendChild(t2);
    w.appendChild(s);
    var ul = el('ul', 'liste-repartition');
    ordre.forEach(function (id) {
      var li = el('li'); var p = el('span', 'pastille'); p.style.setProperty('--c', couleur(id)); li.appendChild(p);
      li.appendChild(el('span', null, Statuts.parId(id).court)); li.appendChild(el('span', 'n', nombre(c.par[id]))); li.appendChild(el('span', 'p', Math.round(100 * c.par[id] / total) + ' %'));
      ul.appendChild(li);
    });
    w.appendChild(ul);
    b.corps.appendChild(w);
    return b.bloc;
  }

  // ---------- Secteurs et rues ----------
  function barre(nom, pct, droite, c) {
    var li = el('li'); var h = el('div', 'haut'); var n = el('strong', null, nom); n.title = nom; h.appendChild(n); h.appendChild(el('span', null, droite)); li.appendChild(h);
    var j = el('div', 'jauge'); var s = el('span'); s.style.setProperty('--c', c || 'var(--primaire)'); j.appendChild(s); li.appendChild(j);
    requestAnimationFrame(function () { requestAnimationFrame(function () { s.style.width = pct + '%'; }); });
    return li;
  }
  function blocSecteurs() {
    var b = bloc('s4', 'Secteurs', 'pentagon');
    if (etat.demo) {
      var ul0 = el('ul', 'liste-barres');
      Object.keys(Stats.nomsDemo).forEach(function (id) {
        var m = tous.filter(function (e) { return e.secteurs.indexOf(id) >= 0; }), f = m.filter(function (e) { return e.statut !== 'aucun'; }).length;
        ul0.appendChild(barre(Stats.nomsDemo[id], Math.round(100 * f / m.length), Math.round(100 * f / m.length) + ' %', 'var(--st-contact)'));
      });
      b.corps.appendChild(ul0); return b.bloc;
    }
    var ss = Secteurs.liste();
    if (!ss.length) { b.corps.appendChild(videBloc('Dessinez un secteur pour suivre sa couverture.', 'pentagon')); return b.bloc; }
    var ul = el('ul', 'liste-barres');
    ss.slice(0, 6).forEach(function (s) { var st = Secteurs.stats(s.id); ul.appendChild(barre(s.nom, st.pct || 0, st.pct === null ? 'non chargé' : st.pct + ' % · ' + nombre(st.aFaire) + ' à faire', s.couleur)); });
    b.corps.appendChild(ul);
    return b.bloc;
  }
  function blocRues() {
    var b = bloc('s4', 'Rues à terminer', 'route');
    // L'avancement d'une rue est une couverture : on compte toutes les maisons (toute période)
    var rs = Stats.rues(Stats.filtrer(tous, 0, etat.secteur)).filter(function (r) { return r.nom && !r.termine; })
      .sort(function (a, c) { return (c.total - c.faits) - (a.total - a.faits) || a.nom.localeCompare(c.nom, 'fr'); });
    if (!rs.length) { b.corps.appendChild(videBloc('Aucune rue en cours. La rue est connue grâce à l\'adresse des maisons.', 'route')); return b.bloc; }
    var ul = el('ul', 'liste-barres');
    rs.slice(0, 6).forEach(function (r) { ul.appendChild(barre(r.nom, r.pct, r.faits + '/' + r.total + ' · reste ' + (r.total - r.faits), 'var(--st-prospectus)')); });
    b.corps.appendChild(ul);
    if (rs.length > 6) b.corps.appendChild(el('p', 'sous-titre', '+ ' + (rs.length - 6) + ' autre' + (rs.length - 6 > 1 ? 's' : '') + ' rue' + (rs.length - 6 > 1 ? 's' : '')));
    return b.bloc;
  }

  // ---------- Journal ----------
  function aller(e) {
    if (etat.demo) { Notif.alerter('Données d\'exemple : ces maisons n\'existent pas sur la carte.'); return; }
    if (e.lat === null) { Notif.alerter('Position inconnue pour cette maison.'); return; }
    Coquille.allerVue('carte'); Outils.setMode('consulter');
    CarteImmo.getMap().setView([e.lat, e.lon], 19, { animate: false });
    if (DataImmo.batiment(e.id) || e.id.indexOf('man/') === 0) Panneau.ouvrir(e.id);
  }
  function blocJournal() {
    var exp = Ui.bouton([icone('download', 'ic-sm'), 'Exporter (CSV)'], 'btn btn-sm', null, { id: 'stats-export' });
    var b = bloc('s12', 'Journal des passages', 'list', exp);
    var barreJ = el('div', 'barre-journal');
    var rch = el('label', 'saisie-icone'); rch.appendChild(icone('search', 'ic-sm'));
    var inp = el('input', 'saisie'); inp.type = 'search'; inp.placeholder = 'Nom, adresse, note…'; inp.value = etat.recherche; inp.setAttribute('aria-label', 'Rechercher dans le journal'); inp.id = 'journal-recherche';
    rch.appendChild(inp); barreJ.appendChild(rch);
    var sel = el('select', 'saisie'); sel.setAttribute('aria-label', 'Filtrer par statut'); sel.id = 'journal-statut';
    var o0 = el('option', null, 'Tous les statuts'); o0.value = ''; sel.appendChild(o0);
    Statuts.ORDRE_CHOIX.filter(function (x) { return x !== 'aucun'; }).forEach(function (sid) { var o = el('option', null, Statuts.parId(sid).label); o.value = sid; sel.appendChild(o); });
    sel.value = etat.filtreStatut; barreJ.appendChild(sel);
    b.corps.appendChild(barreJ);
    var zone = el('div'); b.corps.appendChild(zone);
    var selection = [];
    exp.disabled = etat.demo;
    exp.addEventListener('click', function () { Echange.exporterCsv(selection.map(function (e) { return e.id; })); });
    inp.addEventListener('input', function () { etat.recherche = inp.value; etat.lignes = LIGNES_MAX; rendre(); });
    sel.addEventListener('change', function () { etat.filtreStatut = sel.value; etat.lignes = LIGNES_MAX; rendre(); });

    function rendre() {
      zone.innerHTML = '';
      var q = etat.recherche.trim().toLowerCase();
      selection = items.filter(function (e) {
        return e.statut !== 'aucun' && (!etat.filtreStatut || e.statut === etat.filtreStatut) && (!q || (e.nom + ' ' + e.note + ' ' + e.adresse + ' ' + e.rue + ' ' + e.tel).toLowerCase().indexOf(q) >= 0);
      });
      var cle = { date: function (e) { return e.date; }, adresse: function (e) { return (e.nom || e.adresse || '').toLowerCase(); }, statut: function (e) { return Statuts.parId(e.statut).label; } }[etat.tri];
      selection.sort(function (a, c) { var x = cle(a), y = cle(c); return (x < y ? -1 : x > y ? 1 : 0) * etat.ordre; });
      exp.disabled = etat.demo || !selection.length;
      if (!selection.length) { zone.appendChild(videBloc('Aucun passage ne correspond.', 'inbox')); return; }
      var tw = el('div', 'table-defilante'); var tb = el('table', 'tableau liste');
      var h = el('tr');
      [['date', 'Date'], ['adresse', 'Maison'], ['statut', 'Statut'], [null, 'Secteur'], [null, 'Note']].forEach(function (c) {
        var th = el('th'); th.scope = 'col';
        if (c[0]) {
          var bt = Ui.bouton([c[1], etat.tri === c[0] ? icone(etat.ordre > 0 ? 'chevron-down' : 'chevron-down', 'ic-sm') : null], 'tri');
          if (etat.tri === c[0] && etat.ordre > 0) bt.querySelector('.ic').style.transform = 'rotate(180deg)';
          th.setAttribute('aria-sort', etat.tri === c[0] ? (etat.ordre > 0 ? 'ascending' : 'descending') : 'none');
          bt.addEventListener('click', function () { if (etat.tri === c[0]) etat.ordre = -etat.ordre; else { etat.tri = c[0]; etat.ordre = c[0] === 'date' ? -1 : 1; } rendre(); });
          th.appendChild(bt);
        } else th.textContent = c[1];
        h.appendChild(th);
      });
      var thead = el('thead'); thead.appendChild(h); tb.appendChild(thead);
      var body = el('tbody');
      selection.slice(0, etat.lignes).forEach(function (e) {
        var tr = el('tr');
        tr.appendChild(el('td', 'date', formatDate(e.date)));
        var td = el('td'); var lien = Ui.bouton(e.nom || e.adresse || e.rue || 'Maison', 'lien-ligne', function () { aller(e); }, { title: 'Voir sur la carte' });
        td.appendChild(lien); if (e.nom && e.adresse) { td.appendChild(document.createElement('br')); td.appendChild(el('span', 'sous-titre', e.adresse)); }
        tr.appendChild(td);
        var ts = el('td'); ts.appendChild(Ui.etiquetteStatut(Statuts.parId(e.statut))); tr.appendChild(ts);
        tr.appendChild(el('td', null, e.secteurs.map(nomSecteur).filter(Boolean).join(', ')));
        tr.appendChild(el('td', 'note', e.note));
        body.appendChild(tr);
      });
      tb.appendChild(body); tw.appendChild(tb); zone.appendChild(tw);
      var pied = el('div', 'pied-journal'); pied.appendChild(el('span', null, nombre(selection.length) + ' passage' + (selection.length > 1 ? 's' : '')));
      if (selection.length > etat.lignes) pied.appendChild(Ui.bouton('Afficher plus', 'btn btn-sm', function () { etat.lignes += LIGNES_MAX; rendre(); }, { id: 'journal-plus' }));
      zone.appendChild(pied);
    }
    rendre();
    return b.bloc;
  }

  // ---------- Assemblage ----------
  function dessiner() {
    if (!ouvert) return;
    var y = racine.scrollTop;
    charger();
    tip.hidden = true;
    racine.innerHTML = '';
    var c = el('div', 'tableau-contenu');
    c.appendChild(entete());
    if (etat.demo) {
      var bd = el('div', 'bandeau-demo'); bd.id = 'stats-demo-bandeau'; bd.appendChild(icone('info', 'ic-sm'));
      bd.appendChild(document.createTextNode('Données d\'exemple : fictives, jamais enregistrées. Vos vraies données ne sont pas modifiées.'));
      c.appendChild(bd);
    }
    c.appendChild(indicateurs());
    var g = el('div', 'grille-tableau');
    g.appendChild(blocObjectif());
    g.appendChild(blocActivite());
    g.appendChild(blocRepartition());
    g.appendChild(blocSecteurs());
    g.appendChild(blocRues());
    g.appendChild(blocJournal());
    Array.prototype.forEach.call(g.children, function (x, i) { x.style.animationDelay = (150 + i * 50) + 'ms'; });
    c.appendChild(g);
    racine.appendChild(c);
    racine.scrollTop = y;
  }

  function definirObjectif(n, silencieux) {
    objectif = Math.max(1, Math.min(5000, n | 0));
    if (!silencieux) { Store.kvSet('objectif', objectif); Notif.afficher('Objectif : ' + objectif + ' maisons par semaine.', { type: 'succes', cle: 'objectif' }); }
  }

  function ouvrir() { ouvert = true; racine.scrollTop = 0; dessiner(); }
  function fermer() { ouvert = false; if (tip) tip.hidden = true; }

  function init() {
    racine = document.getElementById('tableau'); tip = document.getElementById('info-graphique');
    var t = null;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { if (ouvert) dessiner(); }, 250); });
    Statuts.surChangement(function () { if (ouvert) { clearTimeout(t); t = setTimeout(dessiner, 150); } });
  }

  return { init: init, ouvrir: ouvrir, fermer: fermer, definirObjectif: definirObjectif };
})();
