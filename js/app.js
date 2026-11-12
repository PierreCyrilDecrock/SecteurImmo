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
  TelechargementsUi.init();
  Communes.init(carte);
  Panneau.init();
  Secteurs.init(carte, alerter);
  SecteursUi.init();
  CommunesUi.init();
  RappelsUi.init();
  Outils.init(carte);
  StatsUi.init();
  Position.init(carte, alerter);
  Tournees.init();
  TourneesUi.init();
  Base.init();
  Palette.init();
  Pwa.init();
  Secteurs.surStructure(function () { Store.enregistrerSecteurs(Secteurs.exporter()); });
  Etiquettes.surChangement(function () { Store.kvSet('etiquettes', Etiquettes.exporter()); });

  // ---- Restauration depuis la base locale, puis sauvegarde automatique ----
  var timerPrefs;
  Store.init().then(function (d) {
    if (d) {
      TypesBati.charger(d.types);
      DataImmo.restaurer(d.batiments, d.zones);
      Statuts.charger(d, 'remplacer', true);      // silencieux : déjà en base
      Statuts.chargerSupprimes(d.supprimes);
      CarteImmo.afficherBatiments(d.batiments);
      CarteImmo.synchroniserManuels(Statuts.manuels());
      if (d.etiquettes) Etiquettes.charger(d.etiquettes, 'remplacer');
      Secteurs.charger(d.secteurs, 'remplacer');
      CarteUi.majLegende();
      CarteImmo.appliquerPrefs(d.prefs);
      Store.chargerMeta(d.meta);
      if (d.objectif) StatsUi.definirObjectif(d.objectif, true);
      if (d.tournees) Tournees.charger(d.tournees, 'remplacer');
      Communes.charger(d.communes);
      Telechargements.charger(d.telechargements);
      Base.chargerPreferences(d.base);
      Store.demarrer();
      // Préférences de vue : enregistrées avec un délai pour ne pas écrire à chaque déplacement
      CarteImmo.definirSurPrefs(function (p) { clearTimeout(timerPrefs); timerPrefs = setTimeout(function () { Store.enregistrerPrefs(p); }, 800); });
    } else {
      Notif.afficher('Sauvegarde automatique indisponible dans ce navigateur : pensez à exporter vos données (menu Données).', { type: 'alerte', duree: 9000 });
    }
    Echange.init({ alerter: alerter, fichierLie: d && d.fichierLie });
    SynchroUi.init();
    Telechargements.demarrer();
    RappelsUi.dessiner();
    CarteUi.majPastille(); CarteUi.majAccueil();
    Aide.init();
    Progression.init(d && d.progression);
    TourneesUi.verifierOubli();
    // Données d'une version précédente (bâtiments OpenStreetMap) : proposer, une fois, de passer aux données IGN
    if (d && !Store.getMeta('avisIgn') && Object.keys(DataImmo._batiments()).some(DataImmo.estOsm)) {
      Store.setMeta('avisIgn', Date.now());
      Notif.afficher('Nouveau : bâtiments IGN avec types (maison, immeuble…) et logements. Téléchargez votre commune ou vos zones : vos fiches suivront.', {
        type: 'info', duree: 15000, action: { texte: 'Communes', fn: function () { Coquille.ouvrirTiroir('secteurs'); } } });
    }
    // Protection du stockage : demandée automatiquement dès qu'il y a des données à protéger
    // (sans effet visible sur Chrome ; Firefox peut afficher une demande d'autorisation)
    var protectionDemandee = false;
    function proteger() {
      if (protectionDemandee || !Object.keys(Statuts._records()).length) return;
      protectionDemandee = true;
      Store.etatStockage().then(function (e) { if (e.gere && !e.persiste) Store.demanderPersistance(); });
    }
    proteger();
    Statuts.surDonnees(proteger);   // première maison renseignée pendant la session
    document.documentElement.classList.add('pret');
  });
})();
