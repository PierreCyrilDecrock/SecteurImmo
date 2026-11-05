/*
 * coquille.js – Navigation de l'application : rail (ordinateur) / barre d'onglets (téléphone),
 * tiroir latéral (secteurs, rappels, données, aide), fiche d'une maison, vue « Bilan »,
 * feuilles glissantes sur téléphone (poignée), menu « Plus », badges.
 * Expose l'objet global Coquille.
 */
var Coquille = (function () {
  'use strict';

  var TITRES = { secteurs: 'Secteurs', rappels: 'Rappels', donnees: 'Données', aide: 'Aide' };
  var scene, tiroir, fiche, voile, tableau, menuPlus;
  var vue = 'carte', tiroirOuvert = null, ficheOuverte = false, dernierDeclencheur = null;
  var modules = {};   // nom -> { ouvrir(), fermer() } fournis par les modules de panneau

  function enregistrer(nom, m) { modules[nom] = m; }
  function telephone() { return window.matchMedia('(max-width: 767px)').matches; }

  function majNav() {
    document.querySelectorAll('.rail [data-nav]').forEach(function (b) {
      var n = b.dataset.nav;
      if (n === 'carte' || estVuePleine(n)) {
        if (n === vue && !(n === 'carte' && tiroirOuvert && telephone())) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      } else b.setAttribute('aria-expanded', tiroirOuvert === n ? 'true' : 'false');
    });
    voile.classList.toggle('visible', !!(tiroirOuvert || ficheOuverte));
  }

  // ---------- Tiroir ----------
  function ouvrirTiroir(nom, declencheur) {
    if (vue !== 'carte') allerVue('carte');
    if (tiroirOuvert && tiroirOuvert !== nom && modules[tiroirOuvert] && modules[tiroirOuvert].fermer) modules[tiroirOuvert].fermer();
    if (ficheOuverte && telephone() && window.Panneau) Panneau.fermer();
    fermerMenuPlus();
    tiroirOuvert = nom;
    dernierDeclencheur = declencheur || document.activeElement;
    document.getElementById('tiroir-titre').textContent = TITRES[nom] || '';
    document.getElementById('tiroir-actions').innerHTML = '';
    tiroir.querySelectorAll('.tiroir-section').forEach(function (s) { s.hidden = s.dataset.section !== nom; });
    tiroir.inert = false;
    tiroir.style.removeProperty('--glisse');
    tiroir.classList.add('ouvert');
    scene.classList.add('tiroir-ouvert');
    tiroir.querySelector('.tiroir-corps').scrollTop = 0;
    if (modules[nom] && modules[nom].ouvrir) modules[nom].ouvrir();
    majNav();
    setTimeout(function () { if (tiroirOuvert === nom) document.getElementById('tiroir-fermer').focus({ preventScroll: true }); }, 60);
  }

  function fermerTiroir() {
    if (!tiroirOuvert) return false;
    var nom = tiroirOuvert;
    tiroirOuvert = null;
    tiroir.classList.remove('ouvert');
    tiroir.inert = true;
    scene.classList.remove('tiroir-ouvert');
    if (modules[nom] && modules[nom].fermer) modules[nom].fermer();
    majNav();
    if (dernierDeclencheur && document.body.contains(dernierDeclencheur) && tiroir.contains(document.activeElement)) dernierDeclencheur.focus({ preventScroll: true });
    return true;
  }

  // ---------- Fiche ----------
  function ouvrirFiche() {
    if (tiroirOuvert && telephone()) fermerTiroir();
    ficheOuverte = true;
    fiche.inert = false; fiche.style.removeProperty('--glisse');
    fiche.classList.add('ouverte'); scene.classList.add('fiche-ouverte');
    majNav();
  }
  function fermerFiche() {
    if (!ficheOuverte) return false;
    ficheOuverte = false;
    fiche.classList.remove('ouverte'); fiche.inert = true; scene.classList.remove('fiche-ouverte');
    majNav();
    return true;
  }

  // ---------- Vues pleine page (Bilan, Tournées, Base) ----------
  // VUES : nom -> id de l'élément ; les modules s'enregistrent avec enregistrerVue(nom, { ouvrir, fermer })
  var VUES = { tableau: 'tableau', tournees: 'vue-tournees', base: 'vue-base' }, modulesVues = {};
  function enregistrerVue(nom, m) { modulesVues[nom] = m; }
  function estVuePleine(n) { return Object.prototype.hasOwnProperty.call(VUES, n); }

  function allerVue(v) {
    if (v === vue) { if (v === 'carte' && tiroirOuvert) fermerTiroir(); return; }
    var ancienne = vue;
    vue = v;
    if (estVuePleine(ancienne)) {
      document.getElementById(VUES[ancienne]).hidden = true;
      if (modulesVues[ancienne] && modulesVues[ancienne].fermer) modulesVues[ancienne].fermer();
    }
    if (estVuePleine(v)) {
      fermerTiroir(); if (window.Panneau) Panneau.fermer();
      var e = document.getElementById(VUES[v]);
      e.hidden = false;
      if (modulesVues[v] && modulesVues[v].ouvrir) modulesVues[v].ouvrir();
      e.focus({ preventScroll: true });
    } else if (window.CarteImmo) setTimeout(function () { CarteImmo.getMap().invalidateSize(); }, 0);
    fermerMenuPlus();
    majNav();
  }

  function naviguer(nom, declencheur) {
    if (nom === 'carte' || estVuePleine(nom)) { if (tiroirOuvert && nom === 'carte') fermerTiroir(); allerVue(nom); return; }
    if (tiroirOuvert === nom) fermerTiroir(); else ouvrirTiroir(nom, declencheur);
  }

  // Échap : ferme l'élément le plus « haut » ; renvoie vrai si quelque chose a été fermé
  function echap() {
    if (!menuPlus.hidden) { fermerMenuPlus(); return true; }
    if (ficheOuverte && window.Panneau) { Panneau.fermer(); return true; }
    if (fermerTiroir()) return true;
    if (estVuePleine(vue)) { allerVue('carte'); return true; }
    return false;
  }

  // ---------- Menu « Plus » (téléphone) ----------
  function fermerMenuPlus() { if (menuPlus && !menuPlus.hidden) { menuPlus.hidden = true; document.getElementById('btn-plus').setAttribute('aria-expanded', 'false'); } }

  // ---------- Feuilles glissantes (téléphone) : tirer la poignée vers le bas pour fermer ----------
  function glisser(poignee) {
    var cible = poignee.dataset.glisse === 'tiroir' ? tiroir : fiche;
    var y0 = 0, dy = 0, t0 = 0;
    poignee.addEventListener('pointerdown', function (e) {
      y0 = e.clientY; dy = 0; t0 = performance.now();
      poignee.setPointerCapture(e.pointerId); cible.classList.add('glisse');
    });
    poignee.addEventListener('pointermove', function (e) {
      if (!cible.classList.contains('glisse')) return;
      dy = Math.max(0, e.clientY - y0);
      cible.style.setProperty('--glisse', dy + 'px');
    });
    function fin() {
      if (!cible.classList.contains('glisse')) return;
      cible.classList.remove('glisse');
      var vitesse = dy / Math.max(1, performance.now() - t0);
      if (dy > 110 || vitesse > 0.6) { if (cible === tiroir) fermerTiroir(); else if (window.Panneau) Panneau.fermer(); }
      cible.style.removeProperty('--glisse');
    }
    poignee.addEventListener('pointerup', fin);
    poignee.addEventListener('pointercancel', fin);
  }

  // ---------- Badges ----------
  function badge(nom, n) {
    if (nom === 'rappels') { var b = document.getElementById('badge-rappels'); b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; }
  }
  function point(nom, visible) { if (nom === 'donnees') document.getElementById('point-donnees').hidden = !visible; }

  function init() {
    scene = document.getElementById('scene'); tiroir = document.getElementById('tiroir'); fiche = document.getElementById('panneau');
    voile = document.getElementById('voile'); tableau = document.getElementById('tableau'); menuPlus = document.getElementById('menu-plus');
    Object.keys(VUES).forEach(function (k) { var e = document.getElementById(VUES[k]); if (e) e.tabIndex = -1; });
    document.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { naviguer(b.dataset.nav, b); });
    });
    document.getElementById('tiroir-fermer').addEventListener('click', fermerTiroir);
    voile.addEventListener('click', function () { if (ficheOuverte && window.Panneau) Panneau.fermer(); else fermerTiroir(); });
    document.querySelectorAll('.poignee').forEach(glisser);
    document.getElementById('btn-plus').addEventListener('click', function (e) {
      e.stopPropagation();
      var ouvrir = menuPlus.hidden; menuPlus.hidden = !ouvrir;
      this.setAttribute('aria-expanded', ouvrir ? 'true' : 'false');
      if (ouvrir) menuPlus.querySelector('button').focus();
    });
    document.addEventListener('click', function (e) { if (!menuPlus.hidden && !menuPlus.contains(e.target)) fermerMenuPlus(); });
    document.getElementById('btn-theme').addEventListener('click', function () { Theme.basculer(); Notif.afficher('Thème : ' + Theme.libelle(), { cle: 'theme', duree: 1800 }); });
    document.getElementById('btn-theme-mobile').addEventListener('click', function () { Theme.basculer(); });
    document.querySelector('.logo').addEventListener('click', function (e) { e.preventDefault(); naviguer('carte'); });
    majNav();
  }

  return {
    init: init, enregistrer: enregistrer, enregistrerVue: enregistrerVue, ouvrirTiroir: ouvrirTiroir, fermerTiroir: fermerTiroir, naviguer: naviguer, allerVue: allerVue,
    ouvrirFiche: ouvrirFiche, fermerFiche: fermerFiche, echap: echap, badge: badge, point: point,
    vue: function () { return vue; }, tiroir: function () { return tiroirOuvert; }, telephone: telephone
  };
})();
