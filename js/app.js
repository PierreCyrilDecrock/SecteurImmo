/*
 * app.js – Démarrage de l'application : initialise les modules dans l'ordre, restaure les données
 * de la base locale, puis branche la sauvegarde automatique.
 */
(function () {
  'use strict';

  var alerter = Notif.alerter;

  Theme.init();
  Coquille.init();
  var carte = CarteImmo.init(alerter);
  CarteUi.init(carte);
  Panneau.init();
  Secteurs.init(carte, alerter);
  SecteursUi.init();
  RappelsUi.init();
  Outils.init(carte);
  StatsUi.init();
  Position.init(carte, alerter);
  Palette.init();
  Pwa.init();
  Secteurs.surStructure(function () { Store.enregistrerSecteurs(Secteurs.exporter()); });

  // ---- Restauration depuis la base locale, puis sauvegarde automatique ----
  var timerPrefs;
  Store.init().then(function (d) {
    if (d) {
      DataImmo.restaurer(d.batiments, d.zones);
      Statuts.charger(d, 'remplacer', true);      // silencieux : déjà en base
      CarteImmo.afficherBatiments(d.batiments);
      CarteImmo.synchroniserManuels(Statuts.manuels());
      Object.keys(Statuts._records()).forEach(CarteImmo.rafraichir);
      Secteurs.charger(d.secteurs, 'remplacer');
      CarteUi.majLegende();
      CarteImmo.appliquerPrefs(d.prefs);
      Store.chargerMeta(d.meta);
      if (d.objectif) StatsUi.definirObjectif(d.objectif, true);
      Store.demarrer();
      // Préférences de vue : enregistrées avec un délai pour ne pas écrire à chaque déplacement
      CarteImmo.definirSurPrefs(function (p) { clearTimeout(timerPrefs); timerPrefs = setTimeout(function () { Store.enregistrerPrefs(p); }, 800); });
    } else {
      Notif.afficher('Sauvegarde automatique indisponible dans ce navigateur : pensez à exporter vos données (menu Données).', { type: 'alerte', duree: 9000 });
    }
    Echange.init({ alerter: alerter, fichierLie: d && d.fichierLie });
    RappelsUi.dessiner();
    CarteUi.majPastille(); CarteUi.majAccueil();
    Aide.init();
    document.documentElement.classList.add('pret');
  });
})();
