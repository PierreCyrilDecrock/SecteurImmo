/*
 * rappels-ui.js – Panneau « Rappels » : les maisons « À rappeler », de la plus ancienne à la plus récente,
 * avec appel direct, accès à la fiche et « Contacté » en un geste. Met à jour le badge de navigation.
 * Expose l'objet global RappelsUi.
 */
var RappelsUi = (function () {
  'use strict';

  var liste, visible = false, animer = false, tri = 'date';
  var el = Ui.el, icone = Ui.icone;

  function nombreRappels() {
    var recs = Statuts._records(), n = 0;
    Object.keys(recs).forEach(function (id) { if (recs[id].statut === 'rappeler') n++; });
    return n;
  }

  function initiales(nom) {
    var mots = (nom || '').replace(/^(m\.|mme|mlle|m|mr|mrs)\s+/i, '').replace(/^(et\s+)?(mme|m\.)\s+/i, '').split(/\s+/).filter(Boolean);
    return mots.slice(0, 2).map(function (m) { return m[0].toUpperCase(); }).join('');
  }

  function depuis(date) {
    if (!date) return { texte: 'Date inconnue', jours: 0 };
    var j = Math.round((Stats.aujourdhui() - Stats.dateDepuisJour(date.slice(0, 10))) / 86400000);
    return { texte: j <= 0 ? 'Aujourd\'hui' : j === 1 ? 'Hier' : 'Il y a ' + j + ' jours', jours: j };
  }

  function carte(e, i) {
    var c = el('article', 'carte-rappel' + (animer ? ' entree' : ''));
    if (animer) c.style.animationDelay = Math.min(i, 8) * 40 + 'ms';
    c.dataset.id = e.id;
    var av = el('div', 'avatar'); var ini = initiales(e.nom);
    if (ini) av.textContent = ini; else av.appendChild(icone('phone-call', 'ic-sm'));
    c.appendChild(av);
    var tx = el('div', 'cr-texte');
    tx.appendChild(el('strong', null, e.nom || e.adresse || 'Maison sans adresse'));
    if (e.nom && e.adresse) tx.appendChild(el('span', 'adresse', e.adresse));
    // Qualification : potentiel, projet, échéance
    var q = el('div', 'cr-qualif');
    if (e.potentiel) {
      var P = { chaud: ['flame', '#dc2626'], tiede: ['thermometer', '#d97706'], froid: ['snowflake', '#2563eb'] }[e.potentiel];
      var pc = el('span', 'etiquette-statut'); pc.style.setProperty('--c', P[1]); pc.appendChild(icone(P[0])); pc.appendChild(document.createTextNode(Statuts.libelleQualif('potentiel', e.potentiel)));
      q.appendChild(pc);
    }
    var det = [Statuts.libelleQualif('projet', e.projet), Statuts.libelleQualif('echeance', e.echeance)].filter(Boolean).join(' · ');
    if (det) q.appendChild(el('span', 'sous-titre', det));
    if (q.children.length) tx.appendChild(q);
    if (e.note) tx.appendChild(el('p', 'note', e.note));
    var d = depuis(e.date);
    var meta = el('span', 'cr-meta' + (d.jours > 7 ? ' retard' : '')); meta.appendChild(icone('clock', 'ic-sm')); meta.appendChild(document.createTextNode(d.texte + (e.tel ? ' · ' + e.tel : '')));
    tx.appendChild(meta);
    c.appendChild(tx);

    var a = el('div', 'cr-actions');
    if (e.tel) {
      var ap = el('a', 'btn btn-sm btn-primaire'); ap.href = 'tel:' + e.tel.replace(/[^0-9+]/g, '');
      ap.appendChild(icone('phone', 'ic-sm')); ap.appendChild(document.createTextNode('Appeler'));
      a.appendChild(ap);
    }
    a.appendChild(Ui.bouton([icone('eye', 'ic-sm'), 'Fiche'], 'btn btn-sm', function () {
      if (e.lat === null) { Notif.alerter('Position inconnue pour cette maison.'); return; }
      Coquille.fermerTiroir(); Coquille.naviguer('carte');
      CarteImmo.getMap().setView([e.lat, e.lon], Math.max(CarteImmo.getMap().getZoom(), 18));
      Panneau.ouvrir(e.id);
    }, { 'data-action': 'voir' }));
    a.appendChild(Ui.bouton([icone('check', 'ic-sm'), 'Contacté'], 'btn btn-sm', function () {
      c.classList.add('part');
      setTimeout(function () {
        Statuts.modifier([e.id], { statut: 'contact' });
        Notif.afficher('Marqué « Contact personnel ».', { type: 'succes', action: { texte: 'Annuler', fn: function () { Outils.annuler(); } } });
      }, 200);
    }, { 'data-action': 'contacte' }));
    c.appendChild(a);
    return c;
  }

  function dessiner() {
    Coquille.badge('rappels', nombreRappels());
    if (!visible) return;
    var rang = { chaud: 0, tiede: 1, froid: 2 };
    var items = Stats.elementsReels().filter(function (e) { return e.statut === 'rappeler'; })
      .sort(function (x, y) {
        if (tri === 'potentiel') { var d = (x.potentiel ? rang[x.potentiel] : 3) - (y.potentiel ? rang[y.potentiel] : 3); if (d) return d; }
        return (x.date || '9') < (y.date || '9') ? -1 : 1;
      });
    liste.innerHTML = '';
    if (items.length > 1) {
      var seg = el('div', 'segments'); seg.style.marginBottom = '4px';
      [['date', 'Plus anciens'], ['potentiel', 'Potentiel']].forEach(function (x) {
        var b = Ui.bouton(x[1], '', function () { tri = x[0]; dessiner(); }, { 'aria-pressed': tri === x[0] ? 'true' : 'false' });
        b.dataset.tri = x[0]; seg.appendChild(b);
      });
      liste.appendChild(seg);
    }
    if (!items.length) {
      var v = el('div', 'vide');
      var m = el('div', 'medaillon'); m.appendChild(icone('party-popper', 'ic-lg')); v.appendChild(m);
      v.appendChild(el('strong', null, 'Aucun rappel en attente'));
      v.appendChild(el('span', null, 'Les maisons marquées « À rappeler » apparaîtront ici, avec le nom et le téléphone de la personne.'));
      liste.appendChild(v);
      return;
    }
    items.forEach(function (e, i) { liste.appendChild(carte(e, i)); });
  }

  function init() {
    liste = document.getElementById('rappels-liste');
    Coquille.enregistrer('rappels', { ouvrir: function () { visible = true; animer = true; dessiner(); animer = false; }, fermer: function () { visible = false; } });
    var t = null;
    Statuts.surChangement(function () { clearTimeout(t); t = setTimeout(dessiner, 80); });
    dessiner();
  }

  return { init: init, dessiner: dessiner, nombre: nombreRappels };
})();
