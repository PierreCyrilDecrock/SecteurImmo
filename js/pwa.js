/*
 * pwa.js – Installation de l'application, hors ligne, service worker.
 * Expose l'objet global Pwa.
 */
var Pwa = (function () {
  'use strict';

  var evenementInstall = null;

  function init(alerter) {
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sans conséquence : l'app marche sans */ });
    }
    window.addEventListener('offline', function () {
      alerter('Hors ligne : la carte ne se charge plus, mais vos données restent consultables et modifiables.');
    });
    window.addEventListener('online', function () { alerter('Connexion rétablie.'); });

    // Bouton « Installer » (dans l'aide) : seulement quand le navigateur propose l'installation
    var btn = document.getElementById('aide-installer');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); evenementInstall = e; if (btn) btn.hidden = false;
    });
    window.addEventListener('appinstalled', function () { if (btn) btn.hidden = true; evenementInstall = null; });
    if (btn) btn.addEventListener('click', function () {
      if (!evenementInstall) return;
      evenementInstall.prompt();
      evenementInstall.userChoice.finally(function () { evenementInstall = null; btn.hidden = true; });
    });
  }

  return { init: init };
})();
