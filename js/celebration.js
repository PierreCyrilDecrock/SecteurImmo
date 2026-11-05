/*
 * celebration.js – Petite pluie de confettis (canvas) pour les records, badges et défis réussis.
 * Rien ne s'affiche si le système demande de réduire les animations ou si les célébrations sont désactivées.
 * Expose l'objet global Celebration.
 */
var Celebration = (function () {
  'use strict';

  var CLE = 'secteurimmo-celebrations';
  var COULEURS = ['#2a78d6', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#eb6834', '#008300'];

  function actives() { try { return localStorage.getItem(CLE) !== 'non'; } catch (e) { return true; } }
  function activer(v) { try { localStorage.setItem(CLE, v ? 'oui' : 'non'); } catch (e) { /* non mémorisé */ } }

  function confettis() {
    if (!actives() || Ui.reduitMouvement()) return;
    var c = document.createElement('canvas');
    c.className = 'confettis'; c.setAttribute('aria-hidden', 'true');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    document.body.appendChild(c);
    var ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
    var parts = [];
    for (var i = 0; i < 140; i++) {
      parts.push({ x: innerWidth / 2 + (Math.random() - .5) * 160, y: innerHeight * .35, vx: (Math.random() - .5) * 13, vy: -Math.random() * 13 - 4,
        r: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - .5) * .3, c: COULEURS[i % COULEURS.length], f: Math.random() < .5 });
    }
    var t0 = performance.now();
    (function cadre(t) {
      var e = t - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - e / 2200); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        if (p.f) ctx.fillRect(-p.r / 2, -p.r, p.r, p.r * 2); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, 7); ctx.fill(); }
        ctx.restore();
      });
      if (e < 2200) requestAnimationFrame(cadre); else c.remove();
    })(t0);
  }

  return { confettis: confettis, actives: actives, activer: activer };
})();
