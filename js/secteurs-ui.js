/*
 * secteurs-ui.js – Volet « Secteurs » : liste, avancement, actions.
 * Expose l'objet global SecteursUi.
 */
var SecteursUi = (function () {
  'use strict';

  var volet, liste, msg, btnOuvrir, caseCouleur, idRenommer = null, alerter = function () {};

  function el(tag, classe, texte) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texte !== undefined) e.textContent = texte;
    return e;
  }

  function bouton(texte, titre, fn, classe) {
    var b = el('button', classe || 'btn-petit', texte);
    b.type = 'button'; b.title = titre; b.setAttribute('aria-label', titre);
    b.addEventListener('click', fn);
    return b;
  }

  function ouvrir() {
    Ui.fermerVolets(); Panneau.fermer();
    volet.hidden = false; btnOuvrir.setAttribute('aria-pressed', 'true');
    dessiner();
  }
  function fermer() { volet.hidden = true; btnOuvrir.setAttribute('aria-pressed', 'false'); }

  // Barre d'avancement : un segment coloré par statut
  function barre(st) {
    var b = el('div', 's-barre');
    b.setAttribute('role', 'img');
    b.setAttribute('aria-label', st.faits + ' faits sur ' + st.total);
    if (st.total) Statuts.LISTE.forEach(function (s) {
      var n = st.parStatut[s.id];
      if (!n) return;
      var seg = el('span'); seg.style.width = (100 * n / st.total) + '%'; seg.style.background = s.couleur;
      seg.title = s.label + ' : ' + n;
      b.appendChild(seg);
    });
    return b;
  }

  function ligne(s) {
    var st = Secteurs.stats(s.id);
    var li = el('li'); li.dataset.id = s.id;

    var tete = el('div', 's-tete');
    var pastille = el('span', 'pastille'); pastille.style.background = s.couleur; pastille.style.borderColor = s.couleur;
    tete.appendChild(pastille);
    if (idRenommer === s.id) {
      var inp = el('input', 's-nom-input'); inp.type = 'text'; inp.value = s.nom; inp.maxLength = 80; inp.setAttribute('aria-label', 'Nom du secteur');
      var fini = function () { idRenommer = null; Secteurs.renommer(s.id, inp.value); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') fini(); else if (e.key === 'Escape') { idRenommer = null; dessiner(); } });
      inp.addEventListener('blur', function () { if (idRenommer === s.id) fini(); });
      tete.appendChild(inp);
      setTimeout(function () { inp.focus(); inp.select(); }, 0);
    } else {
      var nom = el('button', 's-nom', s.nom); nom.type = 'button'; nom.title = 'Voir ce secteur sur la carte';
      nom.addEventListener('click', function () { Secteurs.voir(s.id); });
      tete.appendChild(nom);
    }
    tete.appendChild(el('span', 's-pct', st.pct === null ? '—' : st.pct + ' %'));
    li.appendChild(tete);
    li.appendChild(barre(st));

    var ch = Secteurs.etatChargement();
    var enCharge = ch && ch.id === s.id;
    li.appendChild(el('div', 's-texte', st.total
      ? st.total + ' bâtiment(s) · ' + st.faits + ' fait(s) · ' + st.aFaire + ' à faire'
      : (enCharge ? '' : 'Aucun bâtiment chargé dans ce secteur : utilisez « Charger les bâtiments ».')));
    if (enCharge) li.appendChild(el('div', 's-texte', 'Chargement des bâtiments : zone ' + Math.min(ch.fait + 1, ch.total) + '/' + ch.total + '…'));

    var actions = el('div', 's-actions');
    var trouOn = Secteurs.trousActifs() === s.id;
    var bTrous = bouton('🔍 Non faits', 'Mettre en évidence les maisons restant à faire', function () { Secteurs.basculerTrous(s.id); }, 'btn-petit');
    bTrous.setAttribute('aria-pressed', trouOn ? 'true' : 'false'); bTrous.dataset.action = 'trous';
    var bSuivant = bouton('⏭ Suivant', 'Aller à la prochaine maison à faire', function () {
      var id = Secteurs.suivant(s.id);
      if (!id) { alerter('Toutes les maisons de ce secteur sont faites 🎉'); return; }
      Panneau.ouvrir(id);
    }); bSuivant.dataset.action = 'suivant';
    var bCharger = bouton('📥 Charger les bâtiments', 'Télécharger les bâtiments de tout le secteur', function () {
      Secteurs.chargerBatiments(s.id).then(function (n) {
        alerter(n + ' nouveau(x) bâtiment(s) chargé(s) pour « ' + s.nom + ' ».');
      }).catch(function (e) { alerter(e.message || 'Chargement impossible.'); });
    }); bCharger.dataset.action = 'charger'; bCharger.disabled = !!ch;
    var bRen = bouton('✎', 'Renommer', function () { idRenommer = s.id; dessiner(); });
    var bSup = bouton('🗑', 'Supprimer ce secteur', function () {
      if (window.confirm('Supprimer le secteur « ' + s.nom + ' » ?\n(Les maisons et leurs statuts ne sont pas touchés.)')) Secteurs.supprimer(s.id);
    }, 'btn-petit btn-danger-petit');
    bSup.dataset.action = 'supprimer';
    [bTrous, bSuivant, bCharger, bRen, bSup].forEach(function (b) { actions.appendChild(b); });
    li.appendChild(actions);
    return li;
  }

  function dessiner() {
    if (volet.hidden) return;
    // Ne pas reconstruire pendant une saisie (perte du curseur)
    var actif = document.activeElement;
    if (actif && actif.classList && actif.classList.contains('s-nom-input') && idRenommer) return;
    liste.innerHTML = '';
    var tous = Secteurs.liste();
    if (!tous.length) liste.appendChild(el('li', 'vide', 'Aucun secteur. Dessinez-en un pour suivre votre couverture.'));
    tous.forEach(function (s) { liste.appendChild(ligne(s)); });
    caseCouleur.checked = !!Secteurs.options().colorer;
  }

  function init(fnAlerter) {
    alerter = fnAlerter;
    volet = document.getElementById('secteurs');
    liste = document.getElementById('secteurs-liste');
    msg = document.getElementById('secteurs-msg');
    btnOuvrir = document.getElementById('btn-secteurs');
    caseCouleur = document.getElementById('secteurs-couleur');
    btnOuvrir.addEventListener('click', function () { if (volet.hidden) ouvrir(); else fermer(); });
    document.getElementById('secteurs-nouveau').addEventListener('click', function () {
      fermer(); Secteurs.demarrerDessin();
    });
    caseCouleur.addEventListener('change', function () { Secteurs.definirOption('colorer', caseCouleur.checked); });
    Secteurs.surMaj(dessiner);
  }

  // Ouvre le volet et passe directement le nouveau secteur en saisie du nom
  function ouvrirPourRenommer(id) { idRenommer = id; ouvrir(); }

  return { init: init, ouvrir: ouvrir, fermer: fermer, ouvrirPourRenommer: ouvrirPourRenommer };
})();
