/*
 * etiquettes.js – Étiquettes rapides créées par l'utilisateur (ex. « Stop pub », « Chien », « Maison à vendre »).
 * Définitions : [{ id, nom, couleur }] ; une maison porte une liste d'ids dans sa fiche (champ `etiquettes`).
 * Expose l'objet global Etiquettes.
 */
var Etiquettes = (function () {
  'use strict';

  // Teintes proposées pour les étiquettes (simples repères visuels, le nom est toujours affiché)
  var COULEURS = ['#64748b', '#2563eb', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#c026d3', '#7c3aed'];
  // Étiquettes proposées au premier lancement (modifiables et supprimables)
  var DEFAUT = [
    { id: 'e-stop-pub', nom: 'Stop pub', couleur: '#dc2626' },
    { id: 'e-chien', nom: 'Chien', couleur: '#ea580c' },
    { id: 'e-a-vendre', nom: 'Maison à vendre', couleur: '#16a34a' },
    { id: 'e-travaux', nom: 'Travaux', couleur: '#ca8a04' },
    { id: 'e-volets', nom: 'Volets fermés', couleur: '#64748b' },
    { id: 'e-boite', nom: 'Boîte pleine', couleur: '#7c3aed' }
  ];
  var liste = JSON.parse(JSON.stringify(DEFAUT));
  var ecouteurs = [];

  function signaler() { ecouteurs.forEach(function (cb) { cb(); }); }
  function parId(id) { return liste.filter(function (e) { return e.id === id; })[0] || null; }
  // Nom d'une étiquette (y compris celles par défaut, utilisées par les données d'exemple)
  function nom(id) { var e = parId(id) || DEFAUT.filter(function (x) { return x.id === id; })[0]; return e ? e.nom : ''; }
  function couleur(id) { var e = parId(id) || DEFAUT.filter(function (x) { return x.id === id; })[0]; return e ? e.couleur : COULEURS[0]; }

  function creer(n, c) {
    n = (n || '').trim().slice(0, 40);
    if (!n) return null;
    var exist = liste.filter(function (e) { return e.nom.toLowerCase() === n.toLowerCase(); })[0];
    if (exist) return exist;
    var e = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nom: n, couleur: c || COULEURS[liste.length % COULEURS.length] };
    liste.push(e); signaler();
    return e;
  }
  function modifier(id, champs) {
    var e = parId(id); if (!e) return;
    if (champs.nom !== undefined && champs.nom.trim()) e.nom = champs.nom.trim().slice(0, 40);
    if (champs.couleur && COULEURS.indexOf(champs.couleur) >= 0) e.couleur = champs.couleur;
    signaler();
  }
  // Supprime la définition et retire l'étiquette de toutes les maisons
  function supprimer(id) {
    liste = liste.filter(function (e) { return e.id !== id; });
    var recs = Statuts._records(), ids = Object.keys(recs).filter(function (k) { return (recs[k].etiquettes || []).indexOf(id) >= 0; });
    var patchs = {};
    ids.forEach(function (k) { patchs[k] = { etiquettes: recs[k].etiquettes.filter(function (x) { return x !== id; }) }; });
    if (ids.length) Statuts.modifierChacun(patchs);
    signaler();
  }
  // Nombre de maisons portant chaque étiquette
  function compter() {
    var c = {}, recs = Statuts._records();
    Object.keys(recs).forEach(function (k) { (recs[k].etiquettes || []).forEach(function (e) { c[e] = (c[e] || 0) + 1; }); });
    return c;
  }

  function exporter() { return JSON.parse(JSON.stringify(liste)); }
  // Valide une liste venant d'un fichier
  function nettoyer(d) {
    if (!Array.isArray(d)) return [];
    return d.filter(function (e) { return e && typeof e.id === 'string' && typeof e.nom === 'string' && e.nom.trim(); }).slice(0, 100).map(function (e) {
      return { id: e.id.slice(0, 40), nom: e.nom.trim().slice(0, 40), couleur: COULEURS.indexOf(e.couleur) >= 0 ? e.couleur : COULEURS[0] };
    });
  }
  // mode 'remplacer' | 'fusionner' (ajoute les étiquettes inconnues)
  function charger(d, mode) {
    if (!Array.isArray(d)) return;
    if (mode === 'remplacer') liste = [];
    d.forEach(function (e) { if (!parId(e.id)) liste.push({ id: e.id, nom: e.nom, couleur: e.couleur }); });
    signaler();
  }

  return {
    COULEURS: COULEURS, liste: function () { return liste; }, parId: parId, nom: nom, couleur: couleur,
    creer: creer, modifier: modifier, supprimer: supprimer, compter: compter,
    exporter: exporter, nettoyer: nettoyer, charger: charger, surChangement: function (cb) { ecouteurs.push(cb); }
  };
})();
