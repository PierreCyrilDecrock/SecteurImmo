/* aide.js – Fenêtre d'aide intégrée (bouton ❓) et message de bienvenue. Expose l'objet global Aide. */
var Aide = (function () {
  'use strict';

  var CLE = 'secteurimmo-aide';   // mémorise que le message de bienvenue a été montré (localStorage, par navigateur)

  function init(alerter) {
    var dlg = document.getElementById('dlg-aide');
    var btn = document.getElementById('btn-aide');
    var ouvrir = function () { Ui.fermerVolets(); dlg.showModal(); };
    btn.addEventListener('click', ouvrir);
    document.getElementById('aide-fermer').addEventListener('click', function () { dlg.close(); });
    // Un clic sur le fond sombre ferme la fenêtre
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { btn.focus(); });

    // Bienvenue : une seule fois par navigateur
    try {
      if (!localStorage.getItem(CLE)) {
        localStorage.setItem(CLE, '1');
        alerter('Bienvenue ! Le bouton ❓ (en bas à gauche) explique comment démarrer.');
      }
    } catch (e) { /* stockage indisponible : pas de bienvenue */ }
  }

  return { init: init };
})();
