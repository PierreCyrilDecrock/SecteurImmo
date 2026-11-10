/*
 * panneau.js – Fiche d'un bâtiment : statut en un geste, date du passage, contact (nom, téléphone),
 * qualification, note, historique, type et logements, bâtiment suivant du secteur.
 * Immeuble : statut de tous les logements non détaillés, liste des logements détaillés (chacun avec sa
 * propre fiche), accès (digicode, interphone, gardien, boîtes aux lettres, syndic).
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
    Etiquettes.surChangement(function () { if (idCourant && !edition) dessiner(); });
    // Une fiche du même bâtiment a changé (bâtiment ou l'un de ses logements) : on redessine
    Statuts.surChangement(function (ids) {
      if (edition || !idCourant) return;
      var b = Statuts.parent(idCourant);
      if (ids.some(function (x) { return Statuts.parent(x) === b; })) {
        if (!Statuts.get(idCourant) && Statuts.estLot(idCourant)) idCourant = b;   // logement supprimé (ou annulé)
        dessiner();
      }
    });
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
    chercherAdresse(Statuts.parent(id));
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

  // Potentiel : icône et teinte associées
  var POTENTIEL = { chaud: ['flame', '#dc2626'], tiede: ['thermometer', '#d97706'], froid: ['snowflake', '#2563eb'] };

  // Puces de choix d'une qualification (un nouveau clic sur la valeur choisie l'efface)
  function choixQualif(id, champ, valeur) {
    var w = el('div', 'puces'); w.setAttribute('role', 'group'); w.setAttribute('aria-label', Statuts.QUALIF[champ].titre);
    Statuts.QUALIF[champ].valeurs.forEach(function (v) {
      var contenu = [v[1]];
      if (champ === 'potentiel') contenu.unshift(icone(POTENTIEL[v[0]][0], 'ic-sm'));
      var b = Ui.bouton(contenu, 'puce', function () {
        var nouveau = valeur === v[0] ? '' : v[0];
        var patch = {}; patch[champ] = nouveau;
        Statuts.modifier([id], patch); Ui.vibrer(8);
      }, { 'aria-pressed': valeur === v[0] ? 'true' : 'false' });
      b.dataset.champ = champ; b.dataset.valeur = v[0];
      if (champ === 'potentiel') b.style.setProperty('--c', POTENTIEL[v[0]][1]);
      w.appendChild(b);
    });
    return w;
  }

  function dateCourte(d) {
    if (!d) return '';
    var dt = new Date(d.slice(0, 10) + 'T' + (d.slice(11, 16) || '00:00'));
    return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + (d.length > 10 ? ' · ' + d.slice(11, 16) : '');
  }

  // Secteurs contenant ce bâtiment
  function secteursDe(id) {
    return Secteurs.liste().filter(function (s) { return Secteurs.membresDe(s.id).indexOf(id) >= 0; });
  }
  // Immeuble (plusieurs logements, ou logements déjà détaillés) : vue dédiée
  function estMultiLogements(id) { return Statuts.aDesLogements(id) || TypesBati.logementsDe(id) > 1; }

  // ---------- Blocs communs (bâtiment ou logement) ----------

  function grilleStatuts(id) {
    var statut = Statuts.statutDe(id);
    var grille = el('div', 'choix-statuts tuiles');
    Statuts.ORDRE_CHOIX.forEach(function (sid, i) {
      var stc = Statuts.parId(sid);
      var b = Ui.boutonStatut(stc, sid === statut, function () { choisir(sid); }, i + 1);
      b.querySelector('.libelle').textContent = stc.court; b.title = stc.label;
      grille.appendChild(b);
    });
    return grille;
  }
  function blocEtiquettes(id, rec) {
    var s = section('Étiquettes', 'tags');
    s.appendChild(EtiquettesUi.bloc(rec.etiquettes, function (liste) { Statuts.modifier([id], { etiquettes: liste }); }));
    return s;
  }
  function blocPassage(id, rec) {
    var s = section('Passage', 'calendar');
    var date = saisie('datetime-local', rec.date, { 'aria-label': 'Date et heure du passage' });
    date.disabled = Statuts.statutDe(id) === 'aucun';
    date.addEventListener('change', function () { modifierChamp(id, { date: date.value }); });
    s.appendChild(champ('Date et heure du dernier passage', date));
    return s;
  }
  function blocContact(id, rec) {
    var s = section('Contact', 'user');
    var nom = saisie('text', rec.nom, { placeholder: 'Ex. Mme Durand', autocomplete: 'off', maxlength: '120' });
    nom.addEventListener('change', function () { modifierChamp(id, { nom: nom.value.trim() }); });
    s.appendChild(champ('Nom', nom));
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
    var c = champ('Téléphone', ligneTel); c.style.marginTop = '10px';
    s.appendChild(c);
    return s;
  }
  function blocQualif(id, rec) {
    var s = section('Qualification', 'target');
    ['potentiel', 'projet', 'echeance', 'occupant'].forEach(function (ch) {
      var ligne = el('div', 'ligne-qualif');
      ligne.appendChild(el('span', 'etiquette', Statuts.QUALIF[ch].titre));
      ligne.appendChild(choixQualif(id, ch, rec[ch]));
      s.appendChild(ligne);
    });
    return s;
  }
  function blocNote(id, rec, aide) {
    var s = section('Note', 'sticky-note');
    var note = saisie('textarea', rec.note, { placeholder: aide || 'Projet de vente, remarque, horaires…', rows: '3', 'aria-label': 'Note' });
    note.addEventListener('change', function () { modifierChamp(id, { note: note.value.trim() }); });
    s.appendChild(note);
    return s;
  }
  function blocHistorique(rec) {
    if (!rec.historique || !rec.historique.length) return null;
    var s = section('Historique des passages', 'history');
    var frise = el('ol', 'frise');
    rec.historique.slice().reverse().forEach(function (hst) {
      var li = el('li'); li.style.setProperty('--c', 'var(--st-' + hst.statut + ')');
      li.appendChild(el('span', null, Statuts.parId(hst.statut).label + (hst.n > 1 ? ' · ' + hst.n + ' logements' : '')));
      li.appendChild(el('span', 'quand', dateCourte(hst.date)));
      frise.appendChild(li);
    });
    s.appendChild(frise);
    return s;
  }

  // Bâtiment : type (corrigeable) et nombre de logements
  function blocBatiment(id, rec, manuel) {
    var s = section('Bâtiment', 'building');
    var g = el('div', 'grille-2'); g.style.gridTemplateColumns = '1fr 110px';
    var sel = el('select', 'saisie'); sel.id = 'fiche-type';
    var typeDonnees = manuel ? 'maison' : (DataImmo.batiment(id) ? TypesBati.classer(DataImmo.batiment(id).properties) : 'maison');
    TypesBati.LISTE.forEach(function (t) {
      var o = el('option', null, t.label + (t.id === typeDonnees && rec.type && rec.type !== typeDonnees ? ' (données)' : '')); o.value = t.id; sel.appendChild(o);
    });
    sel.value = TypesBati.typeDe(id);
    sel.addEventListener('change', function () { Statuts.modifier([id], { type: sel.value === typeDonnees ? '' : sel.value }); Notif.afficher('Type corrigé : ' + TypesBati.parId(sel.value).court + '.', { cle: 'type' }); });
    g.appendChild(champ('Type', sel));
    var nDonnees = TypesBati.logementsDonnees(id);
    var log = saisie('number', rec.logements, { min: '1', step: '1', inputmode: 'numeric', placeholder: String(nDonnees || (TypesBati.typeDe(id) === 'immeuble' ? 2 : 1)), id: 'fiche-logements' });
    log.addEventListener('change', function () { var n = parseInt(log.value, 10); modifierChamp(id, { logements: n > 0 ? n : '' }); dessiner(); });
    g.appendChild(champ('Logements', log));
    s.appendChild(g);
    var info = [];
    if (nDonnees) info.push(nDonnees + ' logement' + (nDonnees > 1 ? 's' : '') + ' selon l\'IGN');
    var etg = TypesBati.etagesDe(id); if (etg) info.push(etg + ' étage' + (etg > 1 ? 's' : ''));
    if (info.length) s.appendChild(el('p', 'aide-champ', info.join(' · ')));
    return s;
  }

  // Accès d'un immeuble : digicode, interphone, gardien, boîtes aux lettres, syndic
  function blocAcces(id, rec) {
    var s = section('Accès', 'key-round');
    var g = el('div', 'grille-2');
    var code = saisie('text', rec.digicode, { placeholder: 'Ex. 4589B', autocomplete: 'off', maxlength: '40', id: 'fiche-digicode' });
    code.addEventListener('change', function () { modifierChamp(id, { digicode: code.value.trim() }); });
    g.appendChild(champ('Digicode', code));
    var syn = saisie('text', rec.syndic, { placeholder: 'Nom du syndic', autocomplete: 'off', maxlength: '120' });
    syn.addEventListener('change', function () { modifierChamp(id, { syndic: syn.value.trim() }); });
    g.appendChild(champ('Syndic', syn));
    s.appendChild(g);
    var puces = el('div', 'puces'); puces.style.marginTop = '10px';
    [['interphone', 'bell-ring', 'Interphone'], ['gardien', 'user-round', 'Gardien']].forEach(function (x) {
      puces.appendChild(Ui.bouton([icone(x[1], 'ic-sm'), x[2]], 'puce', function () { var p = {}; p[x[0]] = rec[x[0]] ? '' : true; Statuts.modifier([id], p); }, { 'aria-pressed': rec[x[0]] ? 'true' : 'false', 'data-acces': x[0] }));
    });
    [['acces', 'Boîtes aux lettres accessibles'], ['ferme', 'Boîtes fermées']].forEach(function (x) {
      puces.appendChild(Ui.bouton([icone('mailbox', 'ic-sm'), x[1]], 'puce', function () { Statuts.modifier([id], { boites: rec.boites === x[0] ? '' : x[0] }); }, { 'aria-pressed': rec.boites === x[0] ? 'true' : 'false', 'data-boites': x[0] }));
    });
    s.appendChild(puces);
    return s;
  }

  // Liste des logements détaillés d'un immeuble, ajout d'un logement
  function blocLogements(id) {
    var av = Statuts.avancement(id), lots = Statuts.lotsDe(id);
    var s = section('Logements', 'building-2');
    var resume = el('div', 'resume-logements');
    resume.appendChild(el('strong', 'num', av.faits + ' / ' + av.total));
    resume.appendChild(el('span', null, 'logements faits'));
    var j = el('div', 'jauge'); var js = el('span'); js.style.width = (av.total ? Math.round(100 * av.faits / av.total) : 0) + '%'; js.style.setProperty('--c', 'var(--st-contact)'); j.appendChild(js);
    resume.appendChild(j);
    s.appendChild(resume);
    if (lots.length) {
      var ul = el('ul', 'liste-logements');
      lots.forEach(function (l) {
        var r = Statuts.get(l) || {}, st = Statuts.parId(r.statut);
        var li = el('li');
        var b = Ui.bouton([el('span', 'pastille'), el('span', 'nom-logement', r.libelle || 'Logement'), el('span', 'detail', [r.nom, st.court].filter(Boolean).join(' · ')), icone('chevron-right', 'ic-sm')],
          'ligne-logement', function () { ouvrir(l); }, { 'data-lot': l });
        b.style.setProperty('--c', 'var(--st-' + st.id + ')');
        li.appendChild(b); ul.appendChild(li);
      });
      s.appendChild(ul);
    }
    var f = el('form', 'ajout-logement');
    var inp = saisie('text', '', { placeholder: 'Apt 12, 2e gauche, M. Martin…', maxlength: '60', 'aria-label': 'Nom du logement à ajouter', id: 'fiche-nouveau-logement', autocomplete: 'off' });
    f.appendChild(inp);
    f.appendChild(Ui.bouton([icone('plus', 'ic-sm'), 'Ajouter'], 'btn', null, { type: 'submit', id: 'fiche-ajouter-logement' }));
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var lot = Statuts.ajouterLot(id, inp.value);
      ouvrir(lot);
    });
    s.appendChild(f);
    s.appendChild(el('p', 'aide-champ', 'Détaillez un logement quand vous parlez à quelqu\'un ou qu\'il demande un suivi ; les autres suivent le statut de l\'immeuble.'));
    return s;
  }

  // ---------- Fiche ----------

  function dessiner(nouveau) {
    var id = idCourant;
    if (!id) return;
    var corpsAvant = contenu.querySelector('.fiche-corps');
    var defilement = corpsAvant && !nouveau ? corpsAvant.scrollTop : 0;
    contenu.innerHTML = '';
    var corps = Statuts.estLot(id) ? dessinerLogement(id) : dessinerBatiment(id);
    contenu.appendChild(corps.tete);
    contenu.appendChild(corps.corps);
    corps.corps.scrollTop = defilement;
    if (corps.pied && corps.pied.children.length) contenu.appendChild(corps.pied);
  }

  function enTete(chipsContenu, titreNode, sousTexte, avant) {
    var tete = el('div', 'fiche-tete');
    if (avant) tete.appendChild(avant);
    var titre = el('div', 'fiche-titre');
    var chips = el('div', 'fiche-chips');
    chipsContenu.forEach(function (c) { chips.appendChild(c); });
    titre.appendChild(chips);
    titre.appendChild(titreNode);
    titre.appendChild(el('p', 'sous-titre', sousTexte));
    tete.appendChild(titre);
    tete.appendChild(Ui.bouton(icone('x'), 'btn btn-fantome btn-icone', fermer, { 'aria-label': 'Fermer la fiche', id: 'panneau-fermer' }));
    return tete;
  }
  function chipPotentiel(rec) {
    if (!rec.potentiel) return null;
    var pc = el('span', 'etiquette-statut'); pc.style.setProperty('--c', POTENTIEL[rec.potentiel][1]);
    pc.appendChild(icone(POTENTIEL[rec.potentiel][0])); pc.appendChild(document.createTextNode('Potentiel ' + Statuts.libelleQualif('potentiel', rec.potentiel).toLowerCase()));
    return pc;
  }

  function dessinerBatiment(id) {
    var manuel = id.indexOf('man/') === 0;
    var rec = Statuts.get(id) || {};
    var adr = adresseConnue(id);
    var secteurs = secteursDe(id);
    var multi = estMultiLogements(id), av = Statuts.avancement(id);

    var h = el('h2'); h.id = 'fiche-titre';
    if (adr) h.textContent = adr.replace(/^≈\s*/, '');
    else if (recherches[id] && !manuel) h.textContent = 'Adresse inconnue';
    else if (manuel) h.textContent = 'Maison ajoutée';
    else h.appendChild(el('span', 'chargement-adresse'));
    var t = TypesBati.parId(TypesBati.typeDe(id));
    var sous = [manuel ? 'Ajoutée à la main' : t.court];
    if (multi) sous.push(av.total + ' logements');
    if (adr && /^≈/.test(adr)) sous.push('adresse approximative');
    if (secteurs.length) sous.push(secteurs.map(function (s) { return s.nom; }).join(', '));
    var chips = [Ui.etiquetteStatut(Statuts.parId(multi ? Statuts.statutAffiche(id) : Statuts.statutDe(id)))];
    if (chipPotentiel(rec)) chips.push(chipPotentiel(rec));
    var tete = enTete(chips, h, sous.join(' · '));

    var corps = el('div', 'fiche-corps');
    var nonDetailles = Statuts.poids(id);
    if (multi) {
      var sStatut = section(Statuts.aDesLogements(id) ? 'Logements non détaillés (' + nonDetailles + ')' : 'Tout l\'immeuble (' + nonDetailles + ' logements)', 'flag');
      if (nonDetailles > 0) {
        sStatut.appendChild(el('p', 'aide-champ', 'Un geste pour tous les logements : par exemple, prospectus dans toutes les boîtes. Chacun compte pour une porte.'));
        sStatut.appendChild(grilleStatuts(id));
      } else sStatut.appendChild(el('p', 'aide-champ', 'Tous les logements sont détaillés ci-dessous.'));
      corps.appendChild(sStatut);
      corps.appendChild(blocLogements(id));
      corps.appendChild(blocAcces(id, rec));
      corps.appendChild(blocEtiquettes(id, rec));
      if (Statuts.statutDe(id) !== 'aucun') corps.appendChild(blocPassage(id, rec));
      if (rec.nom || rec.tel) corps.appendChild(blocContact(id, rec));
      corps.appendChild(blocNote(id, rec, 'Accès, horaires du gardien, remarques…'));
      corps.appendChild(blocBatiment(id, rec, manuel));
    } else {
      var s1 = section('Statut', 'flag'); s1.appendChild(grilleStatuts(id)); corps.appendChild(s1);
      corps.appendChild(blocEtiquettes(id, rec));
      corps.appendChild(blocPassage(id, rec));
      corps.appendChild(blocContact(id, rec));
      corps.appendChild(blocQualif(id, rec));
      corps.appendChild(blocNote(id, rec));
      corps.appendChild(blocBatiment(id, rec, manuel));
    }
    var hist = blocHistorique(rec); if (hist) corps.appendChild(hist);

    // Pied : bâtiment suivant du secteur, centrer, suppression d'un point ajouté
    var pied = el('div', 'fiche-pied');
    var secteurAvecTrous = secteurs.filter(function (s) { return Secteurs.nonFaits(s.id).some(function (b) { return b !== id; }); })[0];
    if (secteurAvecTrous) {
      pied.appendChild(Ui.bouton([icone('skip-forward'), 'Suivant à faire'], 'btn btn-primaire', function () {
        var suivant = Secteurs.suivant(secteurAvecTrous.id, id);
        if (suivant) ouvrir(suivant);
      }, { id: 'fiche-suivante' }));
    }
    pied.appendChild(Ui.bouton([icone('crosshair')], 'btn btn-icone', function () {
      CarteImmo.getMap().setView(CarteImmo.centre(id), Math.max(CarteImmo.getMap().getZoom(), 18));
    }, { 'aria-label': 'Centrer la carte sur le bâtiment', 'data-tip': 'Centrer' }));
    if (manuel) {
      pied.appendChild(Ui.bouton([icone('trash-2'), 'Supprimer'], 'btn btn-danger', function () {
        Ui.confirmer({ titre: 'Supprimer cette maison ?', message: 'Le point ajouté et ses informations seront supprimés.', bouton: 'Supprimer', danger: true }).then(function (ok) {
          if (!ok) return;
          Statuts.supprimerManuel(id); CarteImmo.retirer(id); fermer(); CarteUi.majLegende();
          Notif.afficher('Maison supprimée.', { type: 'succes' });
        });
      }, { id: 'fiche-supprimer' }));
    }
    return { tete: tete, corps: corps, pied: pied };
  }

  // Logement détaillé d'un immeuble
  function dessinerLogement(id) {
    var b = Statuts.parent(id), rec = Statuts.get(id) || {};
    var retour = Ui.bouton(icone('arrow-left'), 'btn btn-fantome btn-icone', function () { ouvrir(b); }, { 'aria-label': 'Retour à l\'immeuble', 'data-tip': 'Immeuble', id: 'fiche-retour' });
    var h = el('h2'); h.id = 'fiche-titre'; h.textContent = rec.libelle || 'Logement';
    var chips = [Ui.etiquetteStatut(Statuts.parId(Statuts.statutDe(id)))];
    if (chipPotentiel(rec)) chips.push(chipPotentiel(rec));
    var tete = enTete(chips, h, 'Logement · ' + (adresseConnue(b) || 'immeuble').replace(/^≈\s*/, ''), retour);

    var corps = el('div', 'fiche-corps');
    var sNom = section('Logement', 'door-open');
    var lib = saisie('text', rec.libelle, { maxlength: '60', placeholder: 'Apt 12, 2e gauche…', id: 'fiche-libelle', 'aria-label': 'Nom du logement' });
    lib.addEventListener('change', function () { modifierChamp(id, { libelle: lib.value.trim() || 'Logement' }); dessiner(); });
    sNom.appendChild(lib);
    corps.appendChild(sNom);
    var s1 = section('Statut', 'flag'); s1.appendChild(grilleStatuts(id)); corps.appendChild(s1);
    corps.appendChild(blocEtiquettes(id, rec));
    corps.appendChild(blocPassage(id, rec));
    corps.appendChild(blocContact(id, rec));
    corps.appendChild(blocQualif(id, rec));
    corps.appendChild(blocNote(id, rec));
    var hist = blocHistorique(rec); if (hist) corps.appendChild(hist);

    var pied = el('div', 'fiche-pied');
    pied.appendChild(Ui.bouton([icone('building-2'), 'Immeuble'], 'btn', function () { ouvrir(b); }, { id: 'fiche-immeuble' }));
    pied.appendChild(Ui.bouton([icone('trash-2'), 'Supprimer'], 'btn btn-danger', function () {
      Ui.confirmer({ titre: 'Supprimer ce logement ?', message: 'Ses informations (statut, contact, note) seront supprimées ; il reprendra le statut de l\'immeuble.', bouton: 'Supprimer', danger: true }).then(function (ok) {
        if (!ok) return;
        Statuts.supprimerLot(id); ouvrir(b);
        Notif.afficher('Logement supprimé.', { type: 'succes', action: { texte: 'Annuler', fn: function () { Outils.annuler(); } } });
      });
    }, { id: 'fiche-supprimer-logement' }));
    return { tete: tete, corps: corps, pied: pied };
  }

  // Choix d'un statut (bouton ou touche 1 à 9)
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
