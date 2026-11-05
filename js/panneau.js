/*
 * panneau.js – Fiche d'une maison : statut en un geste, date du passage, contact (nom, téléphone),
 * logements, note, historique des passages, maison suivante du secteur.
 * Volet à droite sur ordinateur, feuille glissante en bas sur téléphone.
 * Expose l'objet global Panneau.
 */
var Panneau = (function () {
  'use strict';

  var contenu, idCourant = null, recherches = {};
  var edition = false; // vrai pendant la saisie d'un champ : on ne reconstruit pas la fiche (sinon le focus est perdu)
  var el = Ui.el, icone = Ui.icone;

  function init() {
    contenu = document.getElementById('panneau-contenu');
    Statuts.surChangement(function (ids) { if (!edition && idCourant && ids.indexOf(idCourant) >= 0) dessiner(); });
  }

  function ouvert() { return idCourant !== null; }
  function fermer() {
    if (idCourant === null) return;
    idCourant = null;
    Coquille.fermerFiche();
    CarteImmo.surligner([]);
  }

  function ouvrir(id) {
    idCourant = id;
    CarteImmo.surligner([id]);
    dessiner(true);
    Coquille.ouvrirFiche();
    chercherAdresse(id);
  }

  // ---------- Adresse : étiquette OSM, sinon géocodage inverse (une seule fois par maison) ----------
  function adresseConnue(id) {
    if (id.indexOf('man/') === 0) return Statuts.adresseDe(id);
    var f = DataImmo.batiment(id);
    return (f && DataImmo.adresse(f.properties)) || Statuts.adresseDe(id);
  }
  function chercherAdresse(id) {
    if (adresseConnue(id) || recherches[id]) return;
    var c = CarteImmo.centre(id);
    if (!c) return;
    recherches[id] = true;
    Geocode.inverse(c[0], c[1]).then(function (label) {
      if (label) Statuts.setAdresse(id, label);
      if (idCourant === id) dessiner();
    }).catch(function () { if (idCourant === id) dessiner(); });
  }

  // ---------- Construction ----------
  function modifierChamp(id, patch) {
    edition = true;
    try { Statuts.modifier([id], patch); } finally { edition = false; }
  }

  function section(titre, ic) {
    var s = el('section', 'section');
    var h = el('h3'); if (ic) h.appendChild(icone(ic, 'ic-sm')); h.appendChild(document.createTextNode(titre));
    s.appendChild(h);
    return s;
  }
  function champ(libelle, controle) {
    var l = el('label', 'champ'); l.appendChild(el('span', null, libelle)); l.appendChild(controle); return l;
  }
  function saisie(type, valeur, attrs) {
    var i = el(type === 'textarea' ? 'textarea' : 'input', 'saisie');
    if (type !== 'textarea') i.type = type;
    i.value = valeur || '';
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  }

  function dateCourte(d) {
    if (!d) return '';
    var dt = new Date(d.slice(0, 10) + 'T' + (d.slice(11, 16) || '00:00'));
    return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + (d.length > 10 ? ' · ' + d.slice(11, 16) : '');
  }

  // Secteurs contenant cette maison
  function secteursDe(id) {
    return Secteurs.liste().filter(function (s) { return Secteurs.membresDe(s.id).indexOf(id) >= 0; });
  }

  function dessiner(nouveau) {
    var id = idCourant;
    if (!id) return;
    var corpsAvant = contenu.querySelector('.fiche-corps');
    var defilement = corpsAvant && !nouveau ? corpsAvant.scrollTop : 0;
    var manuel = id.indexOf('man/') === 0;
    var f = manuel ? null : DataImmo.batiment(id);
    var rec = Statuts.get(id) || {};
    var statut = Statuts.statutDe(id), st = Statuts.parId(statut);
    var adr = adresseConnue(id);
    var secteurs = secteursDe(id);
    contenu.innerHTML = '';

    // En-tête
    var tete = el('div', 'fiche-tete');
    var titre = el('div', 'fiche-titre');
    titre.appendChild(Ui.etiquetteStatut(st));
    var h = el('h2'); h.id = 'fiche-titre';
    if (adr) h.textContent = adr.replace(/^≈\s*/, '');
    else if (recherches[id] && !manuel) h.textContent = 'Adresse inconnue';
    else if (manuel) h.textContent = 'Maison ajoutée';
    else h.appendChild(el('span', 'chargement-adresse'));
    titre.appendChild(h);
    var sous = [manuel ? 'Ajoutée à la main' : DataImmo.typeBatiment(f.properties)];
    if (adr && /^≈/.test(adr)) sous.push('adresse approximative');
    if (secteurs.length) sous.push(secteurs.map(function (s) { return s.nom; }).join(', '));
    titre.appendChild(el('p', 'sous-titre', sous.join(' · ')));
    tete.appendChild(titre);
    tete.appendChild(Ui.bouton(icone('x'), 'btn btn-fantome btn-icone', fermer, { 'aria-label': 'Fermer la fiche', id: 'panneau-fermer' }));
    contenu.appendChild(tete);

    var corps = el('div', 'fiche-corps');

    // Statut
    var sStatut = section('Statut', 'flag');
    var grille = el('div', 'choix-statuts');
    Statuts.ORDRE_CHOIX.forEach(function (sid, i) {
      grille.appendChild(Ui.boutonStatut(Statuts.parId(sid), sid === statut, function () { choisir(sid); }, i + 1));
    });
    sStatut.appendChild(grille);
    corps.appendChild(sStatut);

    // Passage
    var sPassage = section('Passage', 'calendar');
    var date = saisie('datetime-local', rec.date, { 'aria-label': 'Date et heure du passage' });
    date.disabled = statut === 'aucun';
    date.addEventListener('change', function () { modifierChamp(id, { date: date.value }); });
    sPassage.appendChild(champ('Date et heure du dernier passage', date));
    corps.appendChild(sPassage);

    // Contact
    var sContact = section('Contact', 'user');
    var nom = saisie('text', rec.nom, { placeholder: 'Ex. Mme Durand', autocomplete: 'off', maxlength: '120' });
    nom.addEventListener('change', function () { modifierChamp(id, { nom: nom.value.trim() }); });
    sContact.appendChild(champ('Nom', nom));
    var ligneTel = el('div', 'avec-bouton');
    var tel = saisie('tel', rec.tel, { placeholder: '06 12 34 56 78', inputmode: 'tel', autocomplete: 'off', maxlength: '40' });
    var appeler = el('a', 'btn btn-icone'); appeler.setAttribute('aria-label', 'Appeler'); appeler.appendChild(icone('phone'));
    function majAppel() { var t = tel.value.replace(/[^0-9+]/g, ''); appeler.hidden = t.length < 4; appeler.href = 'tel:' + t; }
    tel.addEventListener('input', majAppel);
    tel.addEventListener('change', function () {
      var v = tel.value.trim();
      if (v && !/^[0-9+().\s-]{3,40}$/.test(v)) { Notif.alerter('Numéro de téléphone invalide.', 'erreur'); return; }
      modifierChamp(id, { tel: v });
    });
    majAppel();
    ligneTel.appendChild(tel); ligneTel.appendChild(appeler);
    var g2 = el('div', 'grille-2');
    var cTel = champ('Téléphone', ligneTel); cTel.style.gridColumn = 'span 1';
    var log = saisie('number', rec.logements, { min: '1', step: '1', inputmode: 'numeric', placeholder: '1' });
    log.addEventListener('change', function () { var n = parseInt(log.value, 10); modifierChamp(id, { logements: n > 0 ? n : '' }); });
    g2.appendChild(cTel); g2.appendChild(champ('Logements', log));
    g2.style.gridTemplateColumns = '1fr 110px'; g2.style.marginTop = '10px';
    sContact.appendChild(g2);
    corps.appendChild(sContact);

    // Note
    var sNote = section('Note', 'sticky-note');
    var note = saisie('textarea', rec.note, { placeholder: 'Projet de vente, remarque, horaires…', rows: '3', 'aria-label': 'Note' });
    note.addEventListener('change', function () { modifierChamp(id, { note: note.value.trim() }); });
    sNote.appendChild(note);
    corps.appendChild(sNote);

    // Historique
    if (rec.historique && rec.historique.length) {
      var sHist = section('Historique des passages', 'history');
      var frise = el('ol', 'frise');
      rec.historique.slice().reverse().forEach(function (hst) {
        var li = el('li'); li.style.setProperty('--c', 'var(--st-' + hst.statut + ')');
        li.appendChild(el('span', null, Statuts.parId(hst.statut).label));
        li.appendChild(el('span', 'quand', dateCourte(hst.date)));
        frise.appendChild(li);
      });
      sHist.appendChild(frise);
      corps.appendChild(sHist);
    }
    contenu.appendChild(corps);
    corps.scrollTop = defilement;

    // Pied : maison suivante du secteur, suppression d'un point ajouté
    var pied = el('div', 'fiche-pied');
    var secteurAvecTrous = secteurs.filter(function (s) { return Secteurs.nonFaits(s.id).some(function (b) { return b !== id; }); })[0];
    if (secteurAvecTrous) {
      pied.appendChild(Ui.bouton([icone('skip-forward'), 'Maison suivante à faire'], 'btn btn-primaire', function () {
        var suivant = Secteurs.suivant(secteurAvecTrous.id, id);
        if (suivant) ouvrir(suivant);
      }, { id: 'fiche-suivante' }));
    }
    pied.appendChild(Ui.bouton([icone('crosshair')], 'btn btn-icone', function () {
      CarteImmo.getMap().setView(CarteImmo.centre(id), Math.max(CarteImmo.getMap().getZoom(), 18));
    }, { 'aria-label': 'Centrer la carte sur la maison', 'data-tip': 'Centrer' }));
    if (manuel) {
      pied.appendChild(Ui.bouton([icone('trash-2'), 'Supprimer'], 'btn btn-danger', function () {
        Ui.confirmer({ titre: 'Supprimer cette maison ?', message: 'Le point ajouté et ses informations seront supprimés.', bouton: 'Supprimer', danger: true }).then(function (ok) {
          if (!ok) return;
          Statuts.supprimerManuel(id); CarteImmo.retirer(id); fermer(); CarteUi.majLegende();
          Notif.afficher('Maison supprimée.', { type: 'succes' });
        });
      }, { id: 'fiche-supprimer' }));
    }
    if (pied.children.length) contenu.appendChild(pied);
  }

  // Choix d'un statut (bouton ou touche 1 à 6)
  function choisir(sid) {
    var id = idCourant;
    if (!id) return;
    if (Statuts.statutDe(id) === sid) return;
    Statuts.modifier([id], { statut: sid });
    CarteImmo.onde(id, sid);
    Ui.vibrer();
  }

  return { init: init, ouvrir: ouvrir, fermer: fermer, ouvert: ouvert, choisir: choisir, idCourant: function () { return idCourant; } };
})();
