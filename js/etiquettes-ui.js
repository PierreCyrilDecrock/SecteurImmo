/*
 * etiquettes-ui.js – Interface des étiquettes : puces à cocher dans la fiche (avec création rapide)
 * et fenêtre « Gérer les étiquettes » (renommer, couleur, supprimer, créer).
 * Expose l'objet global EtiquettesUi.
 */
var EtiquettesUi = (function () {
  'use strict';

  var el = Ui.el, icone = Ui.icone;

  // Puce d'une étiquette (bouton bascule)
  function puce(e, active, onClick) {
    var b = Ui.bouton([el('span', 'pastille'), e.nom], 'puce', onClick, { 'aria-pressed': active ? 'true' : 'false' });
    b.style.setProperty('--c', e.couleur);
    b.dataset.etiquette = e.id;
    return b;
  }

  /*
   * Bloc d'étiquettes pour une maison : une puce par étiquette + « Nouvelle » + « Gérer ».
   * actives : ids cochés ; onChange(nouvelleListe) appelé à chaque bascule.
   */
  function bloc(actives, onChange) {
    var w = el('div', 'puces');
    actives = (actives || []).slice();
    Etiquettes.liste().forEach(function (e) {
      w.appendChild(puce(e, actives.indexOf(e.id) >= 0, function () {
        var i = actives.indexOf(e.id);
        if (i >= 0) actives.splice(i, 1); else actives.push(e.id);
        this.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
        Ui.vibrer(8);
        onChange(actives.slice());
      }));
    });
    // Création rapide : le bouton se transforme en champ de saisie
    var nouveau = Ui.bouton([icone('plus', 'ic-sm'), 'Nouvelle'], 'puce puce-ajout', function () {
      var f = el('form', 'puce-saisie');
      var i = el('input', 'saisie'); i.type = 'text'; i.maxLength = 40; i.placeholder = 'Nom de l\'étiquette'; i.setAttribute('aria-label', 'Nom de la nouvelle étiquette');
      f.appendChild(i);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var e = Etiquettes.creer(i.value);
        if (e) { if (actives.indexOf(e.id) < 0) actives.push(e.id); onChange(actives.slice()); }
      });
      i.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); f.replaceWith(nouveau); } });
      i.addEventListener('blur', function () { if (!i.value.trim() && f.parentNode) f.replaceWith(nouveau); });
      nouveau.replaceWith(f); i.focus();
    }, { id: 'etiquette-nouvelle' });
    w.appendChild(nouveau);
    w.appendChild(Ui.bouton([icone('settings', 'ic-sm')], 'puce puce-ajout', gerer, { 'aria-label': 'Gérer les étiquettes', 'data-tip': 'Gérer les étiquettes', id: 'etiquettes-gerer' }));
    return w;
  }

  // ---------- Fenêtre de gestion ----------
  function gerer() {
    var dlg = document.getElementById('dlg-etiquettes');
    function dessiner() {
      dlg.innerHTML = '';
      var tete = el('div', 'modale-tete');
      var m = el('span', 'medaillon-modale'); m.appendChild(icone('tags')); tete.appendChild(m);
      var h = el('h2', null, 'Étiquettes'); h.id = 'dlg-etiquettes-titre'; tete.appendChild(h);
      tete.appendChild(Ui.bouton(icone('x'), 'btn btn-fantome btn-icone', function () { dlg.close(); }, { 'aria-label': 'Fermer' }));
      dlg.appendChild(tete);
      var corps = el('div', 'modale-corps');
      corps.appendChild(el('p', 'sous-titre', 'Vos repères rapides sur les maisons. Renommer une étiquette la met à jour partout.'));
      var compte = Etiquettes.compter();
      var ul = el('ul', 'liste-etiquettes');
      Etiquettes.liste().forEach(function (e) {
        var li = el('li'); li.dataset.etiquette = e.id;
        var couleurs = el('div', 'nuancier');
        Etiquettes.COULEURS.forEach(function (c) {
          var b = Ui.bouton([], 'teinte', function () { Etiquettes.modifier(e.id, { couleur: c }); dessiner(); }, { 'aria-label': 'Couleur ' + c, 'aria-pressed': e.couleur === c ? 'true' : 'false' });
          b.style.background = c; couleurs.appendChild(b);
        });
        var i = el('input', 'saisie'); i.type = 'text'; i.value = e.nom; i.maxLength = 40; i.setAttribute('aria-label', 'Nom de l\'étiquette');
        i.addEventListener('change', function () { Etiquettes.modifier(e.id, { nom: i.value }); });
        var ligne = el('div', 'ligne-etiquette');
        var p = el('span', 'pastille'); p.style.setProperty('--c', e.couleur); ligne.appendChild(p);
        ligne.appendChild(i);
        ligne.appendChild(el('span', 'sous-titre', (compte[e.id] || 0) + ' maison' + ((compte[e.id] || 0) > 1 ? 's' : '')));
        ligne.appendChild(Ui.bouton(icone('trash-2', 'ic-sm'), 'btn btn-fantome btn-icone btn-sm', function () {
          Ui.confirmer({ titre: 'Supprimer « ' + e.nom + ' » ?', message: 'L\'étiquette sera retirée de ' + (compte[e.id] || 0) + ' maison(s).', bouton: 'Supprimer', danger: true })
            .then(function (ok) { if (ok) Etiquettes.supprimer(e.id); if (!dlg.open) dlg.showModal(); dessiner(); });
        }, { 'aria-label': 'Supprimer ' + e.nom, 'data-action': 'supprimer' }));
        li.appendChild(ligne); li.appendChild(couleurs);
        ul.appendChild(li);
      });
      corps.appendChild(ul);
      var f = el('form', 'ajout-etiquette');
      var ni = el('input', 'saisie'); ni.type = 'text'; ni.maxLength = 40; ni.placeholder = 'Nouvelle étiquette (ex. Jardin à l\'abandon)'; ni.id = 'etiquette-nom'; ni.setAttribute('aria-label', 'Nom de la nouvelle étiquette');
      f.appendChild(ni);
      var ba = Ui.bouton([icone('plus', 'ic-sm'), 'Ajouter'], 'btn btn-primaire'); ba.type = 'submit'; f.appendChild(ba);
      f.addEventListener('submit', function (ev) { ev.preventDefault(); if (Etiquettes.creer(ni.value)) { dessiner(); var x = document.getElementById('etiquette-nom'); if (x) x.focus(); } });
      corps.appendChild(f);
      dlg.appendChild(corps);
    }
    dessiner();
    if (!dlg.open) dlg.showModal();
  }

  return { bloc: bloc, puce: puce, gerer: gerer };
})();
