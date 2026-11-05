/*
 * outils.js – Dock d'outils et modes de travail :
 *   consulter  : toucher une maison ouvre sa fiche ;
 *   tournee    : un statut est actif, chaque maison touchée le reçoit (avec « Annuler » à chaque fois) ;
 *   selection  : on entoure plusieurs maisons (rectangle ou lasso) puis on leur applique un statut ;
 *   ajouter    : toucher la carte crée une maison absente d'OpenStreetMap ;
 *   secteur    : tracé d'un nouveau secteur (voir secteurs.js).
 * Gère aussi le bandeau contextuel au-dessus du dock, le bouton Annuler et les raccourcis clavier.
 * Expose l'objet global Outils.
 */
var Outils = (function () {
  'use strict';

  var map, mode = 'consulter', statutTournee = 'prospectus', forme = 'rectangle';
  var idsSelection = [], dessin = null, serieTournee = 0;
  var dock, contexte, btnAnnuler;
  var el = Ui.el, icone = Ui.icone;

  // ---------- Modes ----------
  function setMode(m) {
    quitterSelection();
    if (mode === 'selection') desactiverTrace();
    if (mode === 'secteur' && m !== 'secteur') Secteurs.abandonnerDessin();
    mode = m;
    if (m !== 'consulter') Panneau.fermer();
    if (m === 'tournee') serieTournee = 0;
    var c = map.getContainer();
    ['tournee', 'ajouter', 'secteur', 'selection'].forEach(function (x) { c.classList.toggle('mode-' + x, m === x); });
    if (m === 'selection') activerTrace();
    dock.querySelectorAll('[data-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false');
      var p = b.querySelector('.pastille-active'); if (p) p.remove();
      if (b.dataset.mode === 'tournee' && m === 'tournee') {
        var d = el('span', 'pastille-active'); d.style.setProperty('--c', 'var(--st-' + statutTournee + ')'); b.appendChild(d);
      }
    });
    dessinerContexte();
  }

  function teteContexte(ic, titre, aide, apres) {
    var t = el('div', 'contexte-tete');
    t.appendChild(icone(ic, 'ic-sm'));
    t.appendChild(el('span', 'titre', titre));
    t.appendChild(el('span', 'aide', aide || ''));
    if (apres) t.appendChild(apres);
    t.appendChild(Ui.bouton(icone('x', 'ic-sm'), 'btn btn-fantome btn-icone btn-sm', function () { setMode('consulter'); }, { 'aria-label': 'Quitter ce mode', id: 'contexte-fermer' }));
    return t;
  }

  // seulsPorte : en tournée, seuls les statuts « de porte » sont proposés (les numéros restent ceux de la fiche)
  var PORTE = ['prospectus', 'contact', 'absent', 'rappeler', 'refus', 'aucun'];
  function puces(actif, onChoix, seulsPorte) {
    var g = el('div', 'choix-statuts compacts');
    Statuts.ORDRE_CHOIX.forEach(function (sid, i) {
      if (seulsPorte && PORTE.indexOf(sid) < 0) return;
      var st = Statuts.parId(sid);
      var b = Ui.boutonStatut(st, sid === actif, function () { onChoix(sid); }, i + 1);
      b.querySelector('.libelle').textContent = st.court;
      b.title = st.label;
      g.appendChild(b);
    });
    return g;
  }

  // Bandeau au-dessus du dock : choix du statut (tournée), actions de sélection, tracé de secteur…
  function dessinerContexte() {
    contexte.innerHTML = '';
    contexte.hidden = mode === 'consulter';
    if (mode === 'consulter') return;

    if (mode === 'tournee') {
      contexte.appendChild(teteContexte('zap', 'Tournée rapide', 'Touchez chaque maison faite'));
      contexte.appendChild(puces(statutTournee, function (sid) { statutTournee = sid; setMode('tournee'); }, PORTE.indexOf(statutTournee) >= 0));
    } else if (mode === 'ajouter') {
      contexte.appendChild(teteContexte('map-pin-plus', 'Ajouter une maison', 'Touchez la carte à son emplacement'));
    } else if (mode === 'selection') {
      var seg = el('div', 'segments');
      [['rectangle', 'Rectangle'], ['lasso', 'Lasso']].forEach(function (x) {
        var b = Ui.bouton(x[1], '', function () { forme = x[0]; dessinerContexte(); }, { 'aria-pressed': forme === x[0] ? 'true' : 'false' });
        b.dataset.forme = x[0]; seg.appendChild(b);
      });
      var n = idsSelection.length;
      contexte.appendChild(teteContexte('square-dashed', n ? n + ' maison' + (n > 1 ? 's' : '') + ' sélectionnée' + (n > 1 ? 's' : '') : 'Sélection multiple',
        n ? 'Choisissez le statut à appliquer' : 'Glissez sur la carte pour entourer des maisons', seg));
      if (n) {
        contexte.appendChild(puces(null, function (sid) {
          var nb = Statuts.modifier(idsSelection, { statut: sid });
          Notif.afficher(nb + ' maison' + (nb > 1 ? 's' : '') + ' → ' + Statuts.parId(sid).label, { type: 'succes', action: { texte: 'Annuler', fn: annuler } });
          Ui.vibrer(20);
          quitterSelection(); dessinerContexte();
        }));
        var a = el('div', 'actions'); a.style.marginTop = '8px';
        // Ajouter une étiquette à toutes les maisons sélectionnées
        if (Etiquettes.liste().length) {
          var sel = el('select', 'saisie saisie-sm'); sel.id = 'selection-etiquette'; sel.setAttribute('aria-label', 'Ajouter une étiquette à la sélection');
          var o0 = el('option', null, 'Ajouter une étiquette…'); o0.value = ''; sel.appendChild(o0);
          Etiquettes.liste().forEach(function (e) { var o = el('option', null, e.nom); o.value = e.id; sel.appendChild(o); });
          sel.addEventListener('change', function () {
            var eid = sel.value; if (!eid) return;
            var ids = idsSelection.filter(function (id) { return ((Statuts.get(id) || {}).etiquettes || []).indexOf(eid) < 0; });
            var patchs = {};
            ids.forEach(function (id) { patchs[id] = { etiquettes: ((Statuts.get(id) || {}).etiquettes || []).concat([eid]) }; });
            Statuts.modifierChacun(patchs);
            Notif.afficher('« ' + Etiquettes.nom(eid) + ' » ajoutée à ' + ids.length + ' maison' + (ids.length > 1 ? 's' : ''), { type: 'succes' });
            quitterSelection(); dessinerContexte();
          });
          a.appendChild(sel);
        }
        a.appendChild(Ui.bouton('Désélectionner', 'btn btn-sm btn-fantome', function () { quitterSelection(); dessinerContexte(); }, { id: 'btn-desel' }));
        contexte.appendChild(a);
      }
    } else if (mode === 'secteur') {
      var np = Secteurs.nbPointsDessin();
      contexte.appendChild(teteContexte('pentagon', 'Nouveau secteur', np ? np + ' point' + (np > 1 ? 's' : '') + ' posé' + (np > 1 ? 's' : '') : 'Touchez la carte pour poser les coins'));
      var act = el('div', 'actions');
      var fin = Ui.bouton([icone('check', 'ic-sm'), 'Terminer'], 'btn btn-primaire btn-sm', function () {
        var s = Secteurs.terminerDessin();
        if (s) SecteursUi.ouvrirPourRenommer(s.id);
      }, { id: 'sect-terminer' });
      fin.disabled = np < 3;
      act.appendChild(fin);
      var ret = Ui.bouton([icone('undo-2', 'ic-sm'), 'Retirer le dernier point'], 'btn btn-sm', function () { Secteurs.retirerDernierPoint(); }, { id: 'sect-retirer' });
      ret.disabled = np < 1;
      act.appendChild(ret);
      act.appendChild(Ui.bouton('Annuler', 'btn btn-sm btn-fantome', function () { setMode('consulter'); }, { id: 'sect-annuler' }));
      contexte.appendChild(act);
    }
  }

  // ---------- Tracé de la sélection (souris ou doigt) ----------
  function activerTrace() { map.dragging.disable(); map.getContainer().addEventListener('pointerdown', debutTrace); }
  function desactiverTrace() { map.getContainer().removeEventListener('pointerdown', debutTrace); map.dragging.enable(); }

  function debutTrace(e) {
    if (!e.isPrimary || e.button > 0) return;
    if (e.target.closest('.leaflet-control')) return;
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
    var style = { color: '#f59e0b', weight: 2.5, dashArray: '6 5', fillColor: '#f59e0b', fillOpacity: 0.1, interactive: false };
    dessin.apercu = forme === 'rectangle' ? L.rectangle(L.latLngBounds(dessin.depart, ll), style) : L.polygon(dessin.points, style);
    dessin.apercu.addTo(map);
  }
  function finTrace(e) {
    var c = map.getContainer();
    c.removeEventListener('pointermove', traceEnCours); c.removeEventListener('pointerup', finTrace); c.removeEventListener('pointercancel', finTrace);
    if (!dessin) return;
    var d = dessin; dessin = null;
    if (d.apercu) map.removeLayer(d.apercu);
    if (!d.deplace || e.type === 'pointercancel') return;
    var ids;
    if (forme === 'rectangle') ids = CarteImmo.idsDans(L.latLngBounds(d.depart, d.points[d.points.length - 1]));
    else if (d.points.length >= 3) ids = CarteImmo.idsDans(d.points.map(function (p) { return [p.lat, p.lng]; }));
    else ids = [];
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

  // ---------- Clics ----------
  function surClicBatiment(id, ll) {
    if (mode === 'secteur') { if (ll) Secteurs.ajouterPoint(ll); return; }
    if (mode === 'tournee') {
      if (Statuts.statutDe(id) === statutTournee) { CarteImmo.onde(id); return; }
      Statuts.modifier([id], { statut: statutTournee });
      CarteImmo.onde(id, statutTournee); Ui.vibrer();
      serieTournee++;
      Notif.afficher(Statuts.parId(statutTournee).label + (serieTournee > 1 ? ' · ' + serieTournee + ' maisons' : ''), {
        type: 'succes', cle: 'tournee', duree: 4500, action: { texte: 'Annuler', fn: function () { serieTournee = Math.max(0, serieTournee - 1); annuler(); } }
      });
    } else if (mode === 'consulter') Panneau.ouvrir(id);
  }
  function surClicCarte(e) {
    if (mode === 'secteur') { Secteurs.ajouterPoint(e.latlng); return; }
    if (mode !== 'ajouter') { if (mode === 'consulter' && Panneau.ouvert()) Panneau.fermer(); return; }
    var id = Statuts.ajouterManuel(e.latlng.lat, e.latlng.lng);
    CarteImmo.afficherManuel(id, Statuts.manuels()[id]);
    CarteUi.majLegende();
    setMode('consulter');
    Panneau.ouvrir(id);
    Notif.afficher('Maison ajoutée sur la carte.', { type: 'succes' });
  }

  // ---------- Annuler ----------
  function majAnnuler() { btnAnnuler.disabled = !Statuts.peutAnnuler(); }
  function annuler() {
    if (Statuts.annuler()) { CarteUi.majLegende(); Notif.afficher('Dernière modification annulée.', { cle: 'annuler', duree: 2200 }); }
    majAnnuler();
  }

  // ---------- Raccourcis clavier ----------
  function raccourcis(e) {
    if (document.querySelector('dialog[open]')) return;
    var mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod && k.toLowerCase() === 'k') { e.preventDefault(); Palette.ouvrir(); return; }
    if (Ui.saisieActive()) return;
    if (mod && !e.shiftKey && k.toLowerCase() === 'z') { e.preventDefault(); annuler(); return; }
    if (k === 'Escape') { if (mode !== 'consulter') setMode('consulter'); else Coquille.echap(); return; }
    if (mod || e.altKey) return;
    if (k === '/') { e.preventDefault(); Palette.ouvrir(); return; }
    if (k === '?') { Coquille.ouvrirTiroir('aide'); return; }
    if (Coquille.vue() !== 'carte') return;
    var modes = { v: 'consulter', t: 'tournee', s: 'selection', a: 'ajouter' };
    if (modes[k.toLowerCase()]) { setMode(modes[k.toLowerCase()]); return; }
    if (/^[1-9]$/.test(k)) {
      var sid = Statuts.ORDRE_CHOIX[+k - 1];
      if (Panneau.ouvert()) Panneau.choisir(sid);
      else if (mode === 'tournee') { statutTournee = sid; setMode('tournee'); }
      else if (mode === 'selection' && idsSelection.length) { var b = contexte.querySelector('[data-statut="' + sid + '"]'); if (b) b.click(); }
    }
  }

  function init(carte) {
    map = carte;
    dock = document.getElementById('dock'); contexte = document.getElementById('contexte'); btnAnnuler = document.getElementById('btn-annuler');
    dock.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode === mode && mode !== 'consulter' ? 'consulter' : b.dataset.mode); });
    });
    btnAnnuler.addEventListener('click', annuler);
    CarteImmo.definirSurClic(surClicBatiment);
    map.on('click', surClicCarte);
    Statuts.surChangement(majAnnuler);
    majAnnuler();
    document.addEventListener('keydown', raccourcis);
  }

  return {
    init: init, setMode: setMode, mode: function () { return mode; },
    majLegende: function () { CarteUi.majLegende(); }, rafraichirContexte: dessinerContexte, annuler: annuler
  };
})();
