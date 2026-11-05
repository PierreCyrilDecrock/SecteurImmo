/*
 * palette.js – Palette de commandes (Ctrl+K ou barre de recherche) : adresses et villes (géocodage),
 * maisons déjà renseignées (nom, adresse, note), secteurs, et actions de l'application.
 * Expose l'objet global Palette.
 */
var Palette = (function () {
  'use strict';

  var dlg, saisie, zone, items = [], actif = 0, numRequete = 0, timer = null;
  var el = Ui.el, icone = Ui.icone;

  function actions() {
    return [
      { ic: 'map', t: 'Aller à la carte', mots: 'carte map', fn: function () { Coquille.naviguer('carte'); } },
      { ic: 'layout-dashboard', t: 'Ouvrir le bilan', s: 'Statistiques et objectifs', mots: 'bilan tableau de bord statistiques stats', fn: function () { Coquille.naviguer('tableau'); } },
      { ic: 'pentagon', t: 'Secteurs', mots: 'secteurs zones', fn: function () { Coquille.ouvrirTiroir('secteurs'); } },
      { ic: 'plus', t: 'Nouveau secteur', s: 'Dessiner une zone sur la carte', mots: 'nouveau secteur dessiner zone', fn: function () { Coquille.naviguer('carte'); Secteurs.demarrerDessin(); } },
      { ic: 'bell', t: 'Rappels', s: 'Personnes à recontacter', mots: 'rappels rappeler appeler', fn: function () { Coquille.ouvrirTiroir('rappels'); } },
      { ic: 'zap', t: 'Pointage rapide', s: 'T', mots: 'pointage tournée rapide mode terrain', fn: function () { Coquille.naviguer('carte'); Outils.setMode('tournee'); } },
      { ic: 'play', t: 'Démarrer une tournée', s: 'Chrono, portes, contacts, records', mots: 'tournée démarrer commencer chrono session', fn: function () { Coquille.naviguer('carte'); TourneesUi.demarrer(); } },
      { ic: 'trophy', t: 'Tournées, défis et records', mots: 'tournées défis records badges niveau progression', fn: function () { Coquille.naviguer('tournees'); } },
      { ic: 'table', t: 'Base des maisons', s: 'Tableau, filtres, colonnes', mots: 'base données tableau liste adresses maisons', fn: function () { Coquille.naviguer('base'); } },
      { ic: 'square-dashed', t: 'Sélection multiple', s: 'S', mots: 'sélection multiple lasso rectangle', fn: function () { Coquille.naviguer('carte'); Outils.setMode('selection'); } },
      { ic: 'map-pin-plus', t: 'Ajouter une maison', s: 'A', mots: 'ajouter maison point', fn: function () { Coquille.naviguer('carte'); Outils.setMode('ajouter'); } },
      { ic: 'download', t: 'Charger les maisons de cette zone', mots: 'charger maisons bâtiments overpass', fn: function () { Coquille.naviguer('carte'); CarteUi.charger(); } },
      { ic: 'locate', t: 'Ma position', mots: 'position gps localiser', fn: function () { document.getElementById('btn-position').click(); } },
      { ic: 'file-json', t: 'Exporter une sauvegarde (JSON)', mots: 'exporter sauvegarde json backup', fn: function () { Echange.exporterJson(); } },
      { ic: 'file-spreadsheet', t: 'Exporter en tableur (CSV)', mots: 'exporter csv excel tableur', fn: function () { Echange.exporterCsv(); } },
      { ic: 'upload', t: 'Importer une sauvegarde', mots: 'importer restaurer json', fn: function () { Coquille.ouvrirTiroir('donnees'); document.getElementById('fichier-import').click(); } },
      { ic: 'moon', t: 'Changer de thème', s: 'Auto, clair ou sombre', mots: 'thème sombre clair nuit dark', fn: function () { Theme.basculer(); } },
      { ic: 'tags', t: 'Gérer les étiquettes', mots: 'étiquettes tags gérer créer', fn: function () { EtiquettesUi.gerer(); } },
      { ic: 'circle-help', t: 'Aide et raccourcis', mots: 'aide raccourcis clavier help', fn: function () { Coquille.ouvrirTiroir('aide'); } }
    ];
  }

  function normaliser(t) { return (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function correspond(q, texte) { return normaliser(texte).indexOf(q) >= 0; }

  // Maisons renseignées correspondant à la recherche (nom, adresse, note)
  function maisons(q) {
    if (q.length < 2) return [];
    var recs = Statuts._records(), res = [];
    Object.keys(recs).some(function (id) {
      var r = recs[id], f = DataImmo.batiment(id);
      var adr = (f && DataImmo.adresse(f.properties)) || Statuts.adresseDe(id);
      var extra = [Statuts.libelleQualif('projet', r.projet), r.potentiel ? 'potentiel ' + Statuts.libelleQualif('potentiel', r.potentiel) : ''].concat((r.etiquettes || []).map(Etiquettes.nom)).join(' ');
      if (correspond(q, (r.nom || '') + ' ' + adr + ' ' + (r.note || '') + ' ' + extra)) {
        res.push({ ic: Statuts.parId(r.statut).icone, t: r.nom || adr || 'Maison', s: [r.nom ? adr : '', Statuts.parId(r.statut).label].filter(Boolean).join(' · '),
          fn: function () { Coquille.naviguer('carte'); var c = CarteImmo.centre(id); if (c) CarteImmo.getMap().setView(c, 19); if (CarteImmo.centre(id)) Panneau.ouvrir(id); } });
      }
      return res.length >= 5;
    });
    return res;
  }

  function secteurs(q) {
    return Secteurs.liste().filter(function (s) { return !q || correspond(q, s.nom); }).slice(0, 5).map(function (s) {
      var st = Secteurs.stats(s.id);
      return { ic: 'pentagon', t: s.nom, s: st.pct === null ? 'Secteur' : 'Secteur · ' + st.pct + ' % couvert', fn: function () { Coquille.naviguer('carte'); Secteurs.voir(s.id); } };
    });
  }

  function rendre(groupes) {
    zone.innerHTML = ''; items = [];
    groupes.forEach(function (g) {
      if (!g.items.length) return;
      zone.appendChild(el('div', 'palette-groupe', g.titre));
      g.items.forEach(function (it) {
        var b = el('button', 'palette-item'); b.type = 'button'; b.setAttribute('role', 'option'); b.id = 'pal-' + items.length;
        b.appendChild(icone(it.ic || 'arrow-right'));
        var tx = el('span', 'txt', it.t); if (it.s) tx.appendChild(el('small', null, it.s)); b.appendChild(tx);
        var i = items.length;
        b.addEventListener('click', function () { executer(i); });
        b.addEventListener('mousemove', function () { if (actif !== i) marquer(i); });
        zone.appendChild(b); items.push(it);
      });
    });
    if (!items.length) zone.appendChild(el('div', 'vide', saisie.value.trim().length >= 3 ? 'Aucun résultat' : 'Tapez une adresse, une ville, un nom…'));
    marquer(Math.min(actif, Math.max(0, items.length - 1)));
  }

  function marquer(i) {
    actif = i;
    zone.querySelectorAll('.palette-item').forEach(function (b, k) { b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    var b = document.getElementById('pal-' + i);
    if (b) { b.scrollIntoView({ block: 'nearest' }); saisie.setAttribute('aria-activedescendant', b.id); }
  }

  function executer(i) {
    var it = items[i];
    if (!it) return;
    dlg.close();
    setTimeout(function () { it.fn(); }, 0);
  }

  function rechercher() {
    var brut = saisie.value.trim(), q = normaliser(brut);
    var acts = actions().filter(function (a) { return !q || correspond(q, a.t + ' ' + (a.mots || '')); }).slice(0, q ? 6 : 8);
    var base = [{ titre: 'Maisons', items: maisons(q) }, { titre: 'Secteurs', items: secteurs(q) }, { titre: 'Actions', items: acts }];
    actif = 0;
    rendre(base);
    clearTimeout(timer);
    if (brut.length < 3) return;
    var mon = ++numRequete;
    timer = setTimeout(function () {
      zone.setAttribute('aria-busy', 'true');
      Geocode.chercher(brut, 5).then(function (rs) {
        if (mon !== numRequete || !dlg.open) return;
        var adr = rs.map(function (r) {
          return { ic: 'map-pin', t: r.label, s: r.detail, fn: function () { Coquille.naviguer('carte'); CarteImmo.aller(r); document.getElementById('accueil-carte').hidden = true; } };
        });
        rendre([{ titre: 'Adresses', items: adr }].concat(base));
      }).catch(function () {
        if (mon === numRequete && dlg.open) Notif.afficher('Recherche d\'adresse impossible : vérifiez votre connexion.', { type: 'erreur', cle: 'geocode' });
      }).finally(function () { zone.removeAttribute('aria-busy'); });
    }, 250);
  }

  function ouvrir() {
    if (dlg.open) return;
    saisie.value = '';
    dlg.showModal();
    saisie.focus();
    rechercher();
  }

  function init() {
    dlg = document.getElementById('palette'); saisie = document.getElementById('palette-saisie'); zone = document.getElementById('palette-resultats');
    saisie.addEventListener('input', rechercher);
    saisie.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); marquer(Math.min(items.length - 1, actif + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marquer(Math.max(0, actif - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); executer(actif); }
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    document.getElementById('btn-recherche').addEventListener('click', ouvrir);
    if (/Mac|iPhone|iPad/.test(navigator.platform || '')) document.getElementById('kbd-palette').textContent = '⌘ K';
  }

  return { init: init, ouvrir: ouvrir };
})();
