/*
 * outils.js – Barre d'outils et modes de travail :
 *   consulter  : un clic ouvre la fiche du bâtiment ;
 *   tournee    : un statut est actif, chaque clic sur un bâtiment le lui applique ;
 *   selection  : on entoure plusieurs bâtiments (rectangle ou lasso) puis on leur applique un statut ;
 *   ajouter    : un clic sur la carte crée un point (maison absente d'OpenStreetMap).
 * Contient aussi la légende filtrable et le bouton Annuler.
 * Expose l'objet global Outils.
 */
var Outils = (function () {
  'use strict';

  var map, mode = 'consulter', statutTournee = 'prospectus', forme = 'rectangle';
  var idsSelection = [];
  var barre, contexte, legende, btnAnnuler;
  var dessin = null; // état du tracé en cours { points, apercu, depart }

  // ---------- Modes ----------

  function setMode(m) {
    quitterSelection();
    if (mode === 'selection') desactiverTrace();
    if (mode === 'secteur' && m !== 'secteur') Secteurs.abandonnerDessin();
    mode = m;
    Panneau.fermer();
    var conteneur = map.getContainer();
    conteneur.classList.toggle('mode-tournee', m === 'tournee');
    conteneur.classList.toggle('mode-ajouter', m === 'ajouter');
    conteneur.classList.toggle('mode-secteur', m === 'secteur');
    conteneur.classList.toggle('mode-selection', m === 'selection');
    if (m === 'selection') activerTrace();
    barre.querySelectorAll('[data-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false');
    });
    dessinerContexte();
  }

  // Zone sous la barre d'outils : choix du statut (tournée) ou actions de sélection
  function dessinerContexte() {
    contexte.innerHTML = '';
    contexte.hidden = (mode === 'consulter');
    if (mode === 'consulter') return;

    function texte(t) { var p = document.createElement('p'); p.className = 'aide'; p.textContent = t; contexte.appendChild(p); }
    function boutons(actif, onChoix) {
      var g = document.createElement('div'); g.className = 'grille-statuts';
      Statuts.LISTE.forEach(function (st) {
        g.appendChild(Ui.boutonStatut(st, st.id === actif, function () { onChoix(st.id); }));
      });
      contexte.appendChild(g);
    }

    if (mode === 'tournee') {
      texte('Tournée rapide : chaque clic sur une maison lui applique ce statut.');
      boutons(statutTournee, function (id) { statutTournee = id; dessinerContexte(); });
    } else if (mode === 'secteur') {
      var n = Secteurs.nbPointsDessin();
      texte('Nouveau secteur : cliquez sur la carte pour poser les sommets (' + n + ' point' + (n > 1 ? 's' : '') + '), puis « Terminer ».');
      var g2 = document.createElement('div'); g2.className = 'grille-statuts';
      function act(id, t, fn, off) { var b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'btn-statut'; b.textContent = t; b.disabled = !!off; b.addEventListener('click', fn); g2.appendChild(b); }
      act('sect-terminer', '✔ Terminer', function () {
        var s = Secteurs.terminerDessin();
        if (s) SecteursUi.ouvrirPourRenommer(s.id);
      }, n < 3);
      act('sect-retirer', '↶ Retirer le dernier point', function () { Secteurs.retirerDernierPoint(); }, n < 1);
      act('sect-annuler', '✕ Annuler', function () { setMode('consulter'); });
      contexte.appendChild(g2);
    } else if (mode === 'ajouter') {
      texte('Cliquez sur la carte à l’emplacement de la maison à ajouter.');
    } else if (mode === 'selection') {
      var f = document.createElement('div'); f.className = 'forme';
      [['rectangle', '▭ Rectangle'], ['lasso', '✎ Lasso']].forEach(function (x) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn-forme';
        b.dataset.forme = x[0]; b.textContent = x[1]; b.setAttribute('aria-pressed', forme === x[0] ? 'true' : 'false');
        b.addEventListener('click', function () { forme = x[0]; dessinerContexte(); });
        f.appendChild(b);
      });
      contexte.appendChild(f);
      if (!idsSelection.length) {
        texte('Glissez sur la carte pour entourer des maisons. (Pour déplacer la carte : mode Consulter.)');
      } else {
        texte(idsSelection.length + ' bâtiment(s) sélectionné(s). Appliquer le statut :');
        boutons(null, function (id) {
          Statuts.modifier(idsSelection, { statut: id });
          quitterSelection();
          dessinerContexte();
        });
        var ann = document.createElement('button'); ann.type = 'button'; ann.className = 'btn-lien';
        ann.id = 'btn-desel'; ann.textContent = 'Désélectionner';
        ann.addEventListener('click', function () { quitterSelection(); dessinerContexte(); });
        contexte.appendChild(ann);
      }
    }
  }

  // ---------- Tracé de la sélection (souris ou doigt) ----------

  function activerTrace() {
    map.dragging.disable();
    map.getContainer().addEventListener('pointerdown', debutTrace);
  }
  function desactiverTrace() {
    map.getContainer().removeEventListener('pointerdown', debutTrace);
    map.dragging.enable();
  }

  function debutTrace(e) {
    if (!e.isPrimary || e.button > 0) return;
    if (e.target.closest('.leaflet-control, #recherche, #outils, #contexte, #legende, #panneau, #batiments')) return;
    e.preventDefault();
    quitterSelection();
    var c = map.getContainer();
    c.setPointerCapture(e.pointerId);
    var ll = map.mouseEventToLatLng(e);
    dessin = { depart: ll, points: [ll], apercu: null, pixelsDepart: [e.clientX, e.clientY], deplace: false };
    c.addEventListener('pointermove', traceEnCours);
    c.addEventListener('pointerup', finTrace);
    c.addEventListener('pointercancel', finTrace);
  }

  function traceEnCours(e) {
    if (!dessin) return;
    var ll = map.mouseEventToLatLng(e);
    if (Math.abs(e.clientX - dessin.pixelsDepart[0]) + Math.abs(e.clientY - dessin.pixelsDepart[1]) > 6) dessin.deplace = true;
    dessin.points.push(ll);
    if (dessin.apercu) map.removeLayer(dessin.apercu);
    var style = { color: '#ffd600', weight: 3, dashArray: '6 4', fillOpacity: 0.12, interactive: false };
    dessin.apercu = (forme === 'rectangle')
      ? L.rectangle(L.latLngBounds(dessin.depart, ll), style)
      : L.polygon(dessin.points, style);
    dessin.apercu.addTo(map);
  }

  function finTrace(e) {
    var c = map.getContainer();
    c.removeEventListener('pointermove', traceEnCours);
    c.removeEventListener('pointerup', finTrace);
    c.removeEventListener('pointercancel', finTrace);
    if (!dessin) return;
    var d = dessin; dessin = null;
    if (d.apercu) map.removeLayer(d.apercu);
    if (!d.deplace || e.type === 'pointercancel') return;
    var ids;
    if (forme === 'rectangle') {
      ids = CarteImmo.idsDans(L.latLngBounds(d.depart, d.points[d.points.length - 1]));
    } else if (d.points.length >= 3) {
      ids = CarteImmo.idsDans(d.points.map(function (p) { return [p.lat, p.lng]; }));
    } else ids = [];
    idsSelection = ids;
    CarteImmo.surligner(ids);
    dessinerContexte();
  }

  function quitterSelection() {
    if (dessin && dessin.apercu) map.removeLayer(dessin.apercu);
    dessin = null;
    if (idsSelection.length) CarteImmo.surligner([]);
    idsSelection = [];
  }

  // ---------- Clics sur la carte ----------

  function surClicBatiment(id, ll) {
    if (mode === 'secteur') { if (ll) Secteurs.ajouterPoint(ll); return; }
    if (mode === 'tournee') Statuts.modifier([id], { statut: statutTournee });
    else if (mode === 'consulter') Panneau.ouvrir(id);
  }

  function surClicCarte(e) {
    if (mode === 'secteur') { Secteurs.ajouterPoint(e.latlng); return; }
    if (mode !== 'ajouter') return;
    var id = Statuts.ajouterManuel(e.latlng.lat, e.latlng.lng);
    CarteImmo.afficherManuel(id, Statuts.manuels()[id]);
    majLegende();
    setMode('consulter');
    Panneau.ouvrir(id);
  }

  // ---------- Annuler ----------

  function majAnnuler() { btnAnnuler.disabled = !Statuts.peutAnnuler(); }
  function annuler() {
    if (Statuts.annuler()) majLegende();
    majAnnuler();
  }

  // ---------- Légende (filtre + compteurs) ----------

  function majLegende() {
    var total = CarteImmo.total();
    var c = Statuts.compter(total);
    legende.querySelectorAll('li').forEach(function (li) {
      li.querySelector('.compte').textContent = c[li.dataset.statut];
    });
  }

  function construireLegende() {
    var ul = document.createElement('ul');
    Statuts.LISTE.forEach(function (st) {
      var li = document.createElement('li'); li.dataset.statut = st.id;
      var l = document.createElement('label');
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      cb.setAttribute('aria-label', 'Afficher : ' + st.label);
      cb.addEventListener('change', function () { CarteImmo.filtrer(st.id, cb.checked); });
      var p = document.createElement('span'); p.className = 'pastille'; p.style.background = st.couleur; p.style.borderColor = st.contour;
      l.appendChild(cb); l.appendChild(p);
      l.appendChild(document.createTextNode((st.icone ? st.icone + ' ' : '') + st.label));
      var n = document.createElement('span'); n.className = 'compte'; n.textContent = '0';
      li.appendChild(l); li.appendChild(n); ul.appendChild(li);
    });
    legende.appendChild(ul);
  }

  // ---------- Initialisation ----------

  function init(carte) {
    map = carte;
    barre = document.getElementById('outils');
    contexte = document.getElementById('contexte');
    legende = document.getElementById('legende');
    btnAnnuler = document.getElementById('btn-annuler');
    construireLegende();

    barre.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode === mode && mode !== 'consulter' ? 'consulter' : b.dataset.mode); });
    });
    btnAnnuler.addEventListener('click', annuler);
    var btnLeg = document.getElementById('btn-legende');
    btnLeg.addEventListener('click', function () {
      legende.hidden = !legende.hidden;
      btnLeg.setAttribute('aria-pressed', legende.hidden ? 'false' : 'true');
    });

    CarteImmo.definirSurClic(surClicBatiment);
    map.on('click', surClicCarte);
    Statuts.surChangement(function () { majAnnuler(); majLegende(); });
    majAnnuler();

    // Raccourcis clavier : Ctrl/Cmd+Z annule, Échap revient au mode Consulter
    document.addEventListener('keydown', function (e) {
      var champ = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !champ) { e.preventDefault(); annuler(); }
      else if (e.key === 'Escape' && !champ) { if (mode !== 'consulter') setMode('consulter'); else Panneau.fermer(); }
    });
  }

  return { init: init, setMode: setMode, majLegende: majLegende, rafraichirContexte: dessinerContexte };
})();
