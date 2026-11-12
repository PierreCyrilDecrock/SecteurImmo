/*
 * synchro-ui.js – Fenêtre « Synchroniser ordinateur ↔ téléphone » : affichage des QR codes, lecture par la
 * caméra (BarcodeDetector du navigateur, sinon bibliothèque jsQR), copier / coller du code en secours,
 * progression et bilan de l'échange.
 * Les bibliothèques QR (vendor/) ne sont chargées qu'à l'ouverture de cette fenêtre.
 * Expose l'objet global SynchroUi.
 */
var SynchroUi = (function () {
  'use strict';

  var el = Ui.el, icone = Ui.icone;
  var dlg, mode = 'accueil', flux = null, timerScan = null, detecteur = null, dernierLu = null;

  // ---------- Bibliothèques chargées à la demande ----------
  var scripts = {};
  function chargerScript(src) {
    if (!scripts[src]) scripts[src] = new Promise(function (ok, ko) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('Chargement de ' + src + ' impossible')); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }

  // ---------- QR code ----------
  function dessinerQr(conteneur, code) {
    return chargerScript('vendor/qrcode-generator/qrcode.js').then(function () {
      var qr = qrcode(0, 'M'); qr.addData(code, 'Byte'); qr.make();
      var n = qr.getModuleCount(), marge = 4, taille = 280, pas = Math.floor(taille / (n + 2 * marge));
      var c = document.createElement('canvas'); c.width = c.height = pas * (n + 2 * marge);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + marge) * pas, (y + marge) * pas, pas, pas);
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'QR code de synchronisation');
      conteneur.innerHTML = ''; conteneur.appendChild(c); conteneur.dataset.code = code;
    });
  }

  // ---------- Caméra ----------
  function arreterCamera() {
    clearTimeout(timerScan); timerScan = null;
    if (flux) { flux.getTracks().forEach(function (t) { t.stop(); }); flux = null; }
  }
  function demarrerCamera(zone, surCode) {
    arreterCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { zone.appendChild(el('p', 'aide-champ', 'Caméra indisponible dans ce navigateur : utilisez « Coller un code ».')); return; }
    var video = el('video', 'synchro-video'); video.setAttribute('playsinline', ''); video.muted = true; video.setAttribute('aria-label', 'Image de la caméra');
    var cadre = el('div', 'synchro-camera'); cadre.appendChild(video); cadre.appendChild(el('span', 'synchro-viseur'));
    zone.appendChild(cadre);
    var canvas = document.createElement('canvas'), g = canvas.getContext('2d', { willReadFrequently: true });
    var prets = ('BarcodeDetector' in window ? window.BarcodeDetector.getSupportedFormats().catch(function () { return []; }) : Promise.resolve([]))
      .then(function (f) { if (f.indexOf('qr_code') >= 0) detecteur = new window.BarcodeDetector({ formats: ['qr_code'] }); else return chargerScript('vendor/jsqr/jsQR.js'); });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (s) {
      flux = s; video.srcObject = s; return video.play();
    }).then(function () { return prets; }).then(function () {
      function lire() {
        if (!flux) return;
        var w = video.videoWidth, h = video.videoHeight;
        if (!w) { timerScan = setTimeout(lire, 200); return; }
        var essai = detecteur ? detecteur.detect(video).then(function (r) { return r[0] && r[0].rawValue; }) : Promise.resolve().then(function () {
          var k = Math.min(1, 640 / w); canvas.width = w * k; canvas.height = h * k;
          g.drawImage(video, 0, 0, canvas.width, canvas.height);
          var r = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          return r && r.data;
        });
        essai.then(function (txt) {
          if (txt && txt !== dernierLu && Synchro.typeCode(txt)) { dernierLu = txt; Ui.vibrer(30); surCode(txt); }
          else if (flux) timerScan = setTimeout(lire, 180);
        }, function () { if (flux) timerScan = setTimeout(lire, 300); });
      }
      lire();
    }).catch(function () {
      cadre.remove();
      zone.appendChild(el('p', 'aide-champ', 'Caméra refusée ou absente : autorisez-la dans le navigateur, ou utilisez « Coller un code ».'));
    });
  }

  // Secours sans caméra : coller le code reçu (message, e-mail…)
  function zoneColler(surCode) {
    var d = el('details', 'synchro-coller');
    d.appendChild(el('summary', null, 'Pas de caméra ? Coller un code'));
    var t = el('textarea', 'saisie'); t.rows = 3; t.id = 'synchro-code-colle'; t.setAttribute('aria-label', 'Code de synchronisation');
    t.placeholder = 'Collez ici le code copié sur l\'autre appareil (commence par SI1|)';
    d.appendChild(t);
    d.appendChild(Ui.bouton('Valider le code', 'btn btn-sm', function () { var v = t.value.trim(); if (!Synchro.typeCode(v)) { Notif.alerter('Ce code ne vient pas de SecteurImmo.', 'erreur'); return; } surCode(v); }, { id: 'synchro-valider-code' }));
    return d;
  }
  function boutonCopier(code) {
    return Ui.bouton([icone('file-json', 'ic-sm'), 'Copier le code'], 'btn btn-sm btn-fantome', function () {
      (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(function () { Notif.afficher('Code copié : envoyez-le à l\'autre appareil (message, e-mail…).', { type: 'succes' }); },
        function () { Notif.alerter('Copie impossible dans ce navigateur.'); });
    }, { id: 'synchro-copier' });
  }

  // ---------- Fenêtre ----------
  function tete(titre, sous) {
    var t = el('div', 'modale-tete');
    var m = el('span', 'medaillon-modale'); m.appendChild(icone('qr-code')); t.appendChild(m);
    var x = el('div'); var h = el('h2', null, titre); h.id = 'dlg-synchro-titre'; x.appendChild(h);
    if (sous) x.appendChild(el('p', 'sous-titre', sous));
    t.appendChild(x);
    return t;
  }
  function pied(boutons) { var p = el('div', 'modale-pied'); boutons.forEach(function (b) { p.appendChild(b); }); return p; }
  function fermerBouton(texte) { return Ui.bouton(texte || 'Fermer', 'btn btn-fantome', function () { dlg.close(); }, { id: 'synchro-fermer' }); }

  function recu(code) {
    Synchro.recevoirCode(code).catch(function (e) { Notif.alerter(e.message || 'Code refusé.', 'erreur'); dernierLu = null; });
  }

  function dessiner() {
    var e = Synchro.etat();
    if (e.etape === 'transfert' || e.etape === 'connexion') mode = 'transfert';
    if (e.etape === 'termine') mode = 'termine';
    if (e.etape === 'erreur') mode = 'erreur';
    if (e.etape === 'reponse') mode = 'reponse';
    if (e.etape === 'preparation' && mode === 'scanner') mode = 'transfert';   // code lu : préparation de la réponse
    dlg.innerHTML = '';
    dlg.dataset.mode = mode;
    var corps = el('div', 'modale-corps synchro-corps');

    if (mode === 'accueil') {
      arreterCamera();
      dlg.appendChild(tete('Synchroniser deux appareils', 'Ordinateur ↔ téléphone, en direct et sans serveur'));
      corps.appendChild(el('p', null, 'Ouvrez SecteurImmo sur les deux appareils, connectés au même Wi-Fi. Chacun affiche un QR code que l\'autre scanne ; puis les fiches, secteurs, tournées et bâtiments sont fusionnés dans les deux sens (la version la plus récente gagne).'));
      var choix = el('div', 'synchro-choix');
      choix.appendChild(Ui.bouton([icone('qr-code'), el('strong', null, 'Afficher mon code'), el('span', null, 'Je commence sur cet appareil')], 'carte-choix', function () { mode = 'offre'; dessiner(); Synchro.demarrer().then(dessiner, dessiner); }, { id: 'synchro-commencer' }));
      choix.appendChild(Ui.bouton([icone('camera'), el('strong', null, 'Scanner un code'), el('span', null, 'L\'autre appareil affiche déjà le sien')], 'carte-choix', function () { mode = 'scanner'; dessiner(); }, { id: 'synchro-scanner' }));
      corps.appendChild(choix);
      corps.appendChild(el('p', 'aide-champ', 'Il faut une caméra sur chaque appareil (la webcam de l\'ordinateur suffit), ou bien copier et coller les codes. Sans réseau commun : Données → Exporter, puis Importer.'));
      dlg.appendChild(corps); dlg.appendChild(pied([fermerBouton()]));
    } else if (mode === 'offre') {
      dlg.appendChild(tete('Étape 1 sur 2', 'Scannez ce code avec l\'autre appareil (Données → Synchroniser → Scanner un code)'));
      var g = el('div', 'synchro-grille');
      var q = el('div', 'synchro-qr'); q.id = 'synchro-qr'; q.appendChild(el('span', 'chargement-adresse'));
      var col = el('div', 'synchro-colonne'); col.appendChild(q);
      if (e.code) { dessinerQr(q, e.code); col.appendChild(boutonCopier(e.code)); }
      g.appendChild(col);
      var scan = el('div', 'synchro-colonne');
      scan.appendChild(el('strong', null, 'Étape 2 : montrez ici le code de réponse'));
      g.appendChild(scan);
      corps.appendChild(g);
      if (e.code) { demarrerCamera(scan, recu); scan.appendChild(zoneColler(recu)); }
      dlg.appendChild(corps); dlg.appendChild(pied([Ui.bouton('Retour', 'btn btn-fantome', retour)]));
    } else if (mode === 'scanner') {
      dlg.appendChild(tete('Scanner le code', 'Visez le QR code affiché sur l\'autre appareil'));
      var z = el('div', 'synchro-colonne');
      corps.appendChild(z);
      demarrerCamera(z, recu);
      corps.appendChild(zoneColler(recu));
      dlg.appendChild(corps); dlg.appendChild(pied([Ui.bouton('Retour', 'btn btn-fantome', retour)]));
    } else if (mode === 'reponse') {
      arreterCamera();
      dlg.appendChild(tete('Montrez ce code à l\'autre appareil', 'Il le scanne avec sa caméra ; la connexion démarre aussitôt'));
      var qr = el('div', 'synchro-qr'); qr.id = 'synchro-qr';
      var c2 = el('div', 'synchro-colonne'); c2.appendChild(qr); c2.appendChild(boutonCopier(e.code));
      corps.appendChild(c2);
      dessinerQr(qr, e.code);
      corps.appendChild(el('p', 'aide-champ synchro-attente', 'En attente de l\'autre appareil…'));
      dlg.appendChild(corps); dlg.appendChild(pied([Ui.bouton('Annuler', 'btn btn-fantome', retour)]));
    } else if (mode === 'transfert') {
      arreterCamera();
      dlg.appendChild(tete('Synchronisation en cours', 'Gardez les deux appareils ouverts'));
      var p = el('div', 'synchro-progression');
      var sp = el('span', 'tl-ic'); sp.appendChild(icone('loader-circle', 'rotation')); p.appendChild(sp);
      p.appendChild(el('strong', null, e.texte || 'Connexion…'));
      var det = [e.envoi !== undefined ? 'Envoi ' + e.envoi + ' %' : '', e.reception !== undefined ? 'Réception ' + e.reception + ' %' : ''].filter(Boolean).join(' · ');
      if (det) p.appendChild(el('span', 'sous-titre', det));
      corps.appendChild(p);
      dlg.appendChild(corps); dlg.appendChild(pied([Ui.bouton('Annuler', 'btn btn-fantome', retour)]));
    } else if (mode === 'termine') {
      dlg.appendChild(tete('Synchronisation terminée', 'Les deux appareils ont maintenant les mêmes données'));
      var r = e.recu || {}, s = e.envoye || {};
      var ul = el('ul', 'synchro-bilan');
      function ligne(ic, t) { var li = el('li'); li.appendChild(icone(ic, 'ic-sm')); li.appendChild(document.createTextNode(t)); ul.appendChild(li); }
      function pl(n, un, plusieurs) { n = n || 0; return Ui.nombre(n) + ' ' + (n > 1 ? plusieurs : un); }
      var rl = [pl(r.fiches, 'fiche mise à jour', 'fiches mises à jour'), pl(r.batiments, 'bâtiment', 'bâtiments')];
      if (r.secteurs) rl.push(pl(r.secteurs, 'secteur', 'secteurs'));
      if (r.tournees) rl.push(pl(r.tournees, 'tournée', 'tournées'));
      if (r.communes) rl.push(pl(r.communes, 'commune', 'communes'));
      if (r.effacees) rl.push(pl(r.effacees, 'suppression', 'suppressions'));
      ligne('download', 'Reçu : ' + rl.join(', '));
      ligne('upload', 'Envoyé : ' + pl(s.fiches, 'fiche', 'fiches') + ', ' + pl(s.batiments, 'bâtiment', 'bâtiments'));
      corps.appendChild(ul);
      dlg.appendChild(corps); dlg.appendChild(pied([fermerBouton('Terminer')]));
      majDerniere();
    } else if (mode === 'erreur') {
      arreterCamera();
      dlg.appendChild(tete('Synchronisation interrompue'));
      var a = el('p', 'alerte-dpe'); a.appendChild(icone('triangle-alert', 'ic-sm')); a.appendChild(document.createTextNode(e.texte || 'Erreur.'));
      corps.appendChild(a);
      corps.appendChild(el('p', 'aide-champ', 'Rien n\'a été perdu. Vérifiez que les deux appareils sont sur le même Wi-Fi, puis recommencez sur les deux.'));
      dlg.appendChild(corps); dlg.appendChild(pied([fermerBouton(), Ui.bouton('Recommencer', 'btn btn-primaire', retour, { id: 'synchro-recommencer' })]));
    }
  }
  function retour() { Synchro.annuler(); dernierLu = null; mode = 'accueil'; dessiner(); }

  function ouvrir() {
    if (!Synchro.disponible()) { Notif.alerter('Ce navigateur ne permet pas la connexion directe entre appareils : utilisez Exporter / Importer.'); return; }
    Synchro.annuler(); mode = 'accueil'; dernierLu = null;
    dessiner();
    if (!dlg.open) dlg.showModal();
  }
  function majDerniere() {
    var t = Store.getMeta('derniereSynchro'), x = document.getElementById('synchro-derniere');
    if (x && t) x.textContent = 'Dernière synchronisation : ' + new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function init() {
    dlg = document.getElementById('dlg-synchro');
    document.getElementById('btn-synchro').addEventListener('click', ouvrir);
    dlg.addEventListener('close', function () { arreterCamera(); if (Synchro.etat().etape !== 'transfert') Synchro.annuler(); });
    Synchro.surChangement(function () { if (dlg.open) dessiner(); });
    setTimeout(majDerniere, 500);
  }

  return { init: init, ouvrir: ouvrir };
})();
