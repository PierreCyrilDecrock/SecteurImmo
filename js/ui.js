/* ui.js – petits composants d'interface partagés. Expose l'objet global Ui. */
var Ui = (function () {
  'use strict';

  // Bouton de choix d'un statut (pastille de couleur + icône + libellé)
  function boutonStatut(st, actif, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-statut';
    b.dataset.statut = st.id;
    b.setAttribute('aria-pressed', actif ? 'true' : 'false');
    var pastille = document.createElement('span');
    pastille.className = 'pastille';
    pastille.style.background = st.couleur;
    pastille.style.borderColor = st.contour;
    b.appendChild(pastille);
    b.appendChild(document.createTextNode((st.icone ? st.icone + ' ' : '') + st.label));
    b.addEventListener('click', onClick);
    return b;
  }

  // Un seul volet à la fois dans la zone de droite (menu données, secteurs, fiche)
  function fermerVolets() {
    ['donnees', 'secteurs'].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.hidden = true;
    });
    ['btn-donnees', 'btn-secteurs'].forEach(function (id) {
      var e = document.getElementById(id); if (e) e.setAttribute('aria-pressed', 'false');
    });
  }

  return { boutonStatut: boutonStatut, fermerVolets: fermerVolets };
})();
