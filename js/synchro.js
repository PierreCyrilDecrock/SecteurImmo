/*
 * synchro.js – Synchronisation directe entre deux appareils (ordinateur ↔ téléphone), sans serveur.
 *
 * Les deux appareils se connectent en WebRTC (connexion chiffrée, pair à pair). Pour s'échanger les
 * informations de connexion sans serveur, chacun affiche un QR code que l'autre scanne :
 *   1. l'appareil A affiche son code (offre) ;
 *   2. l'appareil B le scanne et affiche sa réponse ;
 *   3. A scanne la réponse : la connexion s'établit (de préférence sur le même Wi-Fi).
 * Puis chacun envoie à l'autre ses fiches, suppressions, secteurs, étiquettes, tournées, communes et
 * les bâtiments que l'autre n'a pas ; chacun fusionne (la version la plus récente de chaque fiche gagne).
 * Un serveur STUN public sert seulement à trouver l'adresse réseau (aucune donnée n'y passe).
 * Expose l'objet global Synchro.
 */
var Synchro = (function () {
  'use strict';

  var config = { stun: [{ urls: 'stun:stun.l.google.com:19302' }], attenteIceMs: 2500, delaiConnexionMs: 30000, morceau: 16000 };
  var VERSION = 1, PREFIXE = 'SI1';
  var pc = null, canal = null, role = null, ecouteurs = [], etat = { etape: 'repos' };
  var reception = {}, recu = null, envoye = null, timerConnexion = null, finiLocal = false, finiDistant = false;

  function changer(e) { etat = Object.assign({}, etat, e); ecouteurs.forEach(function (cb) { cb(etat); }); }

  // ---------- Signalisation compacte (tient dans un QR code lisible) ----------

  function attendreIce(p) {
    return new Promise(function (ok) {
      if (p.iceGatheringState === 'complete') return ok();
      var t = setTimeout(ok, config.attenteIceMs);
      p.addEventListener('icegatheringstatechange', function () { if (p.iceGatheringState === 'complete') { clearTimeout(t); ok(); } });
    });
  }
  function b64(hex) { return btoa(hex.split(':').map(function (h) { return String.fromCharCode(parseInt(h, 16)); }).join('')); }
  function hex(b) { return Array.prototype.map.call(atob(b), function (c) { return ('0' + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2); }).join(':'); }

  // SDP -> « SI1|O|ufrag|pwd|empreinte|candidat;candidat… »
  function compacter(sdp, type) {
    var l = sdp.split(/\r?\n/), v = function (k) { var x = l.filter(function (y) { return y.indexOf('a=' + k + ':') === 0; })[0]; return x ? x.slice(k.length + 3) : ''; };
    var fp = v('fingerprint').replace(/^sha-256\s+/i, '');
    var cands = l.filter(function (y) { return y.indexOf('a=candidate:') === 0; }).map(function (y) {
      var p = y.slice(12).split(' ');   // fondation composant protocole priorité adresse port typ type …
      return [p[0], p[2], p[3], p[4], p[5], p[7]].join(' ');
    }).filter(function (c) { return / udp /i.test(' ' + c + ' '); }).slice(0, 6);
    return [PREFIXE, type === 'offer' ? 'O' : 'R', v('ice-ufrag'), v('ice-pwd'), b64(fp), cands.join(';')].join('|');
  }
  function decompacter(code) {
    var p = String(code || '').trim().split('|');
    if (p[0] !== PREFIXE || p.length < 6) throw new Error('Ce QR code ne vient pas de SecteurImmo.');
    var lignes = ['v=0', 'o=- ' + Date.now() + ' 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0'];
    (p[5] ? p[5].split(';') : []).forEach(function (c) {
      var x = c.split(' ');
      lignes.push('a=candidate:' + x[0] + ' 1 ' + x[1] + ' ' + x[2] + ' ' + x[3] + ' ' + x[4] + ' typ ' + x[5]);
    });
    lignes.push('a=ice-ufrag:' + p[2], 'a=ice-pwd:' + p[3], 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + hex(p[4]),
      'a=setup:' + (p[1] === 'O' ? 'actpass' : 'active'), 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144');
    return { type: p[1] === 'O' ? 'offer' : 'answer', sdp: lignes.join('\r\n') + '\r\n' };
  }
  function typeCode(code) { var p = String(code || '').split('|'); return p[0] === PREFIXE ? (p[1] === 'O' ? 'offre' : 'reponse') : null; }

  // ---------- Connexion ----------

  function nouvelleConnexion() {
    fermer(true);
    reception = {}; recu = null; envoye = null; finiLocal = false; finiDistant = false;
    pc = new RTCPeerConnection({ iceServers: config.stun });
    pc.addEventListener('connectionstatechange', function () {
      if (pc && (pc.connectionState === 'failed')) erreur('Connexion impossible : vérifiez que les deux appareils sont sur le même réseau Wi-Fi, puis réessayez.');
    });
    return pc;
  }
  function brancherCanal(c) {
    canal = c;
    canal.binaryType = 'arraybuffer';
    canal.bufferedAmountLowThreshold = 256 * 1024;
    canal.onopen = function () { clearTimeout(timerConnexion); changer({ etape: 'transfert', texte: 'Connecté : échange des données…' }); envoyerBonjour(); };
    canal.onmessage = function (e) { recevoirMessage(e.data); };
    canal.onclose = function () { if (etat.etape === 'transfert') erreur('La connexion a été interrompue.'); };
  }
  function surveiller() {
    clearTimeout(timerConnexion);
    timerConnexion = setTimeout(function () { if (etat.etape !== 'transfert' && etat.etape !== 'termine') erreur('Connexion impossible : les deux appareils doivent être sur le même réseau Wi-Fi. Réessayez.'); }, config.delaiConnexionMs);
  }

  // Appareil A : crée l'offre (à afficher en QR code)
  function demarrer() {
    role = 'A';
    var p = nouvelleConnexion();
    brancherCanal(p.createDataChannel('secteurimmo', { ordered: true }));
    changer({ etape: 'preparation', texte: 'Préparation du code…' });
    return p.createOffer().then(function (o) { return p.setLocalDescription(o); }).then(function () { return attendreIce(p); }).then(function () {
      var code = compacter(p.localDescription.sdp, 'offer');
      changer({ etape: 'offre', code: code, texte: 'Scannez ce code avec l\'autre appareil, puis scannez sa réponse.' });
      return code;
    }).catch(function (e) { erreur('Impossible de préparer la connexion (' + (e && e.message || e) + ').'); throw e; });
  }

  // Code scanné : offre (appareil B : on répond) ou réponse (appareil A : on se connecte)
  function recevoirCode(code) {
    var t = typeCode(code);
    if (!t) return Promise.reject(new Error('Ce QR code ne vient pas de SecteurImmo.'));
    if (t === 'offre') {
      role = 'B';
      var p = nouvelleConnexion();
      p.ondatachannel = function (e) { brancherCanal(e.channel); };
      changer({ etape: 'preparation', texte: 'Préparation de la réponse…' });
      return p.setRemoteDescription(decompacter(code)).then(function () { return p.createAnswer(); }).then(function (a) { return p.setLocalDescription(a); })
        .then(function () { return attendreIce(p); }).then(function () {
          var rep = compacter(p.localDescription.sdp, 'answer');
          changer({ etape: 'reponse', code: rep, texte: 'Montrez ce code à l\'autre appareil pour qu\'il le scanne.' });
          surveiller();
          return rep;
        }).catch(function (e) { erreur('Code illisible ou périmé : recommencez sur les deux appareils.'); throw e; });
    }
    if (!pc || role !== 'A' || !pc.localDescription) return Promise.reject(new Error('Affichez d\'abord votre code sur cet appareil.'));
    changer({ etape: 'connexion', texte: 'Connexion en cours…' });
    surveiller();
    return pc.setRemoteDescription(decompacter(code)).catch(function (e) { erreur('Réponse illisible : recommencez sur les deux appareils.'); throw e; });
  }

  // ---------- Échange ----------

  // Envoi d'un objet JSON en morceaux (avec contrôle du débit)
  function envoyer(obj) {
    var txt = JSON.stringify(obj), n = Math.ceil(txt.length / config.morceau) || 1, id = Math.random().toString(36).slice(2, 8), i = 0;
    return new Promise(function (ok, ko) {
      function suite() {
        try {
          while (i < n) {
            if (canal.bufferedAmount > 1024 * 1024) { canal.onbufferedamountlow = function () { canal.onbufferedamountlow = null; suite(); }; return; }
            canal.send(JSON.stringify({ m: id, i: i, n: n, d: txt.slice(i * config.morceau, (i + 1) * config.morceau) }));
            i++;
            if (n > 20 && i % 20 === 0) changer({ envoi: Math.round(100 * i / n) });
          }
          ok();
        } catch (e) { ko(e); }
      }
      suite();
    });
  }
  function recevoirMessage(brut) {
    var m; try { m = JSON.parse(brut); } catch (e) { return; }
    var r = reception[m.m] || (reception[m.m] = { n: m.n, parts: [], recus: 0 });
    if (r.parts[m.i] === undefined) { r.parts[m.i] = m.d; r.recus++; }
    if (r.n > 20 && r.recus % 20 === 0) changer({ reception: Math.round(100 * r.recus / r.n) });
    if (r.recus < r.n) return;
    delete reception[m.m];
    var obj; try { obj = JSON.parse(r.parts.join('')); } catch (e) { erreur('Données reçues incomplètes.'); return; }
    traiter(obj);
  }

  function envoyerBonjour() {
    envoyer({ type: 'bonjour', version: VERSION, batiments: Object.keys(DataImmo._batiments()) }).catch(function () { erreur('Envoi impossible.'); });
  }

  // Tout ce que l'autre appareil doit recevoir (bâtiments : seulement ceux qui lui manquent)
  function paquet(sesBatiments) {
    var chez = {}; (sesBatiments || []).forEach(function (id) { chez[id] = 1; });
    var bs = DataImmo._batiments(), manquants = Object.keys(bs).filter(function (id) { return !chez[id]; }).map(function (id) { return bs[id]; });
    return {
      type: 'donnees', version: VERSION,
      records: Statuts._records(), supprimes: Statuts.supprimes(), manuels: Statuts.manuels(), adresses: Statuts.adressesToutes(),
      secteurs: Secteurs.exporter(), etiquettes: Etiquettes.exporter(), tournees: { liste: Tournees.exporter().liste },
      communes: Communes.exporter(), zones: DataImmo.zones(), batiments: manquants
    };
  }

  function traiter(obj) {
    if (obj.type === 'bonjour') {
      if (obj.version !== VERSION) { erreur('Les deux appareils n\'ont pas la même version de SecteurImmo : rechargez la page sur les deux.'); return; }
      var p = paquet(obj.batiments);
      envoye = { fiches: Object.keys(p.records).length, batiments: p.batiments.length };
      changer({ texte: 'Envoi des données…' });
      envoyer(p).catch(function () { erreur('Envoi impossible.'); });
    } else if (obj.type === 'donnees') {
      changer({ texte: 'Fusion des données reçues…' });
      setTimeout(function () {
        try { recu = fusionner(obj); } catch (e) { erreur('Fusion impossible (' + e.message + ').'); return; }
        finiLocal = true;
        envoyer({ type: 'fini' }).then(verifierFin);
      }, 30);
    } else if (obj.type === 'fini') { finiDistant = true; verifierFin(); }
  }
  function verifierFin() {
    if (!finiLocal || !finiDistant) return;
    changer({ etape: 'termine', recu: recu, envoye: envoye, texte: 'Synchronisation terminée.' });
    Store.setMeta('derniereSynchro', Date.now());
    setTimeout(function () { fermer(true); }, 800);
  }

  // Fusion des données de l'autre appareil (rien n'est écrasé sans être plus récent)
  function fusionner(d) {
    var bilan = { fiches: 0, effacees: 0, batiments: 0, secteurs: 0, tournees: 0, communes: 0 };
    // Bâtiments (géométries, adresses, DPE, ventes) qui manquaient ici
    var fs = (d.batiments || []).filter(function (f) { return f && typeof f.id === 'string' && f.geometry && f.properties; });
    var nouveaux = DataImmo.ajouter(fs.map(function (f) { var p = Object.assign({}, f.properties); delete p._t; p._t = TypesBati.classer(p); return { type: 'Feature', id: f.id, properties: p, geometry: f.geometry }; }));
    if (nouveaux.length) { CarteImmo.afficherBatiments(nouveaux); Store.enregistrerBatiments(nouveaux); }
    bilan.batiments = nouveaux.length;
    (d.zones || []).forEach(function (z) { if (z && Array.isArray(z.b)) DataImmo.zones().push(z); });
    Store.enregistrerZones(DataImmo.zones());
    // Fiches, suppressions, points ajoutés
    var r = Statuts.fusionner(d);
    bilan.fiches = r.recues; bilan.effacees = r.effacees;
    CarteImmo.synchroniserManuels(Statuts.manuels());
    // Secteurs, étiquettes, tournées, communes
    var sec = Secteurs.nettoyer(d.secteurs).donnees;
    sec.supprimes = d.secteurs && d.secteurs.supprimes && typeof d.secteurs.supprimes === 'object' ? d.secteurs.supprimes : {};
    bilan.secteurs = Secteurs.fusionner(sec);
    var et = Etiquettes.nettoyer(d.etiquettes); if (et.length) Etiquettes.charger(et, 'fusionner');
    var tn = Tournees.nettoyer(d.tournees), avant = Tournees.liste().length;
    if (tn.liste.length) Tournees.charger({ liste: tn.liste, active: Tournees.active() }, 'fusionner');
    bilan.tournees = Tournees.liste().length - avant;
    var cs = (d.communes || []).filter(function (c) { return c && c.code && Array.isArray(c.contour) && !Communes.parCode(c.code); });
    if (cs.length) { Communes.charger(Communes.liste().concat(cs)); Store.kvSet('communes', Communes.exporter()); }
    bilan.communes = cs.length;
    CarteUi.majLegende();
    Store.flush();
    return bilan;
  }

  function erreur(message) { clearTimeout(timerConnexion); changer({ etape: 'erreur', texte: message }); fermer(true); }
  function fermer(garderEtat) {
    clearTimeout(timerConnexion);
    try { if (canal) canal.close(); } catch (e) { /* déjà fermé */ }
    try { if (pc) pc.close(); } catch (e) { /* déjà fermé */ }
    canal = null; pc = null;
    if (!garderEtat) changer({ etape: 'repos', code: null, texte: '' });
  }

  return {
    config: config, demarrer: demarrer, recevoirCode: recevoirCode, typeCode: typeCode, annuler: function () { fermer(false); },
    etat: function () { return etat; }, surChangement: function (cb) { ecouteurs.push(cb); },
    disponible: function () { return typeof RTCPeerConnection === 'function'; },
    _compacter: compacter, _decompacter: decompacter
  };
})();
