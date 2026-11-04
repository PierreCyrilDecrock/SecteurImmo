/*
 * panneau.js – Fiche d'un bâtiment : adresse, statut en un clic, note,
 * nombre de logements, date/heure. Volet à droite sur ordinateur,
 * feuille en bas sur téléphone. Expose l'objet global Panneau.
 */
var Panneau = (function () {
  'use strict';

  var el, contenu, idCourant = null;
  var edition = false; // vrai pendant la saisie d'un champ : on ne reconstruit pas la fiche (sinon le focus est perdu)

  function init() {
    el = document.getElementById('panneau');
    contenu = document.getElementById('panneau-contenu');
    document.getElementById('panneau-fermer').addEventListener('click', fermer);
    // Si le statut du bâtiment affiché change (annulation, tournée…), on redessine la fiche
    Statuts.surChangement(function (ids) { if (!edition && idCourant && ids.indexOf(idCourant) >= 0) dessiner(); });
  }

  function ouvert() { return idCourant !== null; }
  function fermer() {
    idCourant = null; el.hidden = true; contenu.innerHTML = '';
    CarteImmo.surligner([]);
  }

  function ouvrir(id) {
    Ui.fermerVolets();
    idCourant = id;
    el.hidden = false;
    CarteImmo.surligner([id]);
    dessiner();
    chercherAdresse(id);
  }

  // Adresse : étiquette OSM sinon géocodage inverse, une seule fois par bâtiment
  function adresseConnue(id) {
    if (id.indexOf('man/') === 0) return Statuts.adresseDe(id);
    var f = DataImmo.batiment(id);
    return (f && DataImmo.adresse(f.properties)) || Statuts.adresseDe(id);
  }

  function chercherAdresse(id) {
    if (adresseConnue(id)) return;
    var c = CarteImmo.centre(id);
    if (!c) return;
    Geocode.inverse(c[0], c[1]).then(function (label) {
      if (!label) return;
      Statuts.setAdresse(id, label);
      CarteImmo.rafraichir(id);
      if (idCourant === id) dessiner();
    }).catch(function () { /* silencieux : l'adresse restera « inconnue » */ });
  }

  // Enregistre la saisie d'un champ sans redessiner la fiche
  function modifierChamp(id, patch) {
    edition = true;
    try { Statuts.modifier([id], patch); } finally { edition = false; }
  }

  function ligne(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte !== undefined) e.textContent = texte;
    return e;
  }

  function champ(libelle, controle) {
    var l = document.createElement('label');
    l.className = 'champ';
    l.appendChild(ligne('span', null, libelle));
    l.appendChild(controle);
    return l;
  }

  function dessiner() {
    var id = idCourant;
    if (!id) return;
    var manuel = id.indexOf('man/') === 0;
    var f = manuel ? null : DataImmo.batiment(id);
    var rec = Statuts.get(id) || {};
    var statut = Statuts.statutDe(id);
    contenu.innerHTML = '';

    contenu.appendChild(ligne('h2', null, manuel ? 'Point ajouté à la main' : DataImmo.typeBatiment(f.properties)));
    var adr = adresseConnue(id);
    contenu.appendChild(ligne('p', 'adresse', adr || 'Adresse inconnue (recherche en cours…)'));

    var grille = ligne('div', 'grille-statuts');
    Statuts.LISTE.forEach(function (st) {
      grille.appendChild(Ui.boutonStatut(st, st.id === statut, function () {
        Statuts.modifier([id], { statut: st.id });
      }));
    });
    contenu.appendChild(grille);

    var date = document.createElement('input');
    date.type = 'datetime-local'; date.value = rec.date || '';
    date.disabled = statut === 'aucun';
    date.addEventListener('change', function () { modifierChamp(id, { date: date.value }); });
    contenu.appendChild(champ('Date et heure', date));

    var logements = document.createElement('input');
    logements.type = 'number'; logements.min = '1'; logements.step = '1'; logements.inputMode = 'numeric';
    logements.value = rec.logements || '';
    logements.placeholder = '1';
    logements.addEventListener('change', function () {
      var n = parseInt(logements.value, 10);
      modifierChamp(id, { logements: n > 0 ? n : '' });
    });
    contenu.appendChild(champ('Nombre de logements', logements));

    var note = document.createElement('textarea');
    note.rows = 3; note.value = rec.note || ''; note.placeholder = 'Nom, remarque, rappel…';
    note.addEventListener('change', function () { modifierChamp(id, { note: note.value.trim() }); });
    contenu.appendChild(champ('Note', note));

    if (manuel) {
      var sup = ligne('button', 'btn-danger', 'Supprimer ce point');
      sup.type = 'button';
      sup.addEventListener('click', function () {
        Statuts.supprimerManuel(id);
        CarteImmo.retirer(id);
        fermer();
      });
      contenu.appendChild(sup);
    }
  }

  return { init: init, ouvrir: ouvrir, fermer: fermer, ouvert: ouvert };
})();
