/*
 * position.js – « Ma position » : point bleu suivi en direct (géolocalisation du navigateur).
 * États du bouton 📍 : arrêt -> suivi (la carte suit) -> [déplacement manuel : position affichée, sans suivi]
 * -> clic : suivi de nouveau ; clic en suivi : arrêt.
 * La position n'est ni enregistrée ni envoyée : elle ne sert qu'à l'affichage et à « Suivant » (secteurs).
 * Expose l'objet global Position.
 */
var Position = (function () {
  'use strict';

  var map, alerter = function () {}, btn;
  var idSuivi = null, suivre = false, derniere = null, point = null, cercle = null, verrou = null, premier = true;

  // ---------- Écran toujours allumé pendant le suivi (si le navigateur le permet) ----------
  function garderEcran() {
    if (!('wakeLock' in navigator) || verrou) return;
    navigator.wakeLock.request('screen').then(function (v) {
      verrou = v; v.addEventListener('release', function () { verrou = null; });
    }).catch(function () { /* refusé : sans importance */ });
  }
  function relacherEcran() { if (verrou) { verrou.release().catch(function () {}); verrou = null; } }

  // ---------- Affichage ----------
  function majBouton() {
    var actif = idSuivi !== null;
    btn.setAttribute('aria-pressed', actif && suivre ? 'true' : 'false');
    btn.classList.toggle('position-libre', actif && !suivre);
    var t = !actif ? 'Ma position : afficher et suivre'
      : (suivre ? 'Ma position : suivi actif (cliquez pour arrêter)' : 'Ma position affichée : cliquez pour recentrer la carte');
    btn.title = t; btn.setAttribute('aria-label', t);
  }

  function dessiner(ll, precision) {
    if (!point) {
      cercle = L.circle(ll, { radius: precision, color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false }).addTo(map);
      point = L.circleMarker(ll, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(map);
    } else { cercle.setLatLng(ll).setRadius(precision); point.setLatLng(ll); }
  }

  function surPosition(p) {
    derniere = [p.coords.latitude, p.coords.longitude];
    var ll = L.latLng(derniere);
    dessiner(ll, Math.min(p.coords.accuracy || 20, 500));
    if (premier) { premier = false; map.setView(ll, Math.max(map.getZoom(), 18)); }
    else if (suivre) map.panTo(ll, { animate: true, duration: 0.5 });
  }

  function surErreur(e) {
    if (e.code === 1) { alerter('Localisation refusée : autorisez-la dans les réglages du navigateur pour ce site.'); arreter(); }
    else alerter('Position indisponible pour le moment (signal GPS faible ?).');
  }

  function demarrer() {
    if (!navigator.geolocation) { alerter('La géolocalisation n\'est pas disponible sur cet appareil.'); return; }
    premier = true; suivre = true;
    idSuivi = navigator.geolocation.watchPosition(surPosition, surErreur, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    garderEcran(); majBouton();
  }

  function arreter() {
    if (idSuivi !== null) navigator.geolocation.clearWatch(idSuivi);
    idSuivi = null; suivre = false; derniere = null;
    if (point) { map.removeLayer(point); map.removeLayer(cercle); point = cercle = null; }
    relacherEcran(); majBouton();
  }

  function clic() {
    if (idSuivi === null) demarrer();
    else if (suivre) arreter();
    else { suivre = true; if (derniere) map.setView(derniere, Math.max(map.getZoom(), 18)); majBouton(); }
  }

  function init(carte, fnAlerter) {
    map = carte; alerter = fnAlerter; btn = document.getElementById('btn-position');
    btn.addEventListener('click', clic);
    // Si l'utilisateur déplace la carte, on arrête de la recentrer (mais le point reste affiché)
    map.on('dragstart', function () { if (suivre) { suivre = false; majBouton(); } });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && idSuivi !== null) garderEcran(); });
    majBouton();
  }

  return { init: init, courante: function () { return derniere; } };
})();
