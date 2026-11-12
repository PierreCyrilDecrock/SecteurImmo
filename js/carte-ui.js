/*
 * carte-ui.js – Éléments flottants de la carte : choix du fond, zoom, barre de progression,
 * pastille « Charger les maisons », légende filtrable, accueil du premier lancement.
 * Expose l'objet global CarteUi.
 */
var CarteUi = (function () {
  'use strict';

  var map, pastille, legende, enChargement = false, resultatAffiche = null, timerResultat = null;
  var CLE_LEGENDE = 'secteurimmo-legende-repliee';

  // ---------- Fonds de carte ----------
  function initFonds() {
    var btn = document.getElementById('btn-fonds'), pop = document.getElementById('popover-fonds');
    function dessiner() {
      pop.innerHTML = '';
      pop.appendChild(Ui.el('h3', null, 'Fond de carte'));
      CarteImmo.fonds().forEach(function (f) {
        var b = Ui.el('button', 'choix-fond'); b.type = 'button'; b.dataset.fond = f.id;
        b.setAttribute('aria-pressed', CarteImmo.fond() === f.id ? 'true' : 'false');
        b.appendChild(Ui.el('span', 'vignette ' + f.id)); b.appendChild(document.createTextNode(f.nom));
        b.addEventListener('click', function () { CarteImmo.setFond(f.id); fermer(); });
        pop.appendChild(b);
      });
    }
    function fermer() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop.hidden) { dessiner(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); pop.querySelector('[aria-pressed="true"]').focus(); } else fermer();
    });
    document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target)) fermer(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); fermer(); btn.focus(); } }, true);
  }

  // ---------- Chargement des maisons ----------
  function contenuPastille(classe, icone, texte, tourne) {
    pastille.className = 'pastille-charger verre ' + classe;
    pastille.innerHTML = '';
    var r = Ui.el('span', 'rond'); r.appendChild(Ui.icone(icone, 'ic-sm' + (tourne ? ' rotation' : ''))); pastille.appendChild(r);
    pastille.appendChild(document.createTextNode(texte));
    pastille.hidden = false;
  }

  function majPastille() {
    if (!map) return;
    // Un téléchargement en cours a sa propre carte de progression
    if (Telechargements.visibles().length && !resultatAffiche) { pastille.hidden = true; return; }
    if (enChargement && !Telechargements.visibles().length) { contenuPastille('discret', 'loader-circle', 'Chargement des maisons…', true); pastille.disabled = true; return; }
    pastille.disabled = false;
    if (resultatAffiche) { contenuPastille('fait', 'circle-check', resultatAffiche); return; }
    var z = map.getZoom();
    if (z < DataImmo.config.zoomMin) {
      if (CarteImmo.total()) { contenuPastille('discret', 'scan-search', 'Zoomez pour voir les bâtiments'); pastille.dataset.action = 'zoom'; return; }   // vue éloignée : carte d'avancement
      contenuPastille('discret', 'scan-search', 'Zoomez pour afficher les maisons'); pastille.dataset.action = 'zoom'; return;
    }
    if (DataImmo.estCharge(map.getBounds())) { pastille.hidden = true; return; }
    if (DataImmo.surfaceKm2(DataImmo.boite(map.getBounds())) > DataImmo.config.surfaceMaxKm2) { contenuPastille('discret', 'scan-search', 'Zoomez pour charger cette zone'); pastille.dataset.action = 'zoom'; return; }
    contenuPastille('action', 'download', 'Charger les maisons de cette zone');
    pastille.dataset.action = 'charger';
  }

  function charger() {
    if (enChargement) return;
    if (!navigator.onLine) { Notif.alerter('Vous êtes hors ligne : impossible de charger de nouvelles maisons.', 'horsligne'); return; }
    enChargement = true; majPastille();
    Telechargements.zone(map.getBounds()).then(function (res) {
      majLegende();
      var n = res.nouveaux;
      resultatAffiche = res.dejaCharge ? 'Zone déjà chargée' : (n ? Ui.nombre(n) + ' bâtiment' + (n > 1 ? 's' : '') + ' ajouté' + (n > 1 ? 's' : '') : 'Aucun nouveau bâtiment ici');
      if (res.avertissement) Notif.afficher(res.avertissement, { type: 'alerte', duree: 9000 });
      if (res.rattaches) Notif.afficher(res.rattaches + ' fiche' + (res.rattaches > 1 ? 's' : '') + ' rattachée' + (res.rattaches > 1 ? 's' : '') + ' aux bâtiments IGN.', { type: 'info' });
      clearTimeout(timerResultat);
      timerResultat = setTimeout(function () { resultatAffiche = null; majPastille(); }, 2600);
      masquerAccueil();
    }).catch(function (err) {
      if (!/annulé/.test(err.message)) Notif.afficher(err.message || 'Chargement impossible.', { type: 'erreur', cle: 'charger' });
    }).finally(function () { enChargement = false; majPastille(); });
  }

  // ---------- Légende ----------
  function majLegende() {
    if (!legende) return;
    // Compteurs en logements (portes) : un immeuble de 30 logements compte pour 30
    var ids = CarteImmo.ids(), c = Statuts.compterLogements(ids), total = c.total;
    var faits = total - c.aucun;
    legende.querySelector('.total').textContent = Ui.nombre(total) + ' logement' + (total > 1 ? 's' : '');
    legende.querySelector('.total').title = Ui.nombre(ids.length) + ' bâtiments affichés';
    legende.querySelectorAll('.ligne-legende').forEach(function (b) { b.querySelector('.compte').textContent = Ui.nombre(c[b.dataset.statut] || 0); });
    majTypes();
    var pct = total ? Math.round(100 * faits / total) : 0;
    legende.querySelector('.avancement-carte .pct').textContent = pct + ' %';
    legende.querySelector('.avancement-carte .jauge > span').style.width = pct + '%';
  }

  function initLegende() {
    legende = document.getElementById('legende');
    var tete = Ui.bouton([Ui.icone('layers', 'ic-sm'), 'Légende', Ui.el('span', 'total', '0 maison'), Ui.icone('chevron-down', 'ic-sm chevron')], 'legende-tete', null, { 'aria-expanded': 'true', 'aria-controls': 'legende-corps' });
    var corps = Ui.el('div', 'legende-corps'); corps.id = 'legende-corps';
    Statuts.LISTE.forEach(function (st) {
      var p = Ui.el('span', 'pastille'); p.style.setProperty('--c', 'var(--st-' + st.id + ')');
      var b = Ui.bouton([p, st.court, Ui.el('span', 'compte', '0')], 'ligne-legende', null, { 'aria-pressed': 'true', 'aria-label': 'Afficher ' + st.label });
      b.dataset.statut = st.id; b.style.setProperty('--c', 'var(--st-' + st.id + ')');
      b.addEventListener('click', function () {
        var visible = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', visible ? 'true' : 'false');
        CarteImmo.filtrer(st.id, visible);
      });
      corps.appendChild(b);
    });
    // Filtre : n'afficher que les maisons ayant une étiquette, un potentiel ou un projet donnés
    var ligneFiltre = Ui.el('label', 'filtre-legende');
    ligneFiltre.appendChild(Ui.icone('list-filter', 'ic-sm'));
    var sel = Ui.el('select', 'saisie'); sel.id = 'filtre-carte'; sel.setAttribute('aria-label', 'Filtrer les maisons affichées');
    ligneFiltre.appendChild(sel);
    corps.appendChild(ligneFiltre);
    sel.addEventListener('change', function () { appliquerFiltre(sel.value); });
    filtreSelect = sel;
    majFiltres();
    // Types de bâtiments affichés (« à prospecter ») : les autres restent masqués et ne comptent pas
    var types = Ui.el('div', 'types-legende'); types.id = 'types-legende';
    types.appendChild(Ui.el('div', 'sous-titre', 'Bâtiments affichés'));
    var puces = Ui.el('div', 'puces-types');
    TypesBati.LISTE.forEach(function (t) {
      var b = Ui.bouton([Ui.icone(t.icone, 'ic-sm'), t.court, Ui.el('span', 'compte', '')], 'puce-type', function () {
        TypesBati.basculer(t.id, !TypesBati.estActif(t.id));
        Store.kvSet('types', TypesBati.exporter());
        majLegende();
      }, { 'aria-pressed': TypesBati.estActif(t.id) ? 'true' : 'false', title: t.label, 'data-type': t.id });
      puces.appendChild(b);
    });
    types.appendChild(puces);
    corps.appendChild(types);
    var av = Ui.el('div', 'avancement-carte');
    var st = Ui.el('div', 'sous-titre'); st.appendChild(Ui.el('span', null, 'Avancement')); st.appendChild(Ui.el('strong', 'pct num', '0 %'));
    av.appendChild(st);
    var j = Ui.el('div', 'jauge'); var js = Ui.el('span'); js.style.setProperty('--c', 'var(--st-contact)'); j.appendChild(js); av.appendChild(j);
    corps.appendChild(av);
    legende.appendChild(tete); legende.appendChild(corps);
    function replier(v) {
      legende.classList.toggle('repliee', v); tete.setAttribute('aria-expanded', v ? 'false' : 'true');
      try { localStorage.setItem(CLE_LEGENDE, v ? '1' : '0'); } catch (e) { /* sans importance */ }
    }
    var memo = null; try { memo = localStorage.getItem(CLE_LEGENDE); } catch (e) { /* idem */ }
    replier(memo === null ? Coquille.telephone() : memo === '1');
    tete.addEventListener('click', function () { replier(!legende.classList.contains('repliee')); });
    majLegende();
  }

  // Nombre de bâtiments par type (tous les bâtiments chargés) et état des puces
  var timerTypes = null;
  function majTypes() {
    clearTimeout(timerTypes);
    timerTypes = setTimeout(function () {
      var n = {};
      CarteImmo.ids(true).forEach(function (id) { var t = TypesBati.typeDe(id); n[t] = (n[t] || 0) + 1; });
      legende.querySelectorAll('.puce-type').forEach(function (b) {
        b.setAttribute('aria-pressed', TypesBati.estActif(b.dataset.type) ? 'true' : 'false');
        b.querySelector('.compte').textContent = n[b.dataset.type] ? Ui.nombre(n[b.dataset.type]) : '';
        b.hidden = !n[b.dataset.type] && !TypesBati.estActif(b.dataset.type);
      });
    }, 150);
  }

  // ---------- Filtre de la légende ----------
  var filtreSelect = null;
  function majFiltres() {
    if (!filtreSelect) return;
    var v = filtreSelect.value;
    filtreSelect.innerHTML = '';
    function opt(val, txt, parent) { var o = Ui.el('option', null, txt); o.value = val; (parent || filtreSelect).appendChild(o); }
    opt('', 'Tous les bâtiments affichés');
    var g1 = Ui.el('optgroup'); g1.label = 'Potentiel';
    Statuts.QUALIF.potentiel.valeurs.forEach(function (x) { opt('potentiel:' + x[0], 'Potentiel ' + x[1].toLowerCase(), g1); });
    filtreSelect.appendChild(g1);
    var g2 = Ui.el('optgroup'); g2.label = 'Projet';
    Statuts.QUALIF.projet.valeurs.filter(function (x) { return x[0] !== 'aucun'; }).forEach(function (x) { opt('projet:' + x[0], x[1], g2); });
    filtreSelect.appendChild(g2);
    // Données publiques : DPE et ventes
    var g4 = Ui.el('optgroup'); g4.label = 'Énergie (DPE)';
    opt('dpe:FG', 'Passoires : DPE F ou G', g4); opt('dpe:E', 'DPE E', g4); opt('dpe:ABCD', 'DPE A à D', g4); opt('dpe:aucun', 'Sans DPE connu', g4);
    filtreSelect.appendChild(g4);
    var g5 = Ui.el('optgroup'); g5.label = 'Ventes (DVF)';
    opt('vente:2ans', 'Vendu il y a moins de 2 ans', g5); opt('vente:oui', 'Vendu depuis 2021', g5); opt('vente:non', 'Pas de vente depuis 2021', g5);
    filtreSelect.appendChild(g5);
    if (Etiquettes.liste().length) {
      var g3 = Ui.el('optgroup'); g3.label = 'Étiquette';
      Etiquettes.liste().forEach(function (e) { opt('etiquette:' + e.id, e.nom, g3); });
      filtreSelect.appendChild(g3);
    }
    filtreSelect.value = v;
    if (filtreSelect.value !== v) appliquerFiltre('');
  }
  function appliquerFiltre(v) {
    if (filtreSelect) filtreSelect.value = v;
    legende.classList.toggle('filtre-actif', !!v);
    if (!v) { CarteImmo.definirFiltre(null); return; }
    var champ = v.slice(0, v.indexOf(':')), val = v.slice(v.indexOf(':') + 1);
    if (champ === 'dpe' || champ === 'vente') { CarteImmo.definirFiltre(filtreDonnees(champ, val)); return; }
    CarteImmo.definirFiltre(function (id) {
      var r = Statuts.get(id);
      if (!r) return false;
      return champ === 'etiquette' ? (r.etiquettes || []).indexOf(val) >= 0 : r[champ] === val;
    });
  }

  // Filtres sur les données publiques d'un bâtiment (DPE, ventes DVF)
  function filtreDonnees(champ, val) {
    if (champ === 'dpe') return function (id) {
      var e = Enrichissement.pireEtiquette(id);
      if (val === 'aucun') return !e;
      return !!e && val.indexOf(e) >= 0;
    };
    var limite = new Date(); limite.setFullYear(limite.getFullYear() - 2);
    var j = limite.toISOString().slice(0, 10);
    return function (id) {
      var v = Enrichissement.derniereVente(id);
      return val === 'non' ? !v : val === '2ans' ? !!v && v.d >= j : !!v;
    };
  }

  // ---------- Accueil (aucune maison encore chargée) ----------
  function masquerAccueil() { document.getElementById('accueil-carte').hidden = true; }
  function majAccueil() {
    var a = document.getElementById('accueil-carte');
    a.hidden = !(CarteImmo.total() === 0 && map.getZoom() < 12 && Coquille.vue() === 'carte');
  }

  function init(carte) {
    map = carte;
    pastille = document.getElementById('pastille-charger');
    pastille.addEventListener('click', function () {
      if (pastille.dataset.action === 'zoom') map.setZoom(Math.max(map.getZoom() + 1, DataImmo.config.zoomMin));
      else if (pastille.dataset.action === 'charger') charger();
    });
    initFonds();
    initLegende();
    document.getElementById('btn-zoom-plus').addEventListener('click', function () { map.zoomIn(); });
    document.getElementById('btn-zoom-moins').addEventListener('click', function () { map.zoomOut(); });
    var barre = document.getElementById('progression');
    Telechargements.surChangement(function () { barre.classList.toggle('active', !!Telechargements.actif()); });
    map.on('moveend zoomend', function () { majPastille(); majAccueil(); });
    // Suspend le flou des panneaux flottants pendant les déplacements (fluidité, surtout sur téléphone)
    var scene = document.getElementById('scene');
    map.on('movestart zoomstart', function () { scene.classList.add('en-mouvement'); });
    map.on('moveend zoomend', function () { scene.classList.remove('en-mouvement'); });
    document.getElementById('accueil-chercher').addEventListener('click', function () { Palette.ouvrir(); });
    Statuts.surChangement(majLegende);
    Etiquettes.surChangement(majFiltres);
    CarteImmo.surElements(function () { clearTimeout(majLegende.t); majLegende.t = setTimeout(function () { majLegende(); majAccueil(); }, 60); });
    majPastille(); majAccueil();
  }

  return { init: init, majLegende: majLegende, appliquerFiltre: appliquerFiltre, majPastille: majPastille, charger: charger, majAccueil: majAccueil };
})();
