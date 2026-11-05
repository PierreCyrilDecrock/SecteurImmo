/*
 * echange.js – Export / import des données, export CSV, fichier de sauvegarde lié,
 * rappel de sauvegarde, et menu « Mes données ».
 * Expose l'objet global Echange.
 */
var Echange = (function () {
  'use strict';

  var RAPPEL_JOURS = 7;
  var TAILLE_MAX_IMPORT = 30 * 1024 * 1024;
  var handleLie = null, etatLie = '', timerFichier = null;
  var el = {}, alerter = function () {};

  // ---------- Construction / validation ----------

  function construireExport() {
    var recs = Statuts._records(), man = Statuts.manuels(), adr = Statuts.adressesToutes();
    var batiments = [], adresses = {};
    Object.keys(recs).forEach(function (id) {
      var f = DataImmo.batiment(id);
      if (f) batiments.push(f);
      if (adr[id]) adresses[id] = adr[id];
    });
    Object.keys(man).forEach(function (id) { if (adr[id]) adresses[id] = adr[id]; });
    return {
      app: 'SecteurImmo', schema: Store.SCHEMA, exporteLe: new Date().toISOString(),
      records: recs, manuels: man, adresses: adresses, batiments: batiments,
      secteurs: Secteurs.exporter()
    };
  }

  // Ne garde que des données bien formées (un fichier importé n'est jamais pris tel quel)
  function nettoyerImport(d) {
    var propre = { records: {}, manuels: {}, adresses: {}, batiments: [], secteurs: { secteurs: [], options: {} }, ignores: 0 };
    var valides = {}; Statuts.LISTE.forEach(function (s) { valides[s.id] = true; });
    Object.keys(d.records || {}).forEach(function (id) {
      var r = d.records[id];
      if (typeof id !== 'string' || !r || typeof r !== 'object' || !valides[r.statut || 'aucun']) { propre.ignores++; return; }
      var o = { statut: r.statut || 'aucun' };
      if (typeof r.date === 'string' && r.date.length <= 32) o.date = r.date;
      if (typeof r.note === 'string' && r.note) o.note = r.note.slice(0, 2000);
      if (Number.isInteger(r.logements) && r.logements > 0 && r.logements < 10000) o.logements = r.logements;
      if (typeof r.nom === 'string' && r.nom.trim()) o.nom = r.nom.trim().slice(0, 120);
      if (typeof r.tel === 'string' && /^[0-9+().\s-]{3,40}$/.test(r.tel.trim())) o.tel = r.tel.trim();
      if (Array.isArray(r.historique)) {
        var h = r.historique.filter(function (x) { return x && valides[x.statut] && typeof x.date === 'string' && x.date.length <= 32; })
          .slice(-30).map(function (x) { return { statut: x.statut, date: x.date }; });
        if (h.length) o.historique = h;
      }
      propre.records[id] = o;
    });
    Object.keys(d.manuels || {}).forEach(function (id) {
      var m = d.manuels[id];
      if (m && isFinite(m.lat) && isFinite(m.lon) && Math.abs(m.lat) <= 90 && Math.abs(m.lon) <= 180) propre.manuels[id] = { lat: +m.lat, lon: +m.lon };
      else propre.ignores++;
    });
    Object.keys(d.adresses || {}).forEach(function (id) { if (typeof d.adresses[id] === 'string') propre.adresses[id] = d.adresses[id].slice(0, 300); });
    (d.batiments || []).forEach(function (f) {
      if (f && typeof f.id === 'string' && f.geometry && /^(Multi)?Polygon$/.test(f.geometry.type) && Array.isArray(f.geometry.coordinates)) {
        propre.batiments.push({ type: 'Feature', id: f.id, properties: f.properties && typeof f.properties === 'object' ? f.properties : {}, geometry: f.geometry });
      } else propre.ignores++;
    });
    var sec = Secteurs.nettoyer(d.secteurs);
    propre.secteurs = sec.donnees; propre.ignores += sec.ignores;
    return propre;
  }

  // ---------- Téléchargements ----------

  function dateFichier() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

  function telecharger(nom, contenu, type) {
    var blob = new Blob([contenu], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function exporterJson() {
    telecharger('secteurimmo-' + dateFichier() + '.json', JSON.stringify(construireExport(), null, 1), 'application/json');
    marquerExport();
  }

  // CSV pour Excel français : séparateur « ; », UTF-8 avec BOM, protection contre l'injection de formules
  function celluleCsv(v, nombre) {
    v = (v === undefined || v === null) ? '' : String(v);
    if (!nombre && /^[=+\-@\t\r]/.test(v)) v = "'" + v; // les nombres (longitude négative) restent intacts
    return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  // ids : sélection facultative (sinon tous les bâtiments ayant un statut)
  function construireCsv(ids) {
    var recs = Statuts._records(), adr = Statuts.adressesToutes();
    var lignes = [['id', 'adresse', 'nom', 'telephone', 'statut', 'date', 'note', 'logements', 'latitude', 'longitude']];
    (ids || Object.keys(recs)).slice().sort().forEach(function (id) {
      if (!recs[id]) return;
      var r = recs[id], c = CarteImmo.centre(id), f = DataImmo.batiment(id);
      var a = (f && DataImmo.adresse(f.properties)) || adr[id] || '';
      lignes.push([id, a, r.nom || '', r.tel || '', Statuts.parId(r.statut).label, (r.date || '').replace('T', ' '), r.note || '', r.logements || '',
        c ? c[0].toFixed(6) : '', c ? c[1].toFixed(6) : '']);
    });
    return '﻿' + lignes.map(function (l) { return l.map(function (v, i) { return celluleCsv(v, i >= 7 && i <= 9); }).join(';'); }).join('\r\n') + '\r\n';
  }

  function exporterCsv(ids) {
    telecharger('secteurimmo-' + dateFichier() + '.csv', construireCsv(ids), 'text/csv;charset=utf-8');
  }

  function marquerExport() {
    Notif.afficher('Export téléchargé.', { type: 'succes', cle: 'export' });
    Store.setMeta('dernierExport', Date.now());
    Store.setMeta('rappelReporte', 0);
    majEtat(); majRappel();
  }

  // ---------- Import ----------

  function lireFichier(fichier) {
    if (fichier.size > TAILLE_MAX_IMPORT) { alerter('Fichier trop volumineux.'); return; }
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var d;
      try { d = JSON.parse(lecteur.result); } catch (e) { alerter('Ce fichier n\'est pas un JSON valide.'); return; }
      if (!d || d.app !== 'SecteurImmo' || typeof d.schema !== 'number') { alerter('Ce fichier n\'est pas une sauvegarde SecteurImmo.'); return; }
      if (d.schema > Store.SCHEMA) { alerter('Ce fichier a été créé par une version plus récente de l\'application.'); return; }
      proposerImport(d, nettoyerImport(d));
    };
    lecteur.onerror = function () { alerter('Lecture du fichier impossible.'); };
    lecteur.readAsText(fichier);
  }

  function proposerImport(brut, propre) {
    var dlg = el.dialogue, E = Ui.el;
    dlg.innerHTML = '';
    var nbRecs = Object.keys(propre.records).length, nbMan = Object.keys(propre.manuels).length;
    var conflits = Object.keys(propre.records).filter(function (id) { return Statuts.get(id); }).length;

    var tete = E('div', 'modale-tete');
    var med = E('span', 'medaillon-modale'); med.appendChild(Ui.icone('upload')); tete.appendChild(med);
    var tt = E('div'); var h = E('h2', null, 'Importer une sauvegarde'); h.id = 'dlg-import-titre'; tt.appendChild(h);
    tt.appendChild(E('p', 'sous-titre', 'Fichier du ' + (brut.exporteLe ? new Date(brut.exporteLe).toLocaleString('fr-FR') : 'date inconnue')));
    tete.appendChild(tt); dlg.appendChild(tete);

    var corps = E('div', 'modale-corps');
    var chiffres = E('div', 'chiffres-donnees');
    [[nbRecs, 'maisons renseignées'], [nbMan, 'maisons ajoutées'], [propre.secteurs.secteurs.length, 'secteurs']].forEach(function (c) {
      var d = E('div'); d.appendChild(E('strong', null, String(c[0]))); d.appendChild(E('span', null, c[1])); chiffres.appendChild(d);
    });
    corps.appendChild(chiffres);
    var p = E('p', null, (conflits ? conflits + ' maison(s) existent déjà ici. ' : '') + (propre.ignores ? propre.ignores + ' élément(s) invalide(s) seront ignorés. ' : '') +
      'Fusionner ajoute les données (en cas de doublon, la version la plus récente est gardée). Remplacer efface vos données actuelles.');
    p.style.marginTop = '12px'; p.style.fontSize = '13.5px';
    corps.appendChild(p);
    var lab = E('label', 'interrupteur'); lab.style.marginTop = '12px';
    var cb = E('input'); cb.type = 'checkbox'; cb.checked = true; cb.id = 'import-sauvegarde';
    lab.appendChild(cb); lab.appendChild(E('span', 'piste')); lab.appendChild(document.createTextNode('Si je remplace, télécharger d\'abord une copie de mes données'));
    corps.appendChild(lab);
    dlg.appendChild(corps);

    var pied = E('div', 'modale-pied');
    pied.appendChild(Ui.bouton('Annuler', 'btn btn-fantome', function () { dlg.close(); }, { id: 'import-annuler' }));
    pied.appendChild(Ui.bouton('Remplacer', 'btn btn-danger', function () {
      if (cb.checked && (Object.keys(Statuts._records()).length || Object.keys(Statuts.manuels()).length)) exporterJson();
      dlg.close(); appliquerImport(propre, 'remplacer');
    }, { id: 'import-remplacer' }));
    pied.appendChild(Ui.bouton('Fusionner', 'btn btn-primaire', function () { dlg.close(); appliquerImport(propre, 'fusionner'); }, { id: 'import-fusionner' }));
    dlg.appendChild(pied);
    dlg.showModal();
  }

  function appliquerImport(propre, mode) {
    Panneau.fermer();
    DataImmo.ajouter(propre.batiments);
    Store.enregistrerBatiments(propre.batiments);
    var bilan = Statuts.charger(propre, mode, mode === 'remplacer');
    Secteurs.charger(propre.secteurs, mode);
    CarteImmo.afficherBatiments(propre.batiments);
    CarteImmo.synchroniserManuels(Statuts.manuels());
    Object.keys(Statuts._records()).forEach(CarteImmo.rafraichir);
    Outils.majLegende();
    var fin = mode === 'remplacer' ? Store.toutReecrire(Object.keys(DataImmo._batiments()).map(function (id) { return DataImmo.batiment(id); })) : Store.flush();
    fin.then(function () {
      alerter(mode === 'remplacer' ? 'Données remplacées.' :
        'Fusion terminée : ' + bilan.ajoutes + ' ajouté(s), ' + bilan.remplaces + ' mis à jour, ' + bilan.conflitsGardes + ' conservé(s) (plus récents ici).');
      majEtat(); majRappel(); planifierFichier();
    });
  }

  // ---------- Fichier de sauvegarde lié (Chrome / Edge) ----------

  function persistFichier() { Store.kvSetIsole('fichierLie', handleLie); }

  function lierFichier() {
    window.showSaveFilePicker({
      suggestedName: 'secteurimmo-sauvegarde.json',
      types: [{ description: 'Sauvegarde SecteurImmo', accept: { 'application/json': ['.json'] } }]
    }).then(function (h) { handleLie = h; persistFichier(); return ecrireFichier(true); })
      .catch(function (e) { if (e && e.name !== 'AbortError') alerter('Impossible de lier le fichier.'); });
  }

  function ecrireFichier(demanderPermission) {
    if (!handleLie) return Promise.resolve();
    var verif = handleLie.queryPermission ? handleLie.queryPermission({ mode: 'readwrite' }) : Promise.resolve('granted');
    return verif.then(function (perm) {
      if (perm !== 'granted' && demanderPermission) return handleLie.requestPermission({ mode: 'readwrite' });
      return perm;
    }).then(function (perm) {
      if (perm !== 'granted') { etatLie = 'à reconnecter'; majEtat(); return; }
      return handleLie.createWritable().then(function (w) {
        return w.write(JSON.stringify(construireExport(), null, 1)).then(function () { return w.close(); });
      }).then(function () {
        etatLie = 'écrit à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        Store.setMeta('dernierExport', Date.now()); majEtat(); majRappel();
      });
    }).catch(function () { etatLie = 'erreur d\'écriture'; majEtat(); });
  }

  function planifierFichier() {
    if (!handleLie) return;
    clearTimeout(timerFichier);
    timerFichier = setTimeout(function () { ecrireFichier(false); }, 3000);
  }

  // ---------- Affichage : panneau « Données » et rappel de sauvegarde ----------

  function quand(t) {
    if (!t) return 'jamais';
    var j = Math.floor((Date.now() - t) / 86400000);
    return j <= 0 ? 'aujourd\'hui à ' + new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : j === 1 ? 'hier' : 'il y a ' + j + ' jours';
  }

  function majEtat() {
    var nb = Object.keys(Statuts._records()).length, nbMan = Object.keys(Statuts.manuels()).length;
    var dernier = Store.getMeta('dernierExport');
    var ok = Store.disponible();
    document.getElementById('etat-sauvegarde').classList.toggle('ko', !ok);
    document.getElementById('etat-sauvegarde-titre').textContent = ok ? 'Sauvegarde automatique active' : 'Sauvegarde automatique indisponible';
    el.etat.textContent = (ok ? 'Chaque modification est enregistrée dans ce navigateur. ' : 'Navigation privée ? Exportez régulièrement pour ne rien perdre. ') +
      'Dernier export : ' + quand(dernier) + '.';
    var ch = document.getElementById('chiffres-donnees'); ch.innerHTML = '';
    [[nb, 'maisons renseignées'], [nbMan, 'ajoutées à la main'], [Secteurs.liste().length, 'secteurs']].forEach(function (c) {
      var d = Ui.el('div'); d.appendChild(Ui.el('strong', null, Ui.nombre(c[0]))); d.appendChild(Ui.el('span', null, c[1])); ch.appendChild(d);
    });
    if (handleLie) {
      document.getElementById('btn-lier-titre').textContent = etatLie === 'à reconnecter' ? 'Reconnecter le fichier lié' : 'Fichier lié : ' + (handleLie.name || '');
      el.lieEtat.textContent = etatLie === 'à reconnecter' ? 'Autorisation à redonner après le redémarrage du navigateur' : 'Dernière écriture : ' + (etatLie || 'en attente');
    }
  }

  var rappelSignale = false;
  function majRappel() {
    var aDesDonnees = Object.keys(Statuts._records()).length || Object.keys(Statuts.manuels()).length;
    var ref = Store.getMeta('dernierExport') || Store.getMeta('depuis');
    var maintenant = Date.now();
    var report = Store.getMeta('rappelReporte') || 0;
    var visible = !!(aDesDonnees && ref && (maintenant - ref) > RAPPEL_JOURS * 86400000 && maintenant > report);
    el.rappel.hidden = !visible;
    Coquille.point('donnees', visible);
    if (visible && !rappelSignale) {
      rappelSignale = true;
      Notif.afficher('Aucune sauvegarde depuis plus de ' + RAPPEL_JOURS + ' jours.', { type: 'alerte', duree: 9000, action: { texte: 'Exporter', fn: exporterJson } });
    }
  }

  function init(options) {
    alerter = options.alerter;
    el.etat = document.getElementById('donnees-etat');
    el.lieEtat = document.getElementById('lie-etat');
    el.btnLier = document.getElementById('btn-lier');
    el.dialogue = document.getElementById('dlg-import');
    el.rappel = document.getElementById('rappel');
    var fichier = document.getElementById('fichier-import');
    var depot = document.getElementById('btn-import');

    handleLie = options.fichierLie || null;
    if (handleLie) etatLie = 'à vérifier';

    Coquille.enregistrer('donnees', { ouvrir: function () { majEtat(); majRappel(); } });
    document.getElementById('btn-export-json').addEventListener('click', exporterJson);
    document.getElementById('btn-export-csv').addEventListener('click', function () { exporterCsv(); });
    depot.addEventListener('click', function () { fichier.click(); });
    ['dragenter', 'dragover'].forEach(function (t) { depot.addEventListener(t, function (e) { e.preventDefault(); depot.classList.add('survol'); }); });
    ['dragleave', 'drop'].forEach(function (t) { depot.addEventListener(t, function () { depot.classList.remove('survol'); }); });
    depot.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f) lireFichier(f); });
    fichier.addEventListener('change', function () { if (fichier.files[0]) lireFichier(fichier.files[0]); fichier.value = ''; });
    document.getElementById('btn-effacer').addEventListener('click', function () {
      Ui.confirmer({ titre: 'Effacer toutes vos données ?', message: 'Statuts, contacts, notes, secteurs et maisons chargées seront supprimés de ce navigateur. Exportez-les d\'abord si vous voulez les conserver.', bouton: 'Tout effacer', danger: true })
        .then(function (ok) { if (ok) Store.toutEffacer().then(function () { location.reload(); }); });
    });
    if (window.showSaveFilePicker) {
      document.getElementById('bloc-lier').hidden = false;
      el.btnLier.addEventListener('click', function () { if (handleLie && etatLie === 'à reconnecter') ecrireFichier(true); else lierFichier(); });
    }

    document.getElementById('rappel-export').addEventListener('click', exporterJson);
    document.getElementById('rappel-plus-tard').addEventListener('click', function () {
      Store.setMeta('rappelReporte', Date.now() + 86400000); majRappel();
    });

    Statuts.surDonnees(function () { planifierFichier(); });
    Store.surEtat(function () { majRappel(); });
    majEtat(); majRappel();
    if (handleLie) ecrireFichier(false); // vérifie l'autorisation sans demander (pas de geste utilisateur)
  }

  return { init: init, construireExport: construireExport, construireCsv: construireCsv, exporterCsv: exporterCsv, exporterJson: exporterJson, majEtat: majEtat };
})();
