/*
 * secteurs-ui.js – Panneau « Secteurs » : cartes avec anneau d'avancement, répartition par statut,
 * maisons restant à faire, maison suivante, chargement des maisons, renommage, suppression.
 * Expose l'objet global SecteursUi.
 */
var SecteursUi = (function () {
  'use strict';

  var liste, caseCouleur, idRenommer = null, visible = false, animer = false;
  var el = Ui.el, icone = Ui.icone;

  function voirSurCarte() { if (Coquille.telephone()) Coquille.fermerTiroir(); }

  function carte(s, i) {
    var st = Secteurs.stats(s.id);
    var c = el('article', 'carte-secteur' + (Secteurs.trousActifs() === s.id ? ' trous-actifs' : '') + (animer ? ' entree' : ''));
    c.dataset.id = s.id;
    if (animer) c.style.animationDelay = Math.min(i, 8) * 40 + 'ms';

    var tete = el('div', 'cs-tete');
    tete.appendChild(Ui.anneau(st.pct || 0, 46, 5, s.couleur, st.pct === null ? '—' : st.pct + '%', animer));
    var tx = el('div', 'cs-texte');
    if (idRenommer === s.id) {
      var inp = el('input', 'saisie cs-nom-saisie'); inp.type = 'text'; inp.value = s.nom; inp.maxLength = 80; inp.setAttribute('aria-label', 'Nom du secteur');
      var fini = function () { if (idRenommer !== s.id) return; idRenommer = null; Secteurs.renommer(s.id, inp.value); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') fini(); else if (e.key === 'Escape') { e.stopPropagation(); idRenommer = null; dessiner(); } });
      inp.addEventListener('blur', fini);
      tx.appendChild(inp);
      setTimeout(function () { inp.focus(); inp.select(); }, 30);
    } else {
      var nom = Ui.bouton(s.nom, 'cs-nom', function () { Secteurs.voir(s.id); voirSurCarte(); }, { title: 'Voir ce secteur sur la carte' });
      tx.appendChild(nom);
    }
    var ch = Secteurs.etatChargement(s.id), enCharge = !!ch;
    tx.appendChild(el('div', 'sous-titre', enCharge ? (ch.etat === 'erreur' ? 'Téléchargement interrompu (voir en bas de la carte)' : ch.etat === 'pause' ? 'Téléchargement en pause : ' + ch.pct + ' %' : 'Téléchargement : ' + ch.pct + ' %')
      : st.total ? Ui.nombre(st.total) + ' logement' + (st.total > 1 ? 's' : '') + ' · ' + Ui.nombre(st.faits) + ' faits · ' + Ui.nombre(st.aFaire) + ' à faire' : 'Aucun bâtiment chargé'));
    tete.appendChild(tx);
    tete.appendChild(Ui.bouton(icone('pencil', 'ic-sm'), 'btn btn-sm btn-icone btn-fantome', function () { idRenommer = s.id; dessiner(); }, { 'aria-label': 'Renommer', 'data-tip': 'Renommer', 'data-action': 'renommer' }));
    tete.appendChild(Ui.bouton(icone('trash-2', 'ic-sm'), 'btn btn-sm btn-icone btn-fantome', function () {
      Ui.confirmer({ titre: 'Supprimer « ' + s.nom + ' » ?', message: 'Le secteur sera supprimé. Les maisons et leurs statuts ne sont pas touchés.', bouton: 'Supprimer', danger: true })
        .then(function (ok) { if (ok) { Secteurs.supprimer(s.id); Notif.afficher('Secteur supprimé.', { type: 'succes' }); } });
    }, { 'aria-label': 'Supprimer ce secteur', 'data-tip': 'Supprimer', 'data-action': 'supprimer' }));
    c.appendChild(tete);

    // Répartition par statut
    var j = el('div', 'jauge multi'); j.setAttribute('role', 'img'); j.setAttribute('aria-label', st.faits + ' logements faits sur ' + st.total);
    if (st.total) Statuts.ORDRE_GRAPHIQUE.forEach(function (sid) {
      var n = st.parStatut[sid]; if (!n) return;
      var seg = el('span'); seg.style.flexBasis = (100 * n / st.total) + '%'; seg.style.background = 'var(--st-' + sid + ')'; seg.title = Statuts.parId(sid).label + ' : ' + n;
      j.appendChild(seg);
    });
    c.appendChild(j);

    var a = el('div', 'cs-actions');
    var bTrous = Ui.bouton([icone('target', 'ic-sm'), 'À faire'], 'btn btn-sm', function () { Secteurs.basculerTrous(s.id); voirSurCarte(); },
      { 'aria-pressed': Secteurs.trousActifs() === s.id ? 'true' : 'false', 'data-action': 'trous', 'data-tip': 'Mettre en évidence les maisons à faire' });
    var bSuiv = Ui.bouton([icone('skip-forward', 'ic-sm'), 'Suivante'], 'btn btn-sm', function () {
      var id = Secteurs.suivant(s.id);
      if (!id) { Notif.afficher(st.total ? 'Tous les logements de ce secteur sont faits, bravo !' : 'Téléchargez d\'abord les bâtiments du secteur.', { type: st.total ? 'succes' : 'info' }); return; }
      Coquille.fermerTiroir(); Panneau.ouvrir(id);
    }, { 'data-action': 'suivant', 'data-tip': 'Aller à la maison à faire la plus proche' });
    var bCharger = Ui.bouton([icone(enCharge ? 'loader-circle' : 'download', 'ic-sm' + (enCharge && ch.etat === 'en-cours' ? ' rotation' : '')), st.total ? 'Compléter' : 'Télécharger les bâtiments'], 'btn btn-sm' + (st.total ? '' : ' btn-primaire'), function () {
      Secteurs.chargerBatiments(s.id).then(function (r) {
        var n = r.nouveaux;
        Notif.afficher(n ? Ui.nombre(n) + ' bâtiment' + (n > 1 ? 's' : '') + ' ajouté' + (n > 1 ? 's' : '') + ' dans « ' + s.nom + ' »' : 'Secteur déjà complet.', { type: 'succes' });
        if (r.avertissement) Notif.afficher(r.avertissement, { type: 'alerte', duree: 9000 });
      }).catch(function (e) { if (!/annulé/.test(e.message)) Notif.afficher(e.message || 'Téléchargement impossible.', { type: 'erreur' }); });
    }, { 'data-action': 'charger' });
    bCharger.disabled = enCharge && ch.etat !== 'erreur';
    a.appendChild(bTrous); a.appendChild(bSuiv); a.appendChild(bCharger);
    c.appendChild(a);
    return c;
  }

  function dessiner() {
    if (!visible) return;
    var actif = document.activeElement;
    if (actif && actif.classList && actif.classList.contains('cs-nom-saisie') && idRenommer) return;
    liste.innerHTML = '';
    var tous = Secteurs.liste();
    if (!tous.length) {
      var v = el('div', 'vide');
      var m = el('div', 'medaillon'); m.appendChild(icone('pentagon', 'ic-lg')); v.appendChild(m);
      v.appendChild(el('strong', null, 'Aucun secteur pour l\'instant'));
      v.appendChild(el('span', null, 'Un secteur regroupe les rues que vous prospectez : vous suivez ainsi votre couverture.'));
      liste.appendChild(v);
    }
    tous.forEach(function (s, i) { liste.appendChild(carte(s, i)); });
    caseCouleur.checked = !!Secteurs.options().colorer;
  }

  function ouvrir() { visible = true; animer = true; dessiner(); animer = false; CommunesUi.ouvrir(); }
  function ouvrirPourRenommer(id) { idRenommer = id; Coquille.ouvrirTiroir('secteurs'); }

  function init() {
    liste = document.getElementById('secteurs-liste');
    caseCouleur = document.getElementById('secteurs-couleur');
    Coquille.enregistrer('secteurs', { ouvrir: ouvrir, fermer: function () { visible = false; CommunesUi.fermer(); } });
    document.getElementById('secteurs-nouveau').addEventListener('click', function () {
      Coquille.fermerTiroir(); Secteurs.demarrerDessin();
    });
    caseCouleur.addEventListener('change', function () { Secteurs.definirOption('colorer', caseCouleur.checked); });
    Secteurs.surMaj(dessiner);
  }

  return { init: init, ouvrir: function () { Coquille.ouvrirTiroir('secteurs'); }, fermer: function () { Coquille.fermerTiroir(); }, ouvrirPourRenommer: ouvrirPourRenommer };
})();
