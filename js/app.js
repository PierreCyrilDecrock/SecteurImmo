/*
 * app.js – Initialisation et interface (recherche, messages).
 */
(function () {
  'use strict';

  var input = document.getElementById('recherche-input');
  var form = document.getElementById('recherche-form');
  var liste = document.getElementById('suggestions');
  var toast = document.getElementById('toast');
  var timerToast, timerSaisie, numRequete = 0, resultats = [], actif = -1;

  function alerter(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { toast.hidden = true; }, 6000);
  }

  CarteImmo.init(alerter);

  // ---- Suggestions ----
  function fermer() { liste.hidden = true; liste.innerHTML = ''; resultats = []; actif = -1; }

  function afficher(rs, vide) {
    resultats = rs; actif = -1; liste.innerHTML = '';
    if (!rs.length && vide) {
      var li = document.createElement('li');
      li.className = 'vide'; li.textContent = 'Aucun résultat';
      liste.appendChild(li);
    }
    rs.forEach(function (r, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = r.label;
      if (r.detail) { var s = document.createElement('small'); s.textContent = r.detail; li.appendChild(s); }
      li.addEventListener('click', function () { choisir(i); });
      liste.appendChild(li);
    });
    liste.hidden = !rs.length && !vide;
  }

  function choisir(i) {
    var r = resultats[i];
    if (!r) return;
    input.value = r.label;
    CarteImmo.aller(r);
    fermer();
    input.blur();
  }

  function marquer(i) {
    var items = liste.querySelectorAll('li[role="option"]');
    items.forEach(function (li, k) { li.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    actif = i;
  }

  // Lance une recherche ; ignore les réponses périmées si l'utilisateur a retapé entre-temps
  function lancer(texte, auto) {
    var mon = ++numRequete;
    Geocode.chercher(texte, 5).then(function (rs) {
      if (mon !== numRequete) return;
      if (!auto && rs.length) { resultats = rs; choisir(0); } else { afficher(rs, !auto); }
    }).catch(function () {
      if (mon !== numRequete) return;
      fermer();
      if (!auto) alerter('Recherche impossible : vérifiez votre connexion internet.');
    });
  }

  input.addEventListener('input', function () {
    clearTimeout(timerSaisie);
    var t = input.value.trim();
    if (t.length < 3) { numRequete++; fermer(); return; }
    timerSaisie = setTimeout(function () { lancer(t, true); }, 300);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { fermer(); return; }
    if (!resultats.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); marquer((actif + 1) % resultats.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marquer((actif - 1 + resultats.length) % resultats.length); }
    else if (e.key === 'Enter' && actif >= 0) { e.preventDefault(); choisir(actif); }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearTimeout(timerSaisie);
    var t = input.value.trim();
    if (t.length < 2) return;
    lancer(t, false);
  });

  document.addEventListener('click', function (e) {
    if (!document.getElementById('recherche').contains(e.target)) fermer();
  });
})();
