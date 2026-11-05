/*
 * notifications.js – Messages éphémères (en bas de l'écran), avec action facultative (ex. « Annuler »).
 * Une notification peut être réutilisée par clé (ex. tournée : « 3 maisons marquées ») au lieu d'en empiler.
 * Expose l'objet global Notif ; Notif.alerter(texte) est la forme simple utilisée partout.
 */
var Notif = (function () {
  'use strict';

  var zone, parCle = {};
  var ICONES = { info: 'info', succes: 'circle-check', erreur: 'triangle-alert', alerte: 'triangle-alert', horsligne: 'wifi-off' };

  function fermer(n) {
    if (!n || n.ferme) return;
    n.ferme = true; clearTimeout(n.timer);
    if (n.cle) delete parCle[n.cle];
    n.el.classList.add('sortie');
    setTimeout(function () { if (n.el.parentNode) n.el.parentNode.removeChild(n.el); }, 240);
  }

  function minuter(n, duree) {
    clearTimeout(n.timer);
    var c = n.el.querySelector('.chrono');
    if (c) { var c2 = c.cloneNode(); c2.style.animationDuration = duree + 'ms'; c.parentNode.replaceChild(c2, c); }
    n.timer = setTimeout(function () { fermer(n); }, duree);
  }

  /*
   * o : { type: 'info'|'succes'|'erreur'|'alerte'|'horsligne', action: { texte, fn }, duree (ms), cle }
   * Renvoie { maj(texte, o), fermer() }.
   */
  function afficher(texte, o) {
    o = o || {};
    zone = zone || document.getElementById('notifications');
    var duree = o.duree || (o.action ? 6000 : 4200);
    var exist = o.cle && parCle[o.cle];
    if (exist && !exist.ferme) { exist.maj(texte, o); return exist; }

    var el = Ui.el('div', 'notif ' + (o.type || 'info'));
    el.setAttribute('role', o.type === 'erreur' ? 'alert' : 'status');
    el.appendChild(Ui.icone(ICONES[o.type] || 'info'));
    var t = Ui.el('div', 'texte', texte); el.appendChild(t);
    var bAction = null;
    if (o.action) { bAction = Ui.bouton(o.action.texte, 'action'); el.appendChild(bAction); }
    var bFermer = Ui.bouton(Ui.icone('x', 'ic-sm'), 'fermer', null, { 'aria-label': 'Fermer' }); el.appendChild(bFermer);
    el.appendChild(Ui.el('span', 'chrono'));
    var n = { el: el, cle: o.cle, ferme: false, action: o.action };
    if (bAction) bAction.addEventListener('click', function () { if (n.action) n.action.fn(); fermer(n); });
    bFermer.addEventListener('click', function () { fermer(n); });
    n.maj = function (tx, o2) {
      t.textContent = tx;
      if (o2 && o2.type) {   // le type peut changer (ex. « nouvel essai… » puis « erreur »)
        el.className = 'notif ' + o2.type;
        el.setAttribute('role', o2.type === 'erreur' ? 'alert' : 'status');
        el.replaceChild(Ui.icone(ICONES[o2.type] || 'info'), el.firstChild);
      }
      if (o2 && o2.action) n.action = o2.action;
      minuter(n, (o2 && o2.duree) || duree);
    };
    n.fermer = function () { fermer(n); };
    if (o.cle) parCle[o.cle] = n;
    zone.appendChild(el);
    // 3 notifications maximum à l'écran
    var toutes = zone.querySelectorAll('.notif:not(.sortie)');
    if (toutes.length > 3) toutes[0].querySelector('.fermer').click();
    minuter(n, duree);
    return n;
  }

  function alerter(texte, type) { return afficher(texte, { type: type || (/impossible|erreur|refus|injoignable|occupé|invalide|n'est pas/i.test(texte) ? 'erreur' : 'info') }); }

  return { afficher: afficher, alerter: alerter };
})();
