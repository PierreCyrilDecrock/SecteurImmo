/*
 * communes-ui.js – Panneau « Secteurs », partie « Communes » : recherche d'une commune (nom ou code
 * postal), téléchargement de la commune entière, liste des communes avec progression, bâtiments,
 * actions (voir, créer un secteur, mettre à jour, retirer).
 * Expose l'objet global CommunesUi.
 */
var CommunesUi = (function () {
  'use strict';

  var el = Ui.el, icone = Ui.icone;
  var zone, saisie, suggestions, liste, timer = null, numRequete = 0, visible = false;
  var comptes = {};   // code -> { cle, total, aProspecter } (recalculé quand les bâtiments changent)

  function formatDate(t) { var d = new Date(t); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); }

  // Lance le téléchargement d'une commune trouvée par la recherche
  function telecharger(c) {
    Notif.afficher('Téléchargement de ' + c.nom + ' : préparation…', { cle: 'commune' });
    return Communes.telecharger(c).then(function (r) {
      Coquille.naviguer('carte');
      Communes.voir(r.commune.code);
      r.tache.then(function (res) {
        var cpt = Communes.compter(r.commune.code);
        Notif.afficher(r.commune.nom + ' : ' + Ui.nombre(cpt.aProspecter) + ' bâtiments à prospecter (' + Ui.nombre(cpt.total) + ' au total), ' + Ui.nombre(res.adresses) + ' avec leur adresse.', { type: 'succes', cle: 'commune', duree: 8000 });
        if (res.avertissement) Notif.afficher(res.avertissement, { type: 'alerte', duree: 9000 });
      }).catch(function (e) { if (!/annulé/.test(e.message)) Notif.afficher(r.commune.nom + ' : ' + e.message, { type: 'erreur', cle: 'commune', duree: 9000 }); });
    }).catch(function (e) { Notif.afficher(e.message || 'Téléchargement impossible.', { type: 'erreur', cle: 'commune' }); });
  }

  // ---------- Recherche ----------
  function rechercher() {
    var q = saisie.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { suggestions.innerHTML = ''; suggestions.hidden = true; return; }
    var mon = ++numRequete;
    timer = setTimeout(function () {
      Communes.rechercher(q).then(function (rs) {
        if (mon !== numRequete) return;
        suggestions.innerHTML = '';
        if (!rs.length) suggestions.appendChild(el('p', 'sous-titre', 'Aucune commune trouvée.'));
        rs.forEach(function (c) {
          var b = Ui.bouton([icone('cloud-download', 'ic-sm'), el('span', 'txt', c.nom), el('small', null, [c.cp, c.population ? Ui.nombre(c.population) + ' hab.' : '', c.departement].filter(Boolean).join(' · '))],
            'suggestion-commune', function () { saisie.value = ''; suggestions.hidden = true; telecharger(c); }, { 'data-code': c.code });
          suggestions.appendChild(b);
        });
        suggestions.hidden = false;
      }).catch(function (e) {
        if (mon !== numRequete) return;
        suggestions.innerHTML = ''; suggestions.appendChild(el('p', 'sous-titre', e.message)); suggestions.hidden = false;
      });
    }, 300);
  }

  // ---------- Liste ----------
  function compte(c) {
    var cle = CarteImmo.ids(true).length + ':' + TypesBati.actifs().join(',');
    var x = comptes[c.code];
    if (!x || x.cle !== cle) { x = comptes[c.code] = Object.assign({ cle: cle }, Communes.compter(c.code)); }
    return x;
  }

  function carte(c) {
    var t = Telechargements.parRef('commune', c.code), enCours = t && t.etat !== 'fini';
    var art = el('article', 'carte-secteur carte-commune'); art.dataset.code = c.code;
    var tete = el('div', 'cs-tete');
    var med = el('span', 'medaillon-commune'); med.appendChild(icone('map-pinned')); tete.appendChild(med);
    var tx = el('div', 'cs-texte');
    tx.appendChild(Ui.bouton(c.nom + (c.cp ? ' (' + c.cp + ')' : ''), 'cs-nom', function () { Communes.voir(c.code); if (Coquille.telephone()) Coquille.fermerTiroir(); }, { title: 'Voir la commune sur la carte' }));
    var sous;
    if (enCours) {
      var p = Telechargements.progression(t);
      sous = t.etat === 'erreur' ? 'Téléchargement interrompu' : t.etat === 'pause' ? 'Téléchargement en pause (' + Math.round(p.pct * 100) + ' %)' : 'Téléchargement : ' + Math.round(p.pct * 100) + ' %';
    } else {
      var n = compte(c);
      sous = Ui.nombre(n.aProspecter) + ' à prospecter · ' + Ui.nombre(n.total) + ' bâtiments' + (c.maj ? ' · ' + formatDate(c.maj) : '');
    }
    tx.appendChild(el('div', 'sous-titre', sous));
    tete.appendChild(tx);
    tete.appendChild(Ui.bouton(icone('trash-2', 'ic-sm'), 'btn btn-sm btn-icone btn-fantome', function () { retirer(c); }, { 'aria-label': 'Retirer ' + c.nom, 'data-tip': 'Retirer', 'data-action': 'retirer' }));
    art.appendChild(tete);
    if (enCours) {
      var j = el('div', 'jauge'); var js = el('span'); js.style.width = Math.round(Telechargements.progression(t).pct * 100) + '%'; js.style.setProperty('--c', 'var(--primaire)'); j.appendChild(js);
      art.appendChild(j);
    }
    var a = el('div', 'cs-actions');
    a.appendChild(Ui.bouton([icone('pentagon', 'ic-sm'), 'Créer un secteur'], 'btn btn-sm', function () {
      var s = Communes.creerSecteur(c.code);
      if (s) Notif.afficher('Secteur « ' + s.nom + ' » créé : suivez la couverture de toute la commune.', { type: 'succes' });
    }, { 'data-action': 'secteur', 'data-tip': 'Un secteur qui suit le contour de la commune' }));
    if (!enCours) a.appendChild(Ui.bouton([icone('refresh-cw', 'ic-sm'), 'Mettre à jour'], 'btn btn-sm', function () { telecharger(c); }, { 'data-action': 'maj' }));
    art.appendChild(a);
    return art;
  }

  function retirer(c) {
    var opt = { texte: 'Retirer aussi de cet appareil ses bâtiments sans information (statut, note, contact…)', coche: true };
    Ui.confirmer({ titre: 'Retirer ' + c.nom + ' ?', message: 'La commune ne sera plus listée. Vos fiches (statuts, contacts, notes) sont toujours conservées.', bouton: 'Retirer', danger: true, case: opt })
      .then(function (ok) {
        if (!ok) return;
        var n = Communes.retirer(c.code, opt.valeur);
        Notif.afficher(c.nom + ' retirée' + (n ? ' (' + Ui.nombre(n) + ' bâtiments effacés de l\'appareil)' : '') + '.', { type: 'succes' });
      });
  }

  function dessiner() {
    if (!liste || (!visible && !liste.offsetParent)) return;   // panneau fermé : redessiné à l'ouverture
    liste.innerHTML = '';
    Communes.liste().forEach(function (c) { liste.appendChild(carte(c)); });
  }

  function init() {
    zone = document.getElementById('communes-zone');
    saisie = document.getElementById('commune-recherche');
    suggestions = document.getElementById('communes-suggestions');
    liste = document.getElementById('communes-liste');
    saisie.addEventListener('input', rechercher);
    saisie.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); var b = suggestions.querySelector('.suggestion-commune'); if (b) b.click(); }
      else if (e.key === 'Escape' && !suggestions.hidden) { e.stopPropagation(); suggestions.hidden = true; }
    });
    Communes.surChangement(dessiner);
    var t = null;
    Telechargements.surChangement(function () { clearTimeout(t); t = setTimeout(dessiner, 250); });
    CarteImmo.surElements(function () { clearTimeout(t); t = setTimeout(dessiner, 400); });
    Telechargements.surFin(function () { clearTimeout(t); t = setTimeout(dessiner, 100); });
  }

  return {
    init: init, telecharger: telecharger,
    ouvrir: function () { visible = true; dessiner(); }, fermer: function () { visible = false; }
  };
})();
