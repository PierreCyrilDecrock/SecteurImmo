/*
 * telechargements-ui.js – Carte de progression des téléchargements (en bas de la carte) :
 * étape en cours, nombre reçu, pourcentage, temps restant estimé, nouvel essai en cours,
 * pause / reprise / annulation, erreur avec « Réessayer ».
 * Expose l'objet global TelechargementsUi.
 */
var TelechargementsUi = (function () {
  'use strict';

  var el = Ui.el, icone = Ui.icone, boite, timer = null, dernierMessage = null;
  var ETAPES = { bat: 'Bâtiments', adr: 'Adresses', lien: 'Rattachement des adresses', dpe: 'Diagnostics énergétiques (DPE)', dvf: 'Ventes (DVF), sections cadastrales' };

  function titre(t) { return t.type === 'commune' ? t.nom : t.type === 'secteur' ? 'Secteur « ' + t.nom + ' »' : 'Zone affichée'; }
  function duree(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? m % 60 + ' min' : '');
  }

  function courante() {
    return Telechargements.actif() || Telechargements.visibles().filter(function (t) { return t.etat === 'erreur'; })[0] || Telechargements.visibles()[0] || null;
  }

  function dessiner() {
    var t = courante();
    boite.hidden = !t;
    clearInterval(timer); timer = null;
    if (!t) { boite.innerHTML = ''; CarteUi.majPastille(); return; }
    var p = Telechargements.progression(t), pct = Math.round(p.pct * 100);
    boite.className = 'telechargement verre etat-' + t.etat;
    boite.innerHTML = '';
    boite.dataset.tache = t.id;

    var ic = t.etat === 'erreur' ? 'triangle-alert' : t.etat === 'pause' ? 'circle-pause' : t.etat === 'attente' ? 'clock' : 'loader-circle';
    var med = el('span', 'tl-ic'); med.appendChild(icone(ic, 'ic-sm' + (t.etat === 'en-cours' ? ' rotation' : ''))); boite.appendChild(med);

    var tx = el('div', 'tl-texte');
    var l1 = el('div', 'tl-titre'); l1.appendChild(el('strong', null, titre(t))); l1.appendChild(el('span', 'tl-pct num', pct + ' %'));
    tx.appendChild(l1);
    var detail;
    if (t.etat === 'erreur') detail = t.erreur || 'Téléchargement interrompu.';
    else if (t.message) detail = t.message;
    else if (t.etat === 'pause') detail = 'En pause : reprenez quand vous voulez, rien n\'est perdu.';
    else if (t.etat === 'attente') detail = 'En attente…';
    else {
      detail = (ETAPES[p.etape] || 'Préparation') + (p.total ? ' : ' + Ui.nombre(Math.min(p.fait, p.total)) + ' / ' + Ui.nombre(p.total) : '…');
      if (p.restantMs !== null) detail += ' · environ ' + duree(p.restantMs) + ' restant' + (p.restantMs >= 120000 ? 'es' : 'es');
    }
    tx.appendChild(el('div', 'tl-detail', detail));
    var j = el('div', 'jauge tl-jauge'); j.setAttribute('role', 'progressbar'); j.setAttribute('aria-valuenow', String(pct)); j.setAttribute('aria-valuemin', '0'); j.setAttribute('aria-valuemax', '100');
    j.setAttribute('aria-label', 'Progression du téléchargement');
    var js = el('span'); js.style.width = pct + '%'; js.style.setProperty('--c', t.etat === 'erreur' ? 'var(--danger)' : 'var(--primaire)'); j.appendChild(js);
    tx.appendChild(j);
    var autres = Telechargements.visibles().length - 1;
    if (autres > 0) tx.appendChild(el('div', 'tl-file', '+ ' + autres + ' autre' + (autres > 1 ? 's' : '') + ' en attente'));
    boite.appendChild(tx);

    var act = el('div', 'tl-actions');
    if (t.etat === 'en-cours' || t.etat === 'attente') act.appendChild(Ui.bouton(icone('pause', 'ic-sm'), 'btn btn-sm btn-icone btn-fantome', function () { Telechargements.pause(t.id); }, { 'aria-label': 'Mettre en pause', 'data-tip': 'Pause', 'data-action': 'pause' }));
    if (t.etat === 'pause') act.appendChild(Ui.bouton([icone('play', 'ic-sm'), 'Reprendre'], 'btn btn-sm', function () { Telechargements.reprendre(t.id); }, { 'data-action': 'reprendre' }));
    if (t.etat === 'erreur') act.appendChild(Ui.bouton([icone('rotate-ccw', 'ic-sm'), 'Réessayer'], 'btn btn-sm btn-primaire', function () { Telechargements.reprendre(t.id); }, { 'data-action': 'reessayer' }));
    act.appendChild(Ui.bouton(icone('x', 'ic-sm'), 'btn btn-sm btn-icone btn-fantome', function () {
      if (t.type === 'zone') { Telechargements.annuler(t.id); return; }
      Ui.confirmer({ titre: 'Arrêter le téléchargement ?', message: 'Les bâtiments déjà reçus restent sur la carte. Vous pourrez relancer le téléchargement plus tard.', bouton: 'Arrêter' })
        .then(function (ok) { if (ok) Telechargements.annuler(t.id); });
    }, { 'aria-label': 'Annuler le téléchargement', 'data-tip': 'Annuler', 'data-action': 'annuler' }));
    boite.appendChild(act);

    if (t.etat === 'en-cours') timer = setInterval(majTexte, 1000);
    CarteUi.majPastille();
    // Message d'erreur important : aussi en notification (une fois)
    if (t.etat === 'erreur' && dernierMessage !== t.id + t.erreur) { dernierMessage = t.id + t.erreur; Notif.afficher(titre(t) + ' : ' + t.erreur, { type: 'erreur', cle: 'telechargement', duree: 9000 }); }
  }
  // Mise à jour légère du temps restant (sans tout redessiner)
  function majTexte() { var t = courante(); if (!t || t.etat !== 'en-cours') { clearInterval(timer); timer = null; return; } dessiner(); }

  function init() {
    boite = document.getElementById('telechargement');
    var t = null;
    Telechargements.surChangement(function () { clearTimeout(t); t = setTimeout(dessiner, 60); });
  }

  return { init: init, dessiner: dessiner };
})();
