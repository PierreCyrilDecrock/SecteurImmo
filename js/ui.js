/*
 * ui.js – Petits outils d'interface partagés : icônes, création d'éléments, boutons de statut,
 * anneaux de progression, compteurs animés, confirmations, vibration.
 * Expose l'objet global Ui.
 */
var Ui = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var SPRITE = 'vendor/lucide/icons.svg#';

  // Icône du sprite Lucide
  function icone(nom, classe) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'ic' + (classe ? ' ' + classe : ''));
    s.setAttribute('aria-hidden', 'true');
    var u = document.createElementNS(NS, 'use');
    u.setAttribute('href', SPRITE + nom);
    s.appendChild(u);
    return s;
  }
  function htmlIcone(nom, classe) { return '<svg class="ic' + (classe ? ' ' + classe : '') + '" aria-hidden="true"><use href="' + SPRITE + nom + '"/></svg>'; }

  // Élément avec classe et texte (le texte passe toujours par textContent)
  function el(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte !== undefined && texte !== null) e.textContent = texte;
    return e;
  }

  function bouton(contenu, classe, onClick, attrs) {
    var b = el('button', classe || 'btn');
    b.type = 'button';
    (Array.isArray(contenu) ? contenu : [contenu]).forEach(function (c) {
      if (c === null || c === undefined) return;
      b.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, attrs[k]); });
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  // Bouton de choix d'un statut (fiche, tournée, sélection). numero : raccourci clavier affiché.
  function boutonStatut(st, actif, onClick, numero) {
    var b = el('button', 'choix-statut');
    b.type = 'button';
    b.dataset.statut = st.id;
    b.style.setProperty('--c', 'var(--st-' + st.id + ')');
    b.setAttribute('aria-pressed', actif ? 'true' : 'false');
    var p = el('span', 'puce-ic'); p.appendChild(icone(st.icone)); b.appendChild(p);
    b.appendChild(el('span', 'libelle', st.label));
    if (numero) b.appendChild(el('span', 'kbd', String(numero)));
    b.addEventListener('click', onClick);
    return b;
  }

  // Étiquette de statut (pastille colorée + icône + libellé)
  function etiquetteStatut(st) {
    var s = el('span', 'etiquette-statut');
    s.style.setProperty('--c', 'var(--st-' + st.id + ')');
    s.appendChild(icone(st.icone)); s.appendChild(document.createTextNode(st.label));
    return s;
  }

  // Anneau de progression SVG (pct 0..100 ou null)
  function anneau(pct, taille, epaisseur, couleur, contenuCentre, animer) {
    taille = taille || 44; epaisseur = epaisseur || 5;
    var r = (taille - epaisseur) / 2, c = 2 * Math.PI * r;
    var w = el('span', 'anneau');
    if (couleur) w.style.setProperty('--c', couleur);
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', taille); s.setAttribute('height', taille); s.setAttribute('aria-hidden', 'true');
    function cercle(classe) {
      var k = document.createElementNS(NS, 'circle');
      k.setAttribute('class', classe); k.setAttribute('cx', taille / 2); k.setAttribute('cy', taille / 2); k.setAttribute('r', r);
      k.setAttribute('fill', 'none'); k.setAttribute('stroke-width', epaisseur);
      return k;
    }
    s.appendChild(cercle('fond'));
    var v = cercle('valeur');
    v.setAttribute('stroke-dasharray', c); v.setAttribute('stroke-dashoffset', c);
    s.appendChild(v);
    w.appendChild(s);
    var centre = el('span', 'centre');
    if (contenuCentre !== undefined) { if (typeof contenuCentre === 'string') centre.textContent = contenuCentre; else centre.appendChild(contenuCentre); }
    w.appendChild(centre);
    // L'animation part de 0 au prochain rafraîchissement
    var cible = c * (1 - Math.max(0, Math.min(100, pct || 0)) / 100);
    if (animer === false) v.setAttribute('stroke-dashoffset', cible);
    else requestAnimationFrame(function () { requestAnimationFrame(function () { v.setAttribute('stroke-dashoffset', cible); }); });
    return w;
  }

  function reduitMouvement() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  // Compteur animé jusqu'à la valeur (texte formaté par fmt)
  function compter(element, valeur, fmt, duree) {
    fmt = fmt || function (v) { return String(Math.round(v)); };
    if (reduitMouvement() || !isFinite(valeur)) { element.textContent = fmt(valeur); return; }
    duree = duree || 700;
    var t0 = performance.now();
    function pas(t) {
      var k = Math.min(1, (t - t0) / duree), e = 1 - Math.pow(1 - k, 3);
      element.textContent = fmt(valeur * e);
      if (k < 1) requestAnimationFrame(pas);
    }
    element.textContent = fmt(0);
    requestAnimationFrame(pas);
  }

  function nombre(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  // Petite vibration de confirmation (téléphones qui le permettent)
  function vibrer(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { /* sans effet */ } }

  // Confirmation dans une fenêtre modale (remplace window.confirm). Résout true / false.
  function confirmer(o) {
    var dlg = document.getElementById('dlg-confirmer');
    return new Promise(function (ok) {
      dlg.innerHTML = '';
      var tete = el('div', 'modale-tete');
      var m = el('span', 'medaillon-modale' + (o.danger ? ' danger' : '')); m.appendChild(icone(o.icone || (o.danger ? 'triangle-alert' : 'info')));
      tete.appendChild(m);
      var h = el('h2', null, o.titre); h.id = 'dlg-confirmer-titre'; tete.appendChild(h);
      dlg.appendChild(tete);
      dlg.appendChild(el('div', 'modale-corps', o.message || ''));
      var pied = el('div', 'modale-pied');
      var resultat = false;
      pied.appendChild(bouton(o.annuler || 'Annuler', 'btn', function () { dlg.close(); }, { id: 'confirmer-non' }));
      pied.appendChild(bouton(o.bouton || 'Confirmer', o.danger ? 'btn btn-primaire btn-danger-plein' : 'btn btn-primaire', function () { resultat = true; dlg.close(); }, { id: 'confirmer-oui' }));
      dlg.appendChild(pied);
      dlg.addEventListener('close', function f() { dlg.removeEventListener('close', f); ok(resultat); });
      dlg.showModal();
      dlg.querySelector('#confirmer-oui').focus();
    });
  }

  // Champ de saisie actif ? (pour ne pas déclencher les raccourcis pendant la frappe)
  function saisieActive() {
    var a = document.activeElement;
    return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
  }

  // Compatibilité : ferme les tiroirs (géré par la coquille)
  function fermerVolets() { if (window.Coquille) Coquille.fermerTiroir(); }

  return {
    icone: icone, htmlIcone: htmlIcone, el: el, bouton: bouton, boutonStatut: boutonStatut, etiquetteStatut: etiquetteStatut,
    anneau: anneau, compter: compter, nombre: nombre, vibrer: vibrer, confirmer: confirmer, saisieActive: saisieActive,
    reduitMouvement: reduitMouvement, fermerVolets: fermerVolets
  };
})();
