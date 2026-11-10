/*
 * aide.js – Présentation de bienvenue (premier lancement, revoir depuis l'aide) et panneau « Aide ».
 * Expose l'objet global Aide.
 */
var Aide = (function () {
  'use strict';

  var CLE = 'secteurimmo-aide';   // mémorise que la présentation a été vue (localStorage, par navigateur)
  var DIAPOS = [
    { ic: 'map-pinned', t: 'Bienvenue sur SecteurImmo', p: 'Votre carnet de prospection sur la carte : chaque maison visitée est cochée, chaque secteur suivi à la porte près.' },
    { ic: 'cloud-download', t: 'Votre commune en une fois', p: 'Téléchargez tous les bâtiments et adresses de votre commune (données IGN) : maisons, immeubles et leurs logements, commerces… Vous choisissez ce que vous prospectez.' },
    { ic: 'zap', t: 'Une tournée en un geste', p: 'Démarrez une tournée, passez en « Pointage rapide » et touchez les maisons au fil de la rue. Chrono, records et défis suivent votre progression.' },
    { ic: 'layout-dashboard', t: 'Vos résultats au quotidien', p: 'Bilan de la semaine, objectif, personnes à rappeler : tout est calculé pour vous. Vos données restent sur cet appareil, sans compte ni serveur.' }
  ];
  var dlg, index = 0;

  function dessiner() {
    var d = DIAPOS[index], el = Ui.el;
    dlg.innerHTML = '';
    var v = el('div', 'bienvenue-visuel'); var m = el('div', 'medaillon'); m.appendChild(Ui.icone(d.ic)); v.appendChild(m); dlg.appendChild(v);
    var c = el('div', 'diapo'); var h = el('h2', null, d.t); h.id = 'bienvenue-titre'; c.appendChild(h); c.appendChild(el('p', null, d.p)); dlg.appendChild(c);
    dlg.setAttribute('aria-labelledby', 'bienvenue-titre');
    var pied = el('div', 'modale-pied');
    var points = el('div', 'points-diapo'); points.setAttribute('aria-label', 'Étape ' + (index + 1) + ' sur ' + DIAPOS.length);
    DIAPOS.forEach(function (x, i) { points.appendChild(el('span', i === index ? 'actif' : '')); });
    pied.appendChild(points);
    if (index < DIAPOS.length - 1) pied.appendChild(Ui.bouton('Passer', 'btn btn-fantome', function () { dlg.close(); }, { id: 'bienvenue-passer' }));
    else pied.appendChild(Ui.bouton('Précédent', 'btn btn-fantome', function () { index--; dessiner(); }));
    if (index < DIAPOS.length - 1) pied.appendChild(Ui.bouton(['Suivant', Ui.icone('arrow-right', 'ic-sm')], 'btn btn-primaire', function () { index++; dessiner(); }, { id: 'bienvenue-suivant' }));
    else pied.appendChild(Ui.bouton([Ui.icone('search', 'ic-sm'), 'Trouver mon secteur'], 'btn btn-primaire', function () { dlg.close(); Palette.ouvrir(); }, { id: 'bienvenue-commencer' }));
    dlg.appendChild(pied);
    var b = dlg.querySelector('.btn-primaire'); if (b) b.focus();
  }

  function presenter() { index = 0; dessiner(); if (!dlg.open) dlg.showModal(); }

  function init() {
    dlg = document.getElementById('dlg-bienvenue');
    document.getElementById('aide-revoir').addEventListener('click', function () { Coquille.fermerTiroir(); presenter(); });
    var premiere = false;
    try { premiere = !localStorage.getItem(CLE); if (premiere) localStorage.setItem(CLE, '1'); } catch (e) { /* stockage indisponible */ }
    if (premiere) setTimeout(presenter, 400);
  }

  return { init: init, presenter: presenter };
})();
