/*
 * progression.js – Suit les badges débloqués, les défis réussis et les changements de niveau,
 * pour les célébrer une seule fois (notification + confettis). Mémorisé dans la base locale.
 * Au tout premier lancement, l'existant est enregistré sans célébration (pas d'avalanche de badges).
 * Expose l'objet global Progression.
 */
var Progression = (function () {
  'use strict';

  var vus = null;     // { badges: [ids], defis: { semaine: [ids] }, niveau }
  var timer = null, ecouteurs = [];

  function memoriser() { Store.kvSet('progression', JSON.parse(JSON.stringify(vus))); }

  function verifier(silencieux) {
    var e = Defis.etat();
    var nouveaux = [];
    if (!vus) { vus = { badges: [], defis: {}, niveau: e.experience.niveau }; silencieux = true; }
    e.badges.forEach(function (b) {
      if (b.ok && vus.badges.indexOf(b.id) < 0) { vus.badges.push(b.id); nouveaux.push({ type: 'badge', titre: 'Badge débloqué : ' + b.titre, ic: b.ic }); }
    });
    var sem = Defis.cleSemaine(new Date());
    var faits = vus.defis[sem] || (vus.defis[sem] = []);
    e.defis.forEach(function (d) {
      if (d.ok && faits.indexOf(d.id) < 0) { faits.push(d.id); nouveaux.push({ type: 'defi', titre: 'Défi réussi : ' + d.titre + ' (+' + d.xp + ' XP)', ic: d.ic }); }
    });
    // On ne garde que les 12 dernières semaines
    Object.keys(vus.defis).sort().slice(0, -12).forEach(function (k) { delete vus.defis[k]; });
    if (e.experience.niveau > (vus.niveau || 1)) nouveaux.push({ type: 'niveau', titre: 'Niveau ' + e.experience.niveau + ' atteint : ' + e.experience.titre + ' !', ic: 'crown' });
    vus.niveau = e.experience.niveau;
    if (nouveaux.length || silencieux) memoriser();
    if (!silencieux && nouveaux.length) {
      Celebration.confettis();
      nouveaux.slice(0, 3).forEach(function (n, i) { setTimeout(function () { Notif.afficher(n.titre, { type: 'succes', duree: 6000 }); }, i * 350); });
      Ui.vibrer([20, 40, 20]);
    }
    ecouteurs.forEach(function (cb) { cb(e, nouveaux); });
    return { etat: e, nouveaux: nouveaux };
  }

  function planifier() { clearTimeout(timer); timer = setTimeout(function () { verifier(false); }, 700); }

  // Appelé après la restauration des données
  function init(donnees) {
    vus = donnees && donnees.badges ? donnees : null;
    verifier(true);
    Statuts.surPassages(planifier);
    Tournees.surChangement(function (type) { if (type === 'fin') planifier(); });
    Secteurs.surStructure(planifier);
  }

  return { init: init, verifier: verifier, surVerification: function (cb) { ecouteurs.push(cb); } };
})();
