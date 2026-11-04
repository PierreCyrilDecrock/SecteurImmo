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

  function construireCsv() {
    var recs = Statuts._records(), adr = Statuts.adressesToutes();
    var lignes = [['id', 'adresse', 'statut', 'date', 'note', 'logements', 'latitude', 'longitude']];
    Object.keys(recs).sort().forEach(function (id) {
      var r = recs[id], c = CarteImmo.centre(id), f = DataImmo.batiment(id);
      var a = (f && DataImmo.adresse(f.properties)) || adr[id] || '';
      lignes.push([id, a, Statuts.parId(r.statut).label, (r.date || '').replace('T', ' '), r.note || '', r.logements || '',
        c ? c[0].toFixed(6) : '', c ? c[1].toFixed(6) : '']);
    });
    return '﻿' + lignes.map(function (l) { return l.map(function (v, i) { return celluleCsv(v, i >= 5 && i <= 7); }).join(';'); }).join('\r\n') + '\r\n';
  }

  function exporterCsv() {
    telecharger('secteurimmo-' + dateFichier() + '.csv', construireCsv(), 'text/csv;charset=utf-8');
  }

  function marquerExport() {
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
    var dlg = el.dialogue;
    dlg.innerHTML = '';
    var nbRecs = Object.keys(propre.records).length, nbMan = Object.keys(propre.manuels).length;
    var conflits = Object.keys(propre.records).filter(function (id) { return Statuts.get(id); }).length;

    var h = document.createElement('h2'); h.textContent = 'Importer une sauvegarde'; dlg.appendChild(h);
    var p = document.createElement('p');
    p.textContent = 'Fichier du ' + (brut.exporteLe ? new Date(brut.exporteLe).toLocaleString('fr-FR') : 'date inconnue') + ' : ' +
      nbRecs + ' bâtiment(s) avec statut, ' + nbMan + ' point(s) ajouté(s), ' + propre.batiments.length + ' contour(s), ' + propre.secteurs.secteurs.length + ' secteur(s).' +
      (conflits ? ' ' + conflits + ' bâtiment(s) existent déjà ici.' : '') +
      (propre.ignores ? ' ' + propre.ignores + ' élément(s) invalide(s) ignoré(s).' : '');
    dlg.appendChild(p);

    var aide = document.createElement('p'); aide.className = 'aide';
    aide.textContent = 'Fusionner : ajoute les données ; si un bâtiment existe déjà, l\'entrée la plus récente est conservée. ' +
      'Remplacer : efface vos données actuelles et les remplace par celles du fichier.';
    dlg.appendChild(aide);

    var lab = document.createElement('label'); lab.className = 'case';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.id = 'import-sauvegarde';
    lab.appendChild(cb); lab.appendChild(document.createTextNode(' Si je remplace, télécharger d\'abord une sauvegarde de mes données actuelles'));
    dlg.appendChild(lab);

    var barre = document.createElement('div'); barre.className = 'actions-dialogue';
    function bouton(id, texte, classe, fn) {
      var b = document.createElement('button'); b.type = 'button'; b.id = id; b.textContent = texte; if (classe) b.className = classe;
      b.addEventListener('click', fn); barre.appendChild(b);
    }
    bouton('import-annuler', 'Annuler', '', function () { dlg.close(); });
    bouton('import-remplacer', 'Remplacer', 'btn-danger', function () {
      if (cb.checked && (Object.keys(Statuts._records()).length || Object.keys(Statuts.manuels()).length)) exporterJson();
      dlg.close(); appliquerImport(propre, 'remplacer');
    });
    bouton('import-fusionner', 'Fusionner', 'primaire', function () { dlg.close(); appliquerImport(propre, 'fusionner'); });
    dlg.appendChild(barre);
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

  // ---------- Affichage : menu « Mes données » et rappel ----------

  function majEtat() {
    var nb = Object.keys(Statuts._records()).length, nbMan = Object.keys(Statuts.manuels()).length;
    var dernier = Store.getMeta('dernierExport');
    el.etat.textContent = (Store.disponible()
      ? 'Sauvegarde automatique active dans ce navigateur. '
      : '⚠ Sauvegarde automatique indisponible (navigation privée ?) : exportez régulièrement. ') +
      nb + ' bâtiment(s) avec statut, ' + nbMan + ' point(s) ajouté(s). Dernier export : ' +
      (dernier ? new Date(dernier).toLocaleString('fr-FR') : 'jamais') + '.';
    if (handleLie) {
      el.lieEtat.hidden = false;
      el.lieEtat.textContent = 'Fichier lié : ' + (handleLie.name || '') + ' (' + (etatLie || 'en attente') + ')';
      el.btnLier.textContent = etatLie === 'à reconnecter' ? 'Reconnecter le fichier lié' : 'Changer de fichier lié…';
    }
  }

  function majRappel() {
    var aDesDonnees = Object.keys(Statuts._records()).length || Object.keys(Statuts.manuels()).length;
    var ref = Store.getMeta('dernierExport') || Store.getMeta('depuis');
    var maintenant = Date.now();
    var report = Store.getMeta('rappelReporte') || 0;
    el.rappel.hidden = !(aDesDonnees && ref && (maintenant - ref) > RAPPEL_JOURS * 86400000 && maintenant > report);
  }

  function init(options) {
    alerter = options.alerter;
    el.menu = document.getElementById('donnees');
    el.btn = document.getElementById('btn-donnees');
    el.etat = document.getElementById('donnees-etat');
    el.lieEtat = document.getElementById('lie-etat');
    el.btnLier = document.getElementById('btn-lier');
    el.dialogue = document.getElementById('dlg-import');
    el.rappel = document.getElementById('rappel');
    var fichier = document.getElementById('fichier-import');

    handleLie = options.fichierLie || null;
    if (handleLie) etatLie = 'à vérifier';

    el.btn.addEventListener('click', function () {
      var ouvrir = el.menu.hidden;
      Ui.fermerVolets(); Panneau.fermer();
      if (ouvrir) { el.menu.hidden = false; el.btn.setAttribute('aria-pressed', 'true'); majEtat(); }
    });
    document.getElementById('btn-export-json').addEventListener('click', exporterJson);
    document.getElementById('btn-export-csv').addEventListener('click', exporterCsv);
    document.getElementById('btn-import').addEventListener('click', function () { fichier.click(); });
    fichier.addEventListener('change', function () { if (fichier.files[0]) lireFichier(fichier.files[0]); fichier.value = ''; });
    document.getElementById('btn-effacer').addEventListener('click', function () {
      if (!window.confirm('Effacer TOUTES vos données de prospection de ce navigateur ?\n(Exportez-les d\'abord si vous voulez les conserver.)')) return;
      Store.toutEffacer().then(function () { location.reload(); });
    });
    if (window.showSaveFilePicker) { el.btnLier.hidden = false; el.btnLier.addEventListener('click', function () { handleLie && etatLie === 'à reconnecter' ? ecrireFichier(true) : lierFichier(); }); }

    document.getElementById('rappel-export').addEventListener('click', exporterJson);
    document.getElementById('rappel-plus-tard').addEventListener('click', function () {
      Store.setMeta('rappelReporte', Date.now() + 86400000); majRappel();
    });

    Statuts.surDonnees(function () { planifierFichier(); });
    Store.surEtat(function () { majRappel(); });
    majEtat(); majRappel();
    if (handleLie) ecrireFichier(false); // vérifie l'autorisation sans demander (pas de geste utilisateur)
  }

  return { init: init, construireExport: construireExport, construireCsv: construireCsv };
})();
