/*
 * theme.js – Thème clair / sombre / automatique (suit le système). Le choix est mémorisé dans ce
 * navigateur ; le thème effectif est posé sur <html data-theme="clair|sombre">.
 * Expose l'objet global Theme.
 */
var Theme = (function () {
  'use strict';

  var CLE = 'secteurimmo-theme';
  var ORDRE = ['systeme', 'clair', 'sombre'];
  var LIBELLES = { systeme: 'Auto', clair: 'Clair', sombre: 'Sombre' };
  var ICONES = { systeme: 'monitor', clair: 'sun', sombre: 'moon' };
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var choix = 'systeme', ecouteurs = [];

  function lire() { try { return localStorage.getItem(CLE) || 'systeme'; } catch (e) { return 'systeme'; } }
  function effectif() { return choix === 'sombre' || (choix === 'systeme' && media && media.matches) ? 'sombre' : 'clair'; }

  function appliquer() {
    var t = effectif();
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'sombre' ? '#0b0f17' : '#0f172a');
    document.querySelectorAll('.libelle-theme').forEach(function (e) { e.textContent = LIBELLES[choix]; });
    var b = document.getElementById('btn-theme');
    if (b) {
      b.querySelector('use').setAttribute('href', 'vendor/lucide/icons.svg#' + ICONES[choix]);
      b.setAttribute('aria-label', 'Thème : ' + LIBELLES[choix] + ' (cliquer pour changer)');
    }
    ecouteurs.forEach(function (cb) { cb(t); });
  }

  function basculer() {
    choix = ORDRE[(ORDRE.indexOf(choix) + 1) % ORDRE.length];
    try { localStorage.setItem(CLE, choix); } catch (e) { /* non mémorisé */ }
    appliquer();
    return choix;
  }

  function init() {
    choix = lire();
    if (ORDRE.indexOf(choix) < 0) choix = 'systeme';
    if (media && media.addEventListener) media.addEventListener('change', function () { if (choix === 'systeme') appliquer(); });
    appliquer();
  }

  return { init: init, basculer: basculer, effectif: effectif, surChangement: function (cb) { ecouteurs.push(cb); }, libelle: function () { return LIBELLES[choix]; } };
})();
