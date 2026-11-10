/*
 * Tests de bout en bout de SecteurImmo (Playwright).
 *   node tests/e2e.js            (Playwright doit être installé ; axe-core facultatif pour l'accessibilité)
 * Chaque rubrique est indépendante : un échec n'arrête pas les suivantes.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const T = require('./commun');
const { page, clicMaison, pt, vue, chargerZone, recharger, tiroir, notif, ok, titre, lat0, lon0, grille } = T;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'secteurimmo-'));
let axeSrc = null;
try { axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch (e) { /* axe-core absent : contrôles d'accessibilité automatiques ignorés */ }

const rubriques = [];
const rubrique = (nom, fn) => rubriques.push({ nom, fn });

// ---------------------------------------------------------------------------------------------
rubrique('Démarrage, bienvenue, accueil', async (env) => {
  const p = await page(env, { bienvenue: true });
  await p.waitForSelector('#dlg-bienvenue[open]');
  ok(true, 'présentation de bienvenue au premier lancement');
  await p.click('#bienvenue-suivant'); await p.click('#bienvenue-suivant'); await p.click('#bienvenue-suivant');
  await p.click('#bienvenue-commencer');
  ok(await p.locator('#palette[open]').isVisible(), '« Trouver mon secteur » ouvre la recherche');
  await p.keyboard.press('Escape');
  ok(await p.locator('#accueil-carte').isVisible(), 'carte vide : encart d\'accueil affiché');
  await recharger(p);
  ok(!(await p.locator('#dlg-bienvenue[open]').count()), 'pas de présentation aux visites suivantes');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Recherche et palette de commandes', async (env) => {
  const p = await page(env);
  await p.keyboard.press('Control+k');
  await p.waitForSelector('#palette[open]');
  await p.keyboard.type('nantes');
  await p.waitForSelector('.palette-groupe:has-text("Adresses")');
  ok(await p.locator('.palette-item').first().innerText().then(t => /Nantes/.test(t)), 'suggestions d\'adresses');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const c = await p.evaluate(() => { const m = CarteImmo.getMap(); return [m.getCenter().lat, m.getZoom()]; });
  ok(Math.abs(c[0] - lat0) < 0.01 && c[1] >= 14, 'Entrée : la carte va sur l\'adresse');
  ok(await p.locator('#accueil-carte').isHidden(), 'l\'encart d\'accueil disparaît');
  await p.click('#btn-recherche'); await p.keyboard.type('bilan'); await p.keyboard.press('Enter');
  await p.waitForSelector('#tableau:not([hidden])');
  ok(true, 'action « Ouvrir le bilan » depuis la palette');
  await p.keyboard.press('Escape');
  ok(await p.locator('#tableau').isHidden(), 'Échap : retour à la carte');
  await p.ctx.close();
});

rubrique('Téléchargement des bâtiments (IGN, secours, reprise)', async (env) => {
  const rapide = () => { Telechargements.config.delaiBaseMs = 50; Telechargements.config.pauseMs = 20; };
  const p = await page(env, { wfs: (r, n, rep) => n === 1 ? r.fulfill({ status: 429, headers: { 'Retry-After': '0' }, body: '' }) : rep(r) });
  await p.evaluate(rapide);
  await vue(p, lat0, lon0, 14);
  await p.waitForSelector('#pastille-charger.discret');
  ok(/Zoomez/.test(await p.locator('#pastille-charger').innerText()), 'zoom insuffisant : invitation à zoomer');
  await p.click('#pastille-charger'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => CarteImmo.getMap().getZoom()) >= 15, 'la pastille zoome');
  await chargerZone(p);
  ok(await p.evaluate(() => CarteImmo.total()) === 12 && p.appels.wfs === 4, 'après une erreur 429, nouvel essai : 12 bâtiments (bâtiments, adresses, liens)');
  ok(await p.evaluate(() => DataImmo.adresse(DataImmo.batiment('bdt/100').properties)) === '1 Rue des Lilas', 'adresse BAN rattachée au bâtiment');
  await p.waitForTimeout(200);
  ok(/12 bâtiments ajoutés/.test(await p.locator('#pastille-charger').innerText()), 'confirmation « 12 bâtiments ajoutés »');
  await p.waitForTimeout(2800);
  ok(await p.locator('#pastille-charger').isHidden(), 'zone déjà chargée : plus de bouton');
  ok(/12 logements/.test(await p.locator('#legende .total').innerText()), 'légende : 12 logements');
  await p.ctx.close();

  // Pagination, pause, reprise après rechargement
  const r = await page(env);
  await r.evaluate(() => { Telechargements.config.pauseMs = 400; DataImmo.config.page = 5; });
  await vue(r, lat0 + 0.00025, lon0 + 0.0004, 19); await r.click('#pastille-charger');
  await r.waitForFunction(() => DataImmo._batiments && Object.keys(DataImmo._batiments()).length === 5);
  await r.click('#telechargement [data-action=pause]');
  await r.waitForFunction(() => Telechargements.liste()[0].etat === 'pause' && !Telechargements.actif());
  await r.waitForSelector('#telechargement.etat-pause');
  ok(/En pause/.test(await r.locator('#telechargement').innerText()), 'pause : carte de progression « En pause »');
  await r.waitForTimeout(500); await recharger(r);
  ok(await r.locator('#telechargement [data-action=reprendre]').isVisible() && await r.evaluate(() => CarteImmo.total()) === 5, 'après rechargement : tâche en pause conservée, 5 bâtiments reçus');
  await r.evaluate(() => { DataImmo.config.page = 5; Telechargements.config.pauseMs = 20; });
  await r.click('#telechargement [data-action=reprendre]');
  await r.waitForFunction(() => !Telechargements.enCours() && CarteImmo.total() === 12);
  ok(await r.evaluate(() => Telechargements.liste()[0].etat === 'fini' && Telechargements.liste()[0].etapes[0].total === 12), 'reprise là où elle s\'était arrêtée : 12 bâtiments (pages de 5)');
  await r.waitForSelector('#telechargement', { state: 'hidden' });
  ok(true, 'carte de progression masquée à la fin');
  await r.ctx.close();

  // IGN indisponible : secours OpenStreetMap, puis rattachement des fiches aux bâtiments IGN
  let ignEnPanne = true;
  const q = await page(env, { wfs: (r, n, rep) => ignEnPanne ? r.fulfill({ status: 503, body: '' }) : rep(r) });
  await q.evaluate(rapide);
  await chargerZone(q);
  ok(await q.evaluate(() => CarteImmo.total()) === 12 && q.appels.overpass === 1 && await q.evaluate(() => !!DataImmo.batiment('way/100')), 'IGN indisponible : bâtiments OpenStreetMap (secours)');
  await q.waitForTimeout(300);
  ok((await q.locator('.notif .texte').allInnerTexts()).some(t => /OpenStreetMap \(secours\)/.test(t)), 'avertissement : données de secours');
  await q.evaluate(() => Statuts.modifier(['way/100'], { statut: 'contact', nom: 'Mme Osm' }));
  ignEnPanne = false;
  await q.evaluate(() => { DataImmo.zones().length = 0; return Telechargements.zone(CarteImmo.getMap().getBounds()); });
  ok(await q.evaluate(() => !DataImmo.batiment('way/100') && Statuts.get('bdt/100') && Statuts.get('bdt/100').nom === 'Mme Osm' && !Statuts.get('way/100') && CarteImmo.total() === 12),
    'données IGN revenues : bâtiments OSM remplacés, fiche rattachée au bâtiment IGN');
  await q.ctx.close();

  // Échec complet : message clair et « Réessayer »
  const e = await page(env, { wfs: (r) => r.fulfill({ status: 504, body: '' }), overpass: (r) => r.fulfill({ status: 504, body: '' }), overpassMiroir: (r) => r.fulfill({ status: 504, body: '' }) });
  await e.evaluate(rapide);
  await vue(e, lat0, lon0, 19); await e.click('#pastille-charger');
  await e.waitForSelector('#telechargement.etat-erreur', { timeout: 10000 });
  ok(/occupé/.test(await e.locator('#telechargement').innerText()) && await e.locator('#telechargement [data-action=reessayer]').isVisible(), 'tous les serveurs en erreur : message clair et « Réessayer »');
  ok(!e.erreurs.length && !p.erreurs.length && !q.erreurs.length && !r.erreurs.length, 'aucune erreur JavaScript (' + e.erreurs.concat(q.erreurs, r.erreurs).join(' | ') + ')');
  await e.ctx.close();
});

rubrique('Fiche d\'une maison', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  await clicMaison(p, 'bdt/108');            // ligne sans rue OSM -> géocodage inverse
  await p.waitForSelector('#panneau.ouverte');
  await p.waitForFunction(() => /8 Rue Test/.test(document.querySelector('#fiche-titre').textContent));
  ok(p.appels.reverse === 1, 'adresse inconnue d\'OSM : géocodage inverse à l\'ouverture');
  await p.click('#panneau .choix-statut[data-statut=rappeler]');
  ok(await p.evaluate(() => Statuts.statutDe('bdt/108')) === 'rappeler' && await p.evaluate(() => !!Statuts.get('bdt/108').date), 'statut en un clic, date posée');
  await p.fill('#panneau input[type=text]', 'Mme Durand'); await p.fill('#panneau input[type=tel]', '06 12 34 56 78');
  await p.fill('#panneau textarea', '<b>Projet</b> au printemps'); await p.fill('#panneau input[type=number]', '2'); await p.locator('#panneau textarea').focus();
  await p.locator('#panneau input[type=number]').focus(); await p.locator('#panneau textarea').focus();
  const r = await p.evaluate(() => Statuts.get('bdt/108'));
  ok(r.nom === 'Mme Durand' && r.tel === '06 12 34 56 78' && r.note === '<b>Projet</b> au printemps' && r.logements === 2, 'nom, téléphone, note, logements enregistrés');
  ok(await p.locator('#panneau a[href^="tel:"]').getAttribute('href') === 'tel:0612345678', 'bouton d\'appel direct');
  await p.locator('#panneau textarea').blur();
  await p.keyboard.press('2');
  ok(await p.evaluate(() => Statuts.statutDe('bdt/108')) === 'contact', 'touche 2 : « Contact » sur la fiche ouverte');
  ok(await p.locator('#panneau .frise li').count() === 2, 'historique des passages (2 entrées)');
  ok(!(await p.locator('#panneau b').count()), 'note contenant du HTML affichée comme texte');
  await p.keyboard.press('Escape');
  ok(await p.locator('#panneau.ouverte').count() === 0, 'Échap ferme la fiche');
  await p.ctx.close();
});

rubrique('Tournée rapide et annulation', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  await p.keyboard.press('t');
  ok(await p.locator('[data-mode=tournee][aria-pressed=true]').count() === 1 && await p.locator('#contexte').isVisible(), 'touche T : mode tournée');
  await p.keyboard.press('3');
  ok(await p.locator('#contexte .choix-statut[data-statut=absent][aria-pressed=true]').count() === 1, 'touche 3 : statut « Absent »');
  for (const id of ['bdt/100', 'bdt/101', 'bdt/102']) await clicMaison(p, id);
  ok((await p.evaluate(() => ['bdt/100', 'bdt/101', 'bdt/102'].map(Statuts.statutDe))).join() === 'absent,absent,absent', '3 maisons marquées d\'un geste');
  ok(/3 portes/.test(await notif(p)), 'notification « 3 portes » (regroupée)');
  await p.locator('#notifications .notif .action').last().click();
  ok(await p.evaluate(() => Statuts.statutDe('bdt/102')) === 'aucun', '« Annuler » dans la notification');
  await p.keyboard.press('Control+z');
  ok(await p.evaluate(() => Statuts.statutDe('bdt/101')) === 'aucun', 'Ctrl+Z');
  await p.keyboard.press('Escape');
  ok(await p.locator('#contexte').isHidden(), 'Échap : retour au mode consulter');
  await p.ctx.close();
});

rubrique('Sélection multiple, légende, ajout d\'une maison', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  await p.keyboard.press('s');
  const a = await pt(p, 'bdt/104'), z = await pt(p, 'bdt/111');
  await p.mouse.move(Math.min(a.x, z.x) - 20, Math.min(a.y, z.y) - 20); await p.mouse.down();
  await p.mouse.move(Math.max(a.x, z.x) + 20, Math.max(a.y, z.y) + 20, { steps: 8 }); await p.mouse.up();
  ok(/8 maisons/.test(await p.locator('#contexte .titre').innerText()), 'rectangle : 8 maisons sélectionnées');
  await p.click('#contexte .choix-statut[data-statut=prospectus]');
  ok(await p.evaluate(() => Object.keys(Statuts._records()).length) === 8, 'statut appliqué aux 8 maisons');
  await p.click('#contexte [data-forme=lasso]');
  const l = [await pt(p, 'bdt/100'), await pt(p, 'bdt/103'), await pt(p, 'bdt/107'), await pt(p, 'bdt/104')];
  await p.mouse.move(l[0].x - 20, l[0].y + 20); await p.mouse.down();
  for (const [x, y] of [[l[1].x + 20, l[1].y + 20], [l[2].x + 20, l[2].y - 20], [l[3].x - 20, l[3].y - 20], [l[0].x - 20, l[0].y + 18]]) await p.mouse.move(x, y, { steps: 6 });
  await p.mouse.up();
  ok(/8 maisons/.test(await p.locator('#contexte .titre').innerText()), 'lasso : 8 maisons sélectionnées');
  await p.keyboard.press('2');
  ok(await p.evaluate(() => Statuts.statutDe('bdt/100')) === 'contact', 'touche 2 : statut appliqué à la sélection');
  await p.keyboard.press('v');
  ok(/Contact\s*8/.test((await p.locator('#legende').innerText()).replace(/\n/g, ' ')), 'légende à jour (8 contacts)');
  await p.click('.ligne-legende[data-statut=contact]');
  ok(await p.locator('.ligne-legende[data-statut=contact][aria-pressed=false]').count() === 1, 'légende : statut masqué d\'un clic');
  await p.click('.ligne-legende[data-statut=contact]');
  await p.keyboard.press('a');
  await p.mouse.click(300, 300);
  await p.waitForSelector('#panneau.ouverte');
  ok(await p.evaluate(() => Object.keys(Statuts.manuels()).length) === 1, 'maison ajoutée à la main, fiche ouverte');
  await p.click('#fiche-supprimer'); await p.waitForSelector('#dlg-confirmer[open]'); await p.click('#confirmer-oui');
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => Object.keys(Statuts.manuels()).length) === 0, 'suppression confirmée dans une fenêtre dédiée');
  await p.ctx.close();
});

rubrique('Secteurs', async (env) => {
  const els = grille(4, 5, 300, ['Rue des Lilas', 'Rue du Parc']).concat(grille(1, 4, 400, null, 0.03));
  const p = await page(env, { batiments: els });
  await vue(p, lat0 + 0.00055, lon0 + 0.0006, 17);
  await p.click('.rail [data-nav=secteurs]');
  await p.click('#secteurs-nouveau');
  await p.waitForTimeout(500);   // fin de la fermeture du panneau (la légende reprend sa place)
  ok(await p.locator('#sect-terminer').isDisabled(), 'tracé : « Terminer » inactif sous 3 points');
  const coins = [[lat0 - 0.0001, lon0 - 0.0002], [lat0 - 0.0001, lon0 + 0.0014], [lat0 + 0.0009, lon0 + 0.0014], [lat0 + 0.0009, lon0 - 0.0002]];
  for (const [a, o] of coins) { const c = await p.evaluate(([a, o]) => { const r = CarteImmo.getMap().getContainer().getBoundingClientRect(); const m = CarteImmo.getMap().latLngToContainerPoint([a, o]); return { x: m.x + r.left, y: m.y + r.top }; }, [a, o]); await p.mouse.click(c.x, c.y); }
  await p.click('#sect-terminer');
  await p.waitForSelector('.cs-nom-saisie');
  await p.fill('.cs-nom-saisie', 'Les Lilas'); await p.keyboard.press('Enter');
  ok(await p.locator('.cs-nom').innerText() === 'Les Lilas', 'secteur créé et nommé');
  await p.click('#secteurs-liste [data-action=charger]');
  await p.waitForFunction(() => Secteurs.stats(Secteurs.liste()[0].id).total === 20, null, { timeout: 8000 });
  await p.evaluate(() => Statuts.modifier(['bdt/300', 'bdt/301', 'bdt/302', 'bdt/303', 'bdt/304'], { statut: 'prospectus' }));
  await p.waitForFunction(() => /25%/.test(document.querySelector('.carte-secteur .anneau .centre').textContent));
  ok(true, 'avancement : 25 % (5 maisons sur 20)');
  ok(/Les Lilas · 25 %/.test(await p.locator('.secteur-etiquette span').innerText()), 'étiquette sur la carte');
  await p.click('[data-action=trous]');
  ok(await p.evaluate(() => Secteurs.nonFaits(Secteurs.trousActifs()).length) === 15, '« À faire » : 15 maisons mises en évidence');
  await p.click('[data-action=suivant]');
  await p.waitForSelector('#panneau.ouverte');
  const premiere = await p.evaluate(() => Panneau.idCourant());
  await p.click('#fiche-suivante');
  ok(await p.evaluate(() => Panneau.idCourant()) !== premiere, '« Maison suivante à faire » depuis la fiche');
  await p.keyboard.press('Escape');
  // grand secteur : une seule tâche, bâtiments filtrés par le contour du secteur (pas de découpage)
  await p.waitForFunction(() => !Telechargements.enCours());
  const avant = p.appels.wfs;
  await p.evaluate(([a, o]) => { window.__g = Secteurs.creer([[a - 0.0005, o - 0.001], [a - 0.0005, o + 0.035], [a + 0.002, o + 0.035], [a + 0.002, o - 0.001]]).id; }, [lat0, lon0]);
  await p.evaluate(() => Secteurs.chargerBatiments(window.__g));
  const nGrand = await p.evaluate(() => Secteurs.stats(window.__g).total);
  ok(p.appels.wfs - avant === 3 && nGrand === 24, 'grand secteur : 3 requêtes (bâtiments, adresses, liens), 24 maisons (' + (p.appels.wfs - avant) + ' requêtes, ' + nGrand + ')');
  await p.waitForTimeout(800);
  await recharger(p);
  ok(await p.evaluate(() => Secteurs.liste().map(s => s.nom)[0]) === 'Les Lilas' && await p.evaluate(() => Secteurs.stats(Secteurs.liste()[0].id).faits) === 5, 'secteurs restaurés au rechargement');
  await tiroir(p, 'secteurs');
  const n = await p.locator('.carte-secteur').count();
  await p.locator('.carte-secteur').first().locator('[data-action=supprimer]').click();
  await p.click('#confirmer-oui'); await p.waitForTimeout(200);
  ok(await p.locator('.carte-secteur').count() === n - 1, 'suppression après confirmation');
  await p.ctx.close();
});

rubrique('Rappels', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  await p.evaluate(() => {
    const d = n => Stats.jourDe(new Date(Date.now() - n * 86400000)) + 'T10:00';
    Statuts.modifier(['bdt/100'], { statut: 'rappeler', date: d(10), nom: 'M. Martin', tel: '06 11 22 33 44' });
    Statuts.modifier(['bdt/101'], { statut: 'rappeler', date: d(2), nom: 'Mme Petit' });
  });
  await p.waitForTimeout(200);
  ok(await p.locator('#badge-rappels').innerText() === '2', 'badge « 2 » sur Rappels');
  await tiroir(p, 'rappels');
  const noms = await p.locator('.carte-rappel strong').allInnerTexts();
  ok(noms.join() === 'M. Martin,Mme Petit', 'du plus ancien au plus récent (' + noms.join() + ')');
  ok(/Il y a 10 jours/.test(await p.locator('.carte-rappel .cr-meta').first().innerText()) && await p.locator('.carte-rappel .cr-meta.retard').count() === 1, 'ancienneté affichée, retard signalé (> 7 jours)');
  ok(await p.locator('.carte-rappel a[href="tel:0611223344"]').count() === 1, 'appel direct');
  await p.locator('.carte-rappel').first().locator('[data-action=contacte]').click();
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => Statuts.statutDe('bdt/100')) === 'contact' && await p.locator('#badge-rappels').innerText() === '1', '« Contacté » : retiré de la liste');
  await p.locator('#notifications .notif .action').last().click();
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => Statuts.statutDe('bdt/100')) === 'rappeler', '« Annuler » le remet');
  await p.locator('.carte-rappel').first().locator('[data-action=voir]').click();
  await p.waitForSelector('#panneau.ouverte');
  ok(await p.evaluate(() => Panneau.idCourant()) === 'bdt/100', '« Fiche » ouvre la maison sur la carte');
  await p.ctx.close();
});

rubrique('Sauvegarde, export, import', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  await p.evaluate(() => {
    Statuts.modifier(['bdt/100'], { statut: 'contact', nom: 'Mme Durand', tel: '+33 6 12 34 56 78', note: '=1+1 ; "citation"' });
    Statuts.modifier(['bdt/101'], { statut: 'prospectus' });
    Secteurs.creer([[47.2182, -1.554], [47.2182, -1.552], [47.219, -1.552]]);
    CarteImmo.setFond('photo');
  });
  await p.waitForTimeout(1500);
  await recharger(p);
  ok(await p.evaluate(() => Statuts.get('bdt/100').nom) === 'Mme Durand' && await p.evaluate(() => CarteImmo.total()) === 12 && await p.evaluate(() => CarteImmo.fond()) === 'photo', 'tout est restauré au rechargement (fiches, maisons, fond de carte)');
  await tiroir(p, 'donnees');
  ok(/2/.test(await p.locator('#chiffres-donnees div').first().innerText()), 'panneau Données : 2 maisons renseignées');
  let [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-export-json')]);
  const fj = path.join(TMP, 'export.json'); await dl.saveAs(fj);
  const ex = JSON.parse(fs.readFileSync(fj, 'utf8'));
  ok(ex.schema === 6 && ex.tournees && Array.isArray(ex.tournees.liste) && Array.isArray(ex.etiquettes) && ex.records['bdt/100'].tel === '+33 6 12 34 56 78' && ex.records['bdt/100'].historique.length === 1 && ex.secteurs.secteurs.length === 1, 'export JSON (schéma 6 : contact, historique, étiquettes, secteurs, tournées)');
  [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btn-export-csv')]);
  const fc = path.join(TMP, 'export.csv'); await dl.saveAs(fc);
  const csv = fs.readFileSync(fc, 'utf8'), lignes = csv.split('\r\n');
  ok(csv.charCodeAt(0) === 0xFEFF && lignes[0].includes('nom;telephone') && lignes.some(l => l.includes("\"'=1+1 ;")) && /;-1\.55/.test(csv), 'CSV : BOM, colonnes nom/téléphone, formule neutralisée, nombres intacts');
  // import dans un navigateur vierge
  const q = await page(env);
  await q.click('.rail [data-nav=donnees]');
  await q.setInputFiles('#fichier-import', fj);
  await q.waitForSelector('#dlg-import[open]');
  await q.click('#import-fusionner'); await q.waitForTimeout(500);
  ok(await q.evaluate(() => Statuts.get('bdt/100').nom) === 'Mme Durand' && await q.evaluate(() => Secteurs.liste().length) === 1 && await q.evaluate(() => CarteImmo.total()) === 2, 'import (fusion) dans un navigateur vierge');
  // remplacer avec copie de sécurité
  fs.writeFileSync(path.join(TMP, 'r.json'), JSON.stringify({ app: 'SecteurImmo', schema: 1, records: { 'bdt/9': { statut: 'refus' } } }));
  await q.setInputFiles('#fichier-import', path.join(TMP, 'r.json'));
  await q.waitForSelector('#dlg-import[open]');
  const [sauv] = await Promise.all([q.waitForEvent('download'), q.click('#import-remplacer')]);
  await q.waitForTimeout(400);
  ok(/secteurimmo-.*\.json/.test(sauv.suggestedFilename()) && await q.evaluate(() => Object.keys(Statuts._records()).join()) === 'bdt/9', 'remplacer : copie de sécurité téléchargée, ancien schéma 1 accepté');
  for (const [nom, contenu, attendu] of [['a.json', 'pas du json', /JSON valide/], ['b.json', '{"app":"Autre","schema":1}', /pas une sauvegarde/], ['c.json', '{"app":"SecteurImmo","schema":99}', /plus récente/]]) {
    fs.writeFileSync(path.join(TMP, nom), contenu);
    await q.setInputFiles('#fichier-import', path.join(TMP, nom)); await q.waitForTimeout(250);
    ok(attendu.test(await notif(q)), 'fichier refusé : ' + nom);
  }
  await q.click('#btn-effacer'); await q.click('#confirmer-oui');
  await q.waitForFunction(() => document.documentElement.classList.contains('pret') && Object.keys(Statuts._records()).length === 0);
  ok(true, 'effacer toutes les données (après confirmation)');
  // rappel de sauvegarde
  await p.evaluate(() => { Store.setMeta('depuis', Date.now() - 9 * 86400000); Store.setMeta('dernierExport', Date.now() - 9 * 86400000); return Store.flush(); });
  await recharger(p);
  ok(await p.locator('#point-donnees').isVisible() && /sauvegarde/.test(await notif(p)), 'rappel : aucune sauvegarde depuis 9 jours (pastille + notification)');
  await p.ctx.close(); await q.ctx.close();
});

rubrique('Bilan (tableau de bord)', async (env) => {
  const p = await page(env, { batiments: grille(3, 4, 500, ['Rue des Lilas', 'Rue du Parc', null]) });
  await chargerZone(p);
  await p.evaluate(() => {
    const d = (n, h) => Stats.jourDe(new Date(Date.now() - n * 86400000)) + 'T' + (h || '10') + ':00';
    const M = (id, p) => Statuts.modifier([id], p);
    M('bdt/500', { statut: 'contact', date: d(1) });
    M('bdt/501', { statut: 'contact', date: d(2), note: 'Intéressé par estimation' });
    M('bdt/502', { statut: 'prospectus', date: d(1) });
    M('bdt/503', { statut: 'prospectus', date: d(3) });
    M('bdt/504', { statut: 'rappeler', date: d(5), nom: 'Mme Petit', potentiel: 'tiede', projet: 'succession' });
    M('bdt/506', { statut: 'absent', date: d(10) });
    M('bdt/507', { statut: 'refus', date: d(40) });
    M('bdt/508', { statut: 'rappeler', date: d(20), note: 'Estimation succession' });
    M('bdt/509', { statut: 'contact', date: d(30, 18) }); M('bdt/509', { statut: 'estimation', date: d(4), nom: 'M. Martin', potentiel: 'chaud', projet: 'vente', echeance: '3m', etiquettes: ['e-a-vendre'] });
    M('bdt/510', { statut: 'contact', date: d(50, 18) }); M('bdt/510', { statut: 'estimation', date: d(45) }); M('bdt/510', { statut: 'mandat', date: d(6) });
    M('bdt/511', { statut: 'contact', date: d(25, 18) }); M('bdt/511', { statut: 'concurrent', date: d(12) });
  });
  const avant = await p.evaluate(() => JSON.stringify(Statuts._records()));
  await p.click('.rail [data-nav=tableau]');
  await p.waitForSelector('.kpi');
  const kpis = async () => (await p.locator('.kpi .kpi-valeur').allInnerTexts());
  await p.click('.segments [data-periode="0"]');
  ok((await kpis()).join('|') === '11|54,5 %|2|1', 'indicateurs (tout) : 11 faites, 54,5 % de contact, 2 estimations, 1 mandat (' + (await kpis()).join('|') + ')');
  const etapes = await p.locator('.entonnoir .etape strong').allInnerTexts();
  ok(etapes.join('|') === '11|7|2|1', 'entonnoir : 11 portes → 7 contacts → 2 estimations → 1 mandat (historique pris en compte)');
  ok(/1 perdu face à la concurrence/.test(await p.locator('.bloc:has-text("Entonnoir")').innerText()), 'entonnoir : mandats perdus face à la concurrence');
  await p.click('.segments [data-periode="7"]');
  ok((await kpis()).join('|') === '7|71,4 %|2|1', 'filtre 7 jours : 7 faites, 71,4 % (' + (await kpis()).join('|') + ')');
  ok(await p.locator('.kpi .ecart').count() >= 2, 'comparaison avec la période précédente');
  await p.click('.segments [data-periode="0"]');
  ok(await p.locator('.graphique .segment').count() === 11, 'activité : un segment par statut et par jour');
  await p.locator('.graphique .zone').nth(await p.locator('.graphique .zone').count() - 2).hover();
  ok(await p.locator('#info-graphique').isVisible(), 'infobulle au survol du graphique');
  ok((await p.locator('.liste-repartition li').allInnerTexts()).length === 9, 'répartition (anneau + liste des 9 statuts)');
  ok(await p.locator('.carte-chaleur tbody tr').count() === 7 && /Soir/.test(await p.locator('.carte-chaleur thead').innerText()), 'meilleurs créneaux : grille jours × moments');
  const prospects = await p.locator('.liste-prospects:not(.compacte) .lien-ligne').allInnerTexts();
  ok(prospects.join() === 'M. Martin,Mme Petit', 'prospects à travailler : chaud avant tiède (' + prospects.join() + ')');
  ok(/2\s*à rappeler/.test((await p.locator('.bloc:has-text("Rappels")').innerText()).replace(/\n/g, ' ')), 'rappels : nombre et plus anciens');
  ok(/Vente/.test(await p.locator('.bloc:has-text("Projets")').innerText()) && /Succession/.test(await p.locator('.bloc:has-text("Projets")').innerText()), 'projets et échéances');
  ok(/Maison à vendre/.test(await p.locator('.bloc:has-text("Étiquettes")').innerText()), 'étiquettes posées');
  ok(/Rue du Parc/.test(await p.locator('.bloc:has-text("Rues à terminer")').innerText()) && !/Rue des Lilas/.test(await p.locator('.bloc:has-text("Rues à terminer")').innerText()), 'rues à terminer (rue terminée exclue)');
  const deborde = async () => p.evaluate(() => [...document.querySelectorAll('#tableau .bloc')].reduce((n, b) => {
    const d = b.getBoundingClientRect().right;
    return n + [...b.querySelectorAll('.jauge, .haut span, .haut strong, .kpi-valeur, .etape, .carte-chaleur')].filter(e => e.getBoundingClientRect().right > d + 0.5).length;
  }, 0));
  await p.evaluate(() => { const f = DataImmo.batiment('bdt/505'); f.properties['addr:street'] = 'Place Roger Salengro (Oullins) 69600 Oullins-Pierre-Bénite et environs'; StatsUi.ouvrir(); });
  await p.waitForTimeout(200);
  const nDeb = await deborde(), txtRues = await p.locator('.bloc:has-text("Rues à terminer")').innerText();
  ok(nDeb === 0 && /Place Roger Salengro \(Oullins\)\s/.test(await p.locator('.bloc:has-text("Rues à terminer")').innerText()) && !/69600/.test(await p.locator('.bloc:has-text("Rues à terminer")').innerText()), 'nom de rue très long : tronqué, code postal retiré, rien ne déborde des cartes' + (nDeb ? ' (' + nDeb + ' débordement(s))' : '') + (/Salengro/.test(txtRues) ? '' : ' [' + txtRues.replace(/\n/g, ' / ') + ']'));
  // objectif
  await p.click('#objectif-modifier'); await p.fill('#objectif-saisie', '20'); await p.keyboard.press('Enter');
  ok(/sur 20/.test(await p.locator('.objectif').innerText()), 'objectif de la semaine modifiable');
  // journal
  await p.fill('#journal-recherche', 'estimation');
  ok(await p.locator('.tableau.liste tbody tr').count() === 2, 'journal : recherche dans les notes');
  await p.fill('#journal-recherche', '');
  await p.selectOption('#journal-qualif', 'potentiel:chaud');
  ok(await p.locator('.tableau.liste tbody tr').count() === 1, 'journal : filtre par potentiel');
  await p.selectOption('#journal-qualif', 'etiquettes:e-a-vendre');
  ok(await p.locator('.tableau.liste tbody tr').count() === 1, 'journal : filtre par étiquette');
  await p.selectOption('#journal-qualif', ''); await p.selectOption('#journal-statut', 'contact');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#stats-export')]);
  const f = path.join(TMP, 'sel.csv'); await dl.saveAs(f);
  ok(fs.readFileSync(f, 'utf8').trim().split('\r\n').length === 3, 'journal : export CSV de la sélection (2 contacts)');
  await p.locator('.tableau.liste .lien-ligne').first().click();
  await p.waitForSelector('#panneau.ouverte');
  ok(await p.locator('#tableau').isHidden(), 'clic sur une ligne : retour à la carte, fiche ouverte');
  // démonstration
  await p.click('.rail [data-nav=tableau]');
  await p.click('label:has(#stats-demo)');
  ok(await p.locator('#stats-demo-bandeau').isVisible() && Number((await kpis())[0].replace(/\s/g, '')) > 20, 'données d\'exemple affichées');
  ok(await p.locator('.carte-chaleur td').count() === 28 && await p.locator('.conseil').count() === 1, 'exemple : créneaux et conseil « meilleur créneau »');
  ok(await p.evaluate(() => JSON.stringify(Statuts._records())) === avant, 'vos vraies données ne sont pas modifiées');
  await p.waitForTimeout(500);
  await recharger(p);
  await p.click('.rail [data-nav=tableau]');
  ok(/sur 20/.test(await p.locator('.objectif').innerText()), 'objectif conservé au rechargement');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Étiquettes personnalisables', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  await clicMaison(p, 'bdt/100'); await p.waitForSelector('#panneau.ouverte');
  ok(await p.locator('#panneau .puce[data-etiquette]').count() === 6, '6 étiquettes proposées au départ');
  await p.click('#panneau .puce[data-etiquette="e-chien"]');
  ok(JSON.stringify(await p.evaluate(() => Statuts.get('bdt/100').etiquettes)) === '["e-chien"]', 'une étiquette posée d\'un geste');
  await p.click('#etiquette-nouvelle'); await p.keyboard.type('Jardin à l\'abandon'); await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  const e = await p.evaluate(() => Etiquettes.liste().filter(x => x.nom === "Jardin à l'abandon")[0]);
  ok(!!e && (await p.evaluate(() => Statuts.get('bdt/100').etiquettes)).includes(e.id), 'création d\'une étiquette depuis la fiche (posée aussitôt)');
  // gestion : renommer, supprimer
  await p.click('#etiquettes-gerer'); await p.waitForSelector('#dlg-etiquettes[open]');
  const champ = p.locator('#dlg-etiquettes li[data-etiquette="' + e.id + '"] input');
  await champ.fill('Jardin négligé'); await champ.press('Tab');
  ok(await p.evaluate((id) => Etiquettes.nom(id), e.id) === 'Jardin négligé', 'renommer une étiquette');
  await p.locator('#dlg-etiquettes li[data-etiquette="e-chien"] [data-action=supprimer]').click();
  await p.click('#confirmer-oui'); await p.waitForTimeout(200);
  ok(!(await p.evaluate(() => Etiquettes.parId('e-chien'))) && !(await p.evaluate(() => Statuts.get('bdt/100').etiquettes)).includes('e-chien'), 'supprimer une étiquette la retire des maisons');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  // sélection multiple : ajout d'une étiquette à plusieurs maisons
  await p.keyboard.press('s');
  const a = await pt(p, 'bdt/104'), z = await pt(p, 'bdt/111');
  await p.mouse.move(Math.min(a.x, z.x) - 20, Math.min(a.y, z.y) - 20); await p.mouse.down();
  await p.mouse.move(Math.max(a.x, z.x) + 20, Math.max(a.y, z.y) + 20, { steps: 8 }); await p.mouse.up();
  await p.selectOption('#selection-etiquette', 'e-travaux');
  ok(await p.evaluate(() => Object.values(Statuts._records()).filter(r => (r.etiquettes || []).includes('e-travaux')).length) === 8, 'sélection : étiquette ajoutée à 8 maisons');
  await p.keyboard.press('Control+z');
  ok(await p.evaluate(() => Object.values(Statuts._records()).filter(r => (r.etiquettes || []).includes('e-travaux')).length) === 0, 'une seule annulation suffit');
  await p.keyboard.press('Control+y').catch(() => {});
  await p.keyboard.press('Escape');
  // filtre de la carte
  await p.selectOption('#filtre-carte', 'etiquette:' + e.id);
  const visibles = await p.evaluate(() => Object.keys(DataImmo._batiments()).filter(id => CarteImmo.getMap().hasLayer && document).length);
  ok(await p.locator('.legende.filtre-actif').count() === 1, 'légende : filtre par étiquette actif');
  ok(await p.evaluate(() => CarteImmo.idsDans(CarteImmo.getMap().getBounds()).join()) === 'bdt/100', 'carte : seule la maison portant l\'étiquette reste affichée');
  await p.selectOption('#filtre-carte', '');
  ok(await p.evaluate(() => CarteImmo.idsDans(CarteImmo.getMap().getBounds()).length) === 12, 'filtre retiré : toutes les maisons');
  await p.waitForTimeout(800);
  await recharger(p);
  ok(await p.evaluate((id) => Etiquettes.nom(id), e.id) === 'Jardin négligé' && !(await p.evaluate(() => Etiquettes.parId('e-chien'))), 'étiquettes conservées au rechargement');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Statuts commerciaux et qualification', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  await clicMaison(p, 'bdt/100'); await p.waitForSelector('#panneau.ouverte');
  ok(await p.locator('#panneau .choix-statut').count() === 9, 'fiche : 9 statuts (dont estimation, mandat, concurrent)');
  await p.keyboard.press('2'); await p.keyboard.press('6'); await p.keyboard.press('7');
  ok(await p.evaluate(() => Statuts.get('bdt/100').historique.map(h => h.statut).join()) === 'contact,estimation,mandat', 'touches 2, 6, 7 : contact → estimation → mandat (historique)');
  await p.click('#panneau .puce[data-champ=potentiel][data-valeur=chaud]');
  await p.click('#panneau .puce[data-champ=projet][data-valeur=vente]');
  await p.click('#panneau .puce[data-champ=echeance][data-valeur="3m"]');
  await p.click('#panneau .puce[data-champ=occupant][data-valeur=proprietaire]');
  const r = await p.evaluate(() => Statuts.get('bdt/100'));
  ok(r.potentiel === 'chaud' && r.projet === 'vente' && r.echeance === '3m' && r.occupant === 'proprietaire', 'qualification : potentiel, projet, échéance, occupant');
  ok(/Potentiel chaud/.test(await p.locator('#panneau .fiche-chips').innerText()), 'potentiel affiché en tête de fiche');
  await p.click('#panneau .puce[data-champ=occupant][data-valeur=proprietaire]');
  ok(await p.evaluate(() => Statuts.get('bdt/100').occupant) === undefined, 'un second clic efface la valeur');
  await p.keyboard.press('Escape');
  await p.evaluate(() => Statuts.modifier(['bdt/101'], { statut: 'rappeler', potentiel: 'tiede', projet: 'achat' }));
  await p.selectOption('#filtre-carte', 'potentiel:chaud');
  ok(await p.evaluate(() => CarteImmo.idsDans(CarteImmo.getMap().getBounds()).join()) === 'bdt/100', 'carte : filtre « potentiel chaud »');
  await p.selectOption('#filtre-carte', 'projet:achat');
  ok(await p.evaluate(() => CarteImmo.idsDans(CarteImmo.getMap().getBounds()).join()) === 'bdt/101', 'carte : filtre par projet');
  await p.selectOption('#filtre-carte', '');
  await tiroir(p, 'rappels');
  ok(/Tiède/.test(await p.locator('.carte-rappel').first().innerText()) && /Achat/.test(await p.locator('.carte-rappel').first().innerText()), 'rappels : potentiel et projet affichés');
  await p.click('#tiroir-fermer');
  // recherche (palette) par qualification
  await p.keyboard.press('Control+k'); await p.keyboard.type('potentiel chaud'); await p.waitForTimeout(200);
  ok(await p.locator('.palette-groupe:has-text("Maisons")').count() === 1, 'recherche : maisons trouvées par leur qualification');
  await p.keyboard.press('Escape');
  // export / import
  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => Echange.exporterCsv())]);
  const f = path.join(TMP, 'q.csv'); await dl.saveAs(f);
  const lignes = fs.readFileSync(f, 'utf8').split('\r\n');
  ok(lignes[0].includes('potentiel;projet;echeance;occupant;etiquettes') && lignes.some(l => /Mandat signé;.*;Chaud;Vente;Moins de 3 mois/.test(l)), 'CSV : statut commercial et qualification');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Stockage persistant', async (env) => {
  // Simulation de l'API : non protégé au départ, protection accordée à la demande
  const ctx = await env.b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    window.__demandes = 0; let persiste = false;
    navigator.storage.persisted = () => Promise.resolve(persiste);
    navigator.storage.persist = () => { window.__demandes++; persiste = true; return Promise.resolve(true); };
  });
  const p = await page(env, { ctx });
  ok(await p.evaluate(() => window.__demandes) === 0, 'pas de demande tant qu\'il n\'y a rien à protéger');
  await chargerZone(p);
  await p.evaluate(() => Statuts.modifier(['bdt/100'], { statut: 'contact' }));
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.__demandes) === 1, 'protection demandée automatiquement à la première maison renseignée');
  await tiroir(p, 'donnees');
  await p.waitForTimeout(200);
  ok(/Stockage protégé/.test(await p.locator('#etat-stockage').innerText()) && await p.locator('#btn-proteger').isHidden(), 'panneau Données : « Stockage protégé »');
  await p.ctx.close();
  const ctx2 = await env.b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx2.addInitScript(() => { navigator.storage.persisted = () => Promise.resolve(false); navigator.storage.persist = () => Promise.resolve(false); });
  const q = await page(env, { ctx: ctx2 });
  await tiroir(q, 'donnees'); await q.waitForTimeout(200);
  ok(/non protégé/.test(await q.locator('#etat-stockage').innerText()) && await q.locator('#btn-proteger').isVisible(), 'non protégé : explication et bouton « Protéger »');
  await q.click('#btn-proteger'); await q.waitForTimeout(200);
  ok(/refusé/.test(await notif(q)), 'refus du navigateur expliqué');
  await q.ctx.close();
});

rubrique('Thème, téléphone, hors ligne, position', async (env) => {
  const p = await page(env);
  const themes = [];
  for (let i = 0; i < 3; i++) { await p.click('#btn-theme'); themes.push(await p.evaluate(() => document.documentElement.dataset.theme)); }
  ok(themes.includes('sombre') && themes.includes('clair'), 'thème : bascule clair / sombre / auto');
  await p.evaluate(() => { while (Theme.libelle() !== 'Sombre') Theme.basculer(); });
  await recharger(p);
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'sombre', 'thème conservé au rechargement');
  await p.ctx.close();

  // Téléphone
  const m = await page(env, { contexte: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
  ok(await m.locator('.rail').evaluate(e => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().top > 700), 'barre d\'onglets en bas de l\'écran');
  await chargerZone(m);
  const c = await pt(m, 'bdt/103');
  await m.touchscreen.tap(c.x + 22, c.y);   // un peu à côté : zone d'appui élargie
  await m.waitForSelector('#panneau.ouverte');
  ok(true, 'appui à côté d\'une maison : la fiche s\'ouvre (zone élargie au doigt)');
  const poignee = await m.locator('#panneau .poignee').boundingBox();
  await m.mouse.move(poignee.x + poignee.width / 2, poignee.y + 10); await m.mouse.down();
  await m.mouse.move(poignee.x + poignee.width / 2, poignee.y + 260, { steps: 6 }); await m.mouse.up();
  await m.waitForTimeout(400);
  ok(await m.locator('#panneau.ouverte').count() === 0, 'feuille fermée en la tirant vers le bas');
  await m.click('#btn-plus'); await m.click('#menu-plus [data-nav=donnees]');
  await T.tiroirAffiche(m);
  ok(await m.locator('#tiroir.ouvert [data-section=donnees]').isVisible(), 'menu « Plus » → Données');
  await m.click('#voile', { position: { x: 200, y: 40 } });
  ok(await m.locator('#tiroir.ouvert').count() === 0, 'toucher le voile ferme la feuille');
  await m.click('#btn-plus'); await m.click('#menu-plus [data-nav=tableau]'); await m.click('label:has(#stats-demo)'); await m.waitForTimeout(500);
  ok(await m.evaluate(() => document.getElementById('tableau').scrollWidth - document.getElementById('tableau').clientWidth) === 0, 'bilan sur téléphone : aucun débordement horizontal');
  await m.click('.rail [data-nav=carte]');
  ok(!m.erreurs.length, 'aucune erreur JavaScript sur téléphone');
  await m.ctx.close();

  // Hors ligne (service worker)
  const h = await page(env);
  await h.evaluate(() => navigator.serviceWorker.ready);
  await chargerZone(h);
  await h.evaluate(() => Statuts.modifier(['bdt/100'], { statut: 'contact' }));
  await h.waitForTimeout(1200);
  await h.ctx.setOffline(true);
  await h.waitForTimeout(200);
  ok(/Hors ligne/.test(await notif(h)), 'perte de réseau signalée');
  await recharger(h);
  ok(await h.evaluate(() => Statuts.statutDe('bdt/100')) === 'contact' && await h.evaluate(() => CarteImmo.total()) === 12, 'hors ligne : l\'application redémarre avec vos données');
  await h.evaluate(() => CarteImmo.getMap().setView([47.3, -1.5], 19, { animate: false }));
  await h.waitForTimeout(200); await h.click('#pastille-charger');
  ok(/hors ligne/i.test(await notif(h)), 'hors ligne : chargement refusé avec un message clair');
  const urls = await h.evaluate(async () => { const c = await caches.open((await caches.keys())[0]); return (await c.keys()).map(r => r.url); });
  ok(urls.length > 30 && urls.every(u => u.startsWith(env.url)), 'cache : uniquement les fichiers de l\'application (' + urls.length + '), aucune tuile');
  await h.ctx.setOffline(false); await h.ctx.close();

  // Position
  const g = await page(env, { contexte: { permissions: ['geolocation'], geolocation: { latitude: lat0 + 0.0001, longitude: lon0 + 0.0001, accuracy: 15 } } });
  await g.click('#btn-position');
  await g.waitForFunction(() => Position.courante() !== null);
  ok(await g.locator('#btn-position').getAttribute('aria-pressed') === 'true', 'ma position : suivi actif');
  await g.ctx.setGeolocation({ latitude: lat0 + 0.0001, longitude: lon0 + 0.0021, accuracy: 10 });
  await g.waitForTimeout(800);
  ok(Math.abs(await g.evaluate(() => CarteImmo.getMap().getCenter().lng) - (lon0 + 0.0021)) < 0.0004, 'la carte suit la position');
  await g.click('#btn-position');
  ok(await g.evaluate(() => Position.courante()) === null, 'deuxième clic : arrêt du suivi');
  await g.ctx.close();
});

rubrique('Tournées', async (env) => {
  const p = await page(env, { contexte: { permissions: ['geolocation'], geolocation: { latitude: lat0, longitude: lon0, accuracy: 10 } } });
  await chargerZone(p);
  await p.click('#btn-tournee'); await p.waitForSelector('#dlg-tournee[open]');
  await p.fill('#tournee-objectif', '10');
  await p.click('#tournee-demarrer');
  ok(await p.locator('#tournee-pilule').isVisible() && await p.locator('[data-mode=tournee][aria-pressed=true]').count() === 1, 'tournée démarrée : chrono affiché, pointage rapide activé');
  ok(await p.evaluate(() => Position.active()), 'ma position activée pour mesurer la distance');
  // premier point GPS : la carte se recentre sur la position, puis on pointe les maisons
  await p.waitForFunction(() => Tournees.active().trace.length > 0); await p.waitForTimeout(300);
  for (const id of ['bdt/100', 'bdt/101', 'bdt/102', 'bdt/103']) await clicMaison(p, id);
  await p.keyboard.press('2'); await clicMaison(p, 'bdt/104');
  await p.waitForTimeout(300);
  ok(await p.locator('.tp-portes').innerText() === '5' && await p.locator('.tp-contacts').innerText() === '1', 'pilule : 5 portes, 1 contact');
  await p.keyboard.press('Control+z');
  ok(await p.evaluate(() => Tournees.stats(Tournees.active()).portes) === 4, 'annuler retire le passage de la tournée');
  await clicMaison(p, 'bdt/104');
  // distance : deux déplacements d'environ 55 m
  await p.ctx.setGeolocation({ latitude: lat0 + 0.0005, longitude: lon0, accuracy: 10 }); await p.waitForTimeout(500);
  await p.ctx.setGeolocation({ latitude: lat0 + 0.001, longitude: lon0, accuracy: 10 }); await p.waitForTimeout(500);
  const dist = await p.evaluate(() => Tournees.active().distance);
  ok(dist > 90 && dist < 130, 'distance parcourue mesurée (' + Math.round(dist) + ' m)');
  await p.click('#tournee-pilule .tp-pause');
  ok(await p.evaluate(() => Tournees.enPause()) && await p.locator('#tournee-pilule.en-pause').count() === 1, 'pause');
  await vue(p, lat0 + 0.00025, lon0 + 0.0004, 19);   // la carte a suivi la position vers le nord : on revient sur les maisons
  await clicMaison(p, 'bdt/105');
  ok(!(await p.evaluate(() => Tournees.enPause())), 'pointer une maison relance la tournée');
  // persistance pendant la tournée
  await p.waitForTimeout(500); await recharger(p);
  ok(await p.locator('#tournee-pilule').isVisible() && await p.evaluate(() => Tournees.stats(Tournees.active()).portes) === 6, 'tournée en cours conservée au rechargement');
  await p.click('#tournee-pilule .tp-fin');
  await p.waitForSelector('#dlg-bilan-tournee[open]');
  const bilanTxt = (await p.locator('#dlg-bilan-tournee').innerText()).replace(/\n/g, ' ');
  ok(/6\s*portes/.test(bilanTxt) && /60 %\s*de l'objectif/.test(bilanTxt) && /XP/.test(bilanTxt), 'bilan de fin : portes, objectif, expérience');
  ok(/record/i.test(bilanTxt) && /Portes en une tournée/.test(bilanTxt), 'premier record signalé');
  await p.click('#bilan-tournee-fermer');
  ok(await p.locator('#tournee-pilule').isHidden() && await p.evaluate(() => Tournees.liste().length) === 1, 'tournée enregistrée, pilule masquée');
  await p.click('.rail [data-nav=tournees]'); await p.waitForSelector('#vue-tournees .liste tbody tr');
  ok(await p.locator('#vue-tournees .liste tbody tr').count() === 1, 'historique des tournées');
  await p.locator('#vue-tournees .liste .lien-ligne').first().click(); await p.waitForSelector('#dlg-bilan-tournee[open]');
  await p.fill('#tournee-nom', 'Lilas samedi'); await p.locator('#tournee-nom').press('Tab');
  ok(await p.evaluate(() => Tournees.liste()[0].nom) === 'Lilas samedi', 'renommer une tournée');
  await p.click('#dlg-bilan-tournee [data-action=carte]');
  ok(await p.locator('#tableau, #vue-tournees').evaluateAll(e => e.every(x => x.hidden)) && /6 maisons en évidence/.test(await notif(p)), '« Voir sur la carte » : maisons de la tournée en évidence');
  // tournée oubliée
  await p.evaluate(() => { Tournees.demarrer({}); Statuts.modifier(['bdt/107'], { statut: 'prospectus' }); const t = Tournees.active(); t.debut -= 6 * 3600000; t.passages.forEach(x => x.t -= 5 * 3600000); return Store.kvSet('tournees', Tournees.exporter()); });
  await p.waitForTimeout(500); await recharger(p);
  await p.waitForSelector('#dlg-confirmer[open]');
  ok(/restée ouverte/.test(await p.locator('#dlg-confirmer').innerText()), 'tournée oubliée : proposition de la terminer');
  await p.click('#confirmer-oui'); await p.waitForSelector('#dlg-bilan-tournee[open]'); await p.click('#bilan-tournee-fermer');
  ok(await p.evaluate(() => !Tournees.active() && Tournees.liste().length === 2 && Tournees.liste()[1].fin - Tournees.liste()[1].debut < 2 * 3600000), 'terminée à l\'heure de la dernière maison pointée');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Défis, badges, niveaux', async (env) => {
  const p = await page(env, { animations: true, batiments: grille(10, 12, 2000, ['Rue A', 'Rue B']) });
  await vue(p, lat0 + 0.0012, lon0 + 0.0014, 17);
  await p.waitForSelector('#pastille-charger.action'); await p.click('#pastille-charger');
  await p.waitForFunction(() => CarteImmo.total() === 120 && !Telechargements.enCours());
  const e0 = await p.evaluate(() => Defis.etat());
  ok(e0.experience.niveau === 1 && e0.defis.length === 3 && e0.defis[0].cible === 50, 'départ : niveau 1, 3 défis, « Faire 50 portes »');
  await p.evaluate(() => Statuts.modifier(Object.keys(DataImmo._batiments()).slice(0, 49), { statut: 'prospectus' }));
  await p.waitForTimeout(1000);
  await p.evaluate(() => Statuts.modifier(Object.keys(DataImmo._batiments()).slice(49, 50), { statut: 'contact' }));
  await p.waitForFunction(() => [...document.querySelectorAll('.notif .texte')].some(n => /Défi réussi : Faire 50 portes/.test(n.textContent)), null, { timeout: 4000 });
  ok(true, 'défi « 50 portes » réussi : célébration');
  ok(await p.locator('canvas.confettis').count() >= 1, 'confettis');
  await p.evaluate(() => Statuts.modifier(Object.keys(DataImmo._batiments()).slice(50, 100), { statut: 'absent' }));
  await p.waitForFunction(() => [...document.querySelectorAll('.notif .texte')].some(n => /Badge débloqué : Centurion/.test(n.textContent)), null, { timeout: 4000 });
  ok(true, 'badge « Centurion » (100 portes) débloqué');
  const e1 = await p.evaluate(() => Defis.etat());
  ok(e1.records.find(r => r.cle === 'portes_jour').valeur === 100 && e1.experience.xp > e0.experience.xp, 'record « portes en un jour » et expérience en hausse (' + e1.experience.xp + ' XP)');
  await p.waitForTimeout(800);
  await recharger(p);
  await p.waitForTimeout(1200);
  ok(!(await p.locator('.notif .texte').allInnerTexts()).some(t => /Badge|Défi/.test(t)), 'pas de nouvelle célébration au rechargement');
  await p.click('.rail [data-nav=tournees]'); await p.waitForSelector('.grille-badges');
  ok(await p.locator('.badge-jeu.obtenu').count() >= 2 && await p.locator('.liste-defis li.reussi').count() >= 1, 'vue : badges obtenus et défi réussi');
  ok(/Portes en un jour/.test(await p.locator('.grille-records').innerText()), 'vue : records');
  await p.click('label:has(#celebrations)');
  ok(await p.evaluate(() => !Celebration.actives()), 'confettis désactivables');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Base des maisons', async (env) => {
  const p = await page(env, { batiments: grille(3, 4, 100, ['Rue des Lilas', 'Avenue du Parc', null]) });
  await chargerZone(p);
  await p.evaluate(() => {
    Statuts.modifier(['bdt/100'], { statut: 'contact', nom: 'Mme Durand', tel: '06 11 22 33 44', potentiel: 'chaud', projet: 'vente', etiquettes: ['e-chien'] });
    Statuts.modifier(['bdt/101'], { statut: 'prospectus' });
    Statuts.modifier(['bdt/101'], { statut: 'rappeler', potentiel: 'tiede' });
    Statuts.modifier(['bdt/102', 'bdt/103'], { statut: 'prospectus' });
  });
  await p.click('.rail [data-nav=base]'); await p.waitForSelector('.base-corps .base-ligne');
  const lignes = () => p.locator('.base-corps .base-ligne').count();
  ok(await lignes() === 12 && /12 bâtiments/.test(await p.locator('#vue-base .sous-titre').first().innerText()), '12 bâtiments dans la base');
  await p.fill('#base-recherche', 'durand'); await p.waitForTimeout(250);
  ok(await lignes() === 1, 'recherche par nom');
  await p.fill('#base-recherche', ''); await p.waitForTimeout(250);
  await p.click('#base-btn-filtres');
  await p.click('[data-filtre="statut:prospectus"]');
  ok(await lignes() === 2, 'filtre statut : 2 prospectus');
  await p.click('[data-filtre="statut:rappeler"]');
  ok(await lignes() === 3, 'plusieurs statuts');
  await p.click('[data-filtre="potentiel:chaud"]').catch(() => {});
  ok(await lignes() === 0, 'filtres combinés (statut ET potentiel)');
  await p.click('#base-effacer-filtres');
  await p.click('[data-filtre="etiquettes:e-chien"]');
  ok(await lignes() === 1, 'filtre par étiquette');
  await p.click('[data-filtre="etiquettes:e-chien"]');
  await p.click('[data-filtre="jamais"]');
  ok(await lignes() === 8, 'maisons jamais visitées : 8');
  await p.click('[data-filtre="jamais"]');
  await p.click('[data-filtre="avecTel"]');
  ok(await lignes() === 1 && await p.locator('.base-corps a[href="tel:0611223344"]').count() === 1, 'avec un téléphone, lien d\'appel');
  await p.click('[data-filtre="avecTel"]');
  await p.fill('[data-filtre="passagesMin"]', '2'); await p.locator('[data-filtre="passagesMin"]').press('Tab');
  ok(await lignes() === 1, 'au moins 2 passages');
  await p.fill('[data-filtre="passagesMin"]', ''); await p.locator('[data-filtre="passagesMin"]').press('Tab');
  await p.click('#base-btn-filtres');
  // tri
  await p.click('.base-tete .tri[data-col="adresse"]');
  let adr = await p.locator('.base-corps .base-ligne .base-fixe').allInnerTexts();
  ok(adr[0].startsWith('1 Avenue du Parc'), 'tri par adresse (' + adr[0] + ')');
  await p.click('.base-tete .tri[data-col="adresse"]');
  adr = await p.locator('.base-corps .base-ligne .base-fixe').allInnerTexts();
  ok(/Adresse inconnue/.test(adr[adr.length - 1]) && adr[0].startsWith('7 Rue des Lilas'), 'tri inversé, adresses vides en dernier');
  await p.click('.base-tete .tri[data-col="statut"]'); await p.click('.base-tete .tri[data-col="adresse"]', { modifiers: ['Shift'] });
  ok(await p.locator('.base-tete .ordre-tri').count() === 2, 'tri sur deux colonnes (Maj + clic)');
  // colonnes
  await p.click('#base-btn-colonnes');
  await p.check('.base-pop-colonnes input[data-col="echeance"]');
  ok(await p.locator('.base-tete .tri[data-col="echeance"]').count() === 1, 'ajouter une colonne');
  await p.uncheck('.base-pop-colonnes input[data-col="note"]');
  ok(await p.locator('.base-tete .tri[data-col="note"]').count() === 0, 'masquer une colonne');
  const ordre1 = await p.locator('.base-tete .tri').evaluateAll(b => b.map(x => x.dataset.col));
  await p.locator('.base-pop-colonnes li:has(input[data-col="statut"]) button[aria-label^="Monter"]').click();
  const ordre2 = await p.locator('.base-tete .tri').evaluateAll(b => b.map(x => x.dataset.col));
  ok(ordre2.indexOf('statut') === ordre1.indexOf('statut') - 1, 'réordonner les colonnes');
  await p.keyboard.press('Escape');
  ok(await p.locator('.base-pop-colonnes').isHidden() && await p.locator('#vue-base').isVisible(), 'Échap ferme le menu des colonnes, pas la vue');
  // vues enregistrées
  await p.click('#base-btn-filtres'); await p.click('[data-filtre="statut:prospectus"]'); await p.click('#base-btn-filtres');
  await p.click('#base-btn-vues'); await p.fill('#base-nom-vue', 'Mes prospectus'); await p.press('#base-nom-vue', 'Enter');
  await p.click('#base-effacer-filtres').catch(async () => { await p.click('.base-filtres-actifs .puce-active'); });
  await p.waitForTimeout(150);
  ok(await lignes() === 12, 'filtres effacés');
  await p.click('#base-btn-vues'); await p.click('[data-vue="Mes prospectus"]');
  ok(await lignes() === 2, 'vue enregistrée réappliquée');
  // sélection et actions groupées
  await p.locator('.base-corps .base-ligne input[type=checkbox]').nth(0).check();
  await p.locator('.base-corps .base-ligne input[type=checkbox]').nth(1).check();
  ok(/2 sélectionnées/.test(await p.locator('.base-selection').innerText()), 'sélection de 2 maisons');
  await p.selectOption('#base-sel-etiquette', 'e-travaux');
  ok(await p.evaluate(() => Object.values(Statuts._records()).filter(r => (r.etiquettes || []).includes('e-travaux')).length) === 2, 'étiquette ajoutée à la sélection');
  await p.selectOption('#base-sel-statut', 'absent');
  ok(await p.evaluate(() => Object.values(Statuts._records()).filter(r => r.statut === 'absent').length) === 2, 'statut changé pour la sélection');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#base-btn-export')]);
  const f = path.join(TMP, 'base.csv'); await dl.saveAs(f);
  const csv = fs.readFileSync(f, 'utf8').split('\r\n');
  ok(csv[0].includes('Échéance') && !csv[0].includes('Note') && csv.length >= 3, 'export CSV : colonnes affichées, lignes filtrées');
  await p.click('#base-effacer-filtres').catch(async () => { await p.click('.base-filtres-actifs .puce-active'); });
  await p.locator('.base-corps .base-ligne .base-fixe').first().click();
  await p.waitForSelector('#panneau.ouverte');
  ok(await p.locator('#vue-base').isHidden(), 'clic sur une ligne : fiche sur la carte');
  await p.waitForTimeout(600); await recharger(p);
  await p.click('.rail [data-nav=base]'); await p.waitForSelector('.base-corps .base-ligne');
  ok(await p.locator('.base-tete .tri[data-col="echeance"]').count() === 1 && await p.locator('.base-tete .tri[data-col="note"]').count() === 0, 'colonnes conservées au rechargement');
  await p.click('#base-btn-vues');
  ok(await p.locator('[data-vue="Mes prospectus"]').count() === 1, 'vues conservées au rechargement');
  // virtualisation : 3 000 maisons
  await p.evaluate(() => {
    const fs = [], a0 = 47.3, o0 = -1.5;
    for (let i = 0; i < 3000; i++) fs.push({ type: 'Feature', id: 'bdt/' + (50000 + i), properties: { building: 'house', 'addr:street': 'Rue ' + (i % 40), 'addr:housenumber': String(i) }, geometry: { type: 'Polygon', coordinates: [[[o0 + i * 0.0002, a0], [o0 + i * 0.0002 + 0.00007, a0], [o0 + i * 0.0002 + 0.00007, a0 + 0.00007], [o0 + i * 0.0002, a0 + 0.00007], [o0 + i * 0.0002, a0]]] } });
    DataImmo.ajouter(fs); CarteImmo.afficherBatiments(fs);
  });
  await p.mouse.click(700, 60); await p.waitForTimeout(400);
  const nDom = await lignes();
  const txtBase = await p.locator('#vue-base .sous-titre').first().innerText();
  ok(/3 012 bâtiments/.test(txtBase) && nDom < 80, 'virtualisation : 3 012 bâtiments, ' + nDom + ' lignes dessinées (' + txtBase + ')');
  await p.evaluate(() => { const z = document.querySelector('.base-zone'); z.scrollTop = z.scrollHeight; });
  await p.waitForTimeout(300);
  ok(await p.locator('.base-corps .base-ligne').last().getAttribute('data-i') === '3011', 'défilement jusqu\'à la dernière ligne');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Communes', async (env) => {
  const els = grille(4, 5, 300, ['Rue des Lilas', 'Rue du Parc']).concat(grille(1, 3, 400, ['Rue Lointaine'], 0.03));
  const p = await page(env, { batiments: els });
  await p.evaluate(() => { Telechargements.config.pauseMs = 20; });
  await tiroir(p, 'secteurs');
  await p.fill('#commune-recherche', 'Testv');
  await p.waitForSelector('.suggestion-commune');
  ok(/Testville/.test(await p.locator('.suggestion-commune').first().innerText()) && /1\s?234 hab/.test(await p.locator('.suggestion-commune').first().innerText()), 'recherche d\'une commune : nom, code postal, population');
  await p.locator('.suggestion-commune').first().click();
  await p.waitForFunction(() => Communes.liste().length === 1 && !Telechargements.enCours() && Telechargements.liste().some(t => t.type === 'commune' && t.etat === 'fini'), null, { timeout: 10000 });
  ok(await p.evaluate(() => CarteImmo.total()) === 20, 'commune téléchargée : seuls les bâtiments dans son contour (20)');
  await p.waitForTimeout(300);
  ok((await p.locator('.notif .texte').allInnerTexts()).some(t => /Testville : 20 bâtiments à prospecter/.test(t)), 'notification de fin : bâtiments à prospecter');
  ok(await p.evaluate(() => { let n = 0; CarteImmo.getMap().eachLayer(l => { if (l.options && l.options.className === 'contour-commune') n++; }); return n; }) === 1, 'contour de la commune sur la carte');
  await p.waitForTimeout(500);   // le téléchargement ramène sur la carte : le panneau finit de se fermer
  if (!(await p.locator('#communes-liste .carte-commune').isVisible())) await tiroir(p, 'secteurs');
  const txtCommune = await p.locator('#communes-liste').innerText();
  ok(/20 à prospecter/.test(txtCommune), 'liste des communes : bâtiments à prospecter (' + txtCommune.replace(/\n/g, ' | ') + ')');
  await p.click('#communes-liste [data-action=secteur]');
  ok(await p.evaluate(() => Secteurs.liste().length === 1 && Secteurs.liste()[0].nom === 'Testville' && Secteurs.stats(Secteurs.liste()[0].id).total === 20), 'secteur créé à partir de la commune (20 logements)');
  await p.waitForTimeout(600); await recharger(p);
  ok(await p.evaluate(() => Communes.liste().length === 1 && DataImmo.estCharge(CarteImmo.getMap().getBounds().pad(-0.9)) !== undefined), 'commune conservée au rechargement');
  await tiroir(p, 'secteurs');
  await p.click('#communes-liste [data-action=retirer]');
  await p.click('#confirmer-oui'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => Communes.liste().length === 0 && CarteImmo.total() === 0), 'retirer : commune et bâtiments sans information effacés');
  // Palette de commandes : « Télécharger toute la commune »
  await p.keyboard.press('Control+k'); await p.fill('#palette-saisie', 'Testville');
  await p.waitForSelector('.palette-item:has-text("Télécharger toute la commune")');
  ok(true, 'palette : « Télécharger toute la commune »');
  await p.keyboard.press('Escape');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Types de bâtiments et immeubles', async (env) => {
  const els = grille(3, 4, 100, ['Rue des Lilas', 'Avenue du Parc', null]);
  els[1].tags = { building: 'apartments', 'building:flats': '30', 'addr:street': 'Rue des Lilas', 'addr:housenumber': '3' };
  els[2].tags = { building: 'shed' };
  els[3].tags = { building: 'retail', 'addr:street': 'Rue des Lilas', 'addr:housenumber': '7' };
  els[4].tags = { building: 'house', 'test:usage2': 'Commercial et services', 'addr:street': 'Avenue du Parc', 'addr:housenumber': '1' };
  const p = await page(env, { batiments: els });
  await chargerZone(p);
  const types = await p.evaluate(() => ['bdt/100', 'bdt/101', 'bdt/102', 'bdt/103', 'bdt/104'].map(TypesBati.typeDe).join());
  ok(types === 'maison,immeuble,annexe,commerce,mixte', 'types déduits de la BD TOPO (' + types + ')');
  ok(await p.evaluate(() => CarteImmo.total()) === 10 && /39 logements/.test(await p.locator('#legende .total').innerText()), 'annexe et entreprise masquées par défaut ; légende en logements (39)');
  await p.click('#legende .puce-type[data-type=commerce]');
  ok(await p.evaluate(() => CarteImmo.total()) === 11 && await p.evaluate(() => TypesBati.aProspecter('bdt/103')), 'afficher les entreprises (option)');
  await p.click('#legende .puce-type[data-type=commerce]');
  // Correction du type dans la fiche
  await clicMaison(p, 'bdt/100'); await p.waitForSelector('#panneau.ouverte');
  await p.selectOption('#fiche-type', 'immeuble');
  ok(await p.evaluate(() => TypesBati.typeDe('bdt/100')) === 'immeuble', 'type corrigé à la main');
  await p.selectOption('#fiche-type', 'maison');
  // Immeuble : un geste pour 30 logements
  await clicMaison(p, 'bdt/101'); await p.waitForTimeout(200);
  ok(/Tout l'immeuble \(30 logements\)/i.test(await p.locator('#panneau').innerText()), 'fiche immeuble : 30 logements (IGN)');
  await p.click('#btn-tournee'); await p.waitForSelector('#dlg-tournee[open]');
  await p.click('label:has(#tournee-position)'); await p.click('#tournee-demarrer');
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(() => Outils.setMode('tournee'));
  await clicMaison(p, 'bdt/101');
  await p.waitForTimeout(200);
  ok(/30 logements/.test(await notif(p)) && await p.locator('.tp-portes').innerText() === '30', 'pointage rapide d\'un immeuble : 30 portes dans la tournée');
  await p.evaluate(() => Outils.setMode('consulter'));
  await clicMaison(p, 'bdt/101'); await p.waitForSelector('#panneau.ouverte');
  await p.fill('#fiche-nouveau-logement', 'Apt 12'); await p.click('#fiche-ajouter-logement');
  await p.waitForSelector('#fiche-retour');
  ok(await p.locator('#panneau .choix-statut[data-statut=prospectus][aria-pressed=true]').count() === 1, 'nouveau logement : reprend le statut de l\'immeuble');
  await p.click('#panneau .choix-statut[data-statut=rappeler]');
  await p.fill('#panneau input[placeholder="Ex. Mme Durand"]', 'Mme Logement'); await p.locator('#panneau input[placeholder="Ex. Mme Durand"]').press('Tab');
  const etat = await p.evaluate(() => ({ av: Statuts.avancement('bdt/101'), aff: Statuts.statutAffiche('bdt/101'), poids: Statuts.poids('bdt/101') }));
  ok(etat.av.total === 30 && etat.av.faits === 30 && etat.aff === 'rappeler' && etat.poids === 29, 'immeuble : 29 logements non détaillés + 1 détaillé, statut affiché « À rappeler »');
  await p.click('#fiche-retour');
  ok(/Apt 12/.test(await p.locator('.liste-logements').innerText()) && /30 \/ 30/.test(await p.locator('.resume-logements').innerText()), 'liste des logements et avancement 30 / 30');
  await p.click('#panneau [data-acces=gardien]');
  await p.fill('#fiche-digicode', '4589B'); await p.locator('#fiche-digicode').press('Tab');
  ok(await p.evaluate(() => Statuts.get('bdt/101').gardien === true && Statuts.get('bdt/101').digicode === '4589B'), 'accès : gardien, digicode');
  // Le logement apparaît dans les rappels et la base
  await tiroir(p, 'rappels');
  ok(/Mme Logement/.test(await p.locator('#rappels-liste').innerText()) && /Apt 12/.test(await p.locator('#rappels-liste').innerText()), 'rappels : logement d\'immeuble');
  await p.click('.rail [data-nav=base]'); await p.waitForSelector('.base-corps .base-ligne');
  await p.click('#base-btn-filtres'); await p.click('[data-filtre="logements"]');
  ok(await p.locator('.base-corps .base-ligne').count() === 1 && /Apt 12/.test(await p.locator('.base-corps').innerText()), 'base : filtre « Logements détaillés »');
  await p.click('[data-filtre="logements"]'); await p.click('[data-filtre="type:immeuble"]');
  ok(await p.locator('.base-corps .base-ligne').count() === 2, 'base : filtre par type de bâtiment (l\'immeuble et son logement)');
  await p.click('#base-btn-filtres');
  // Bilan : 31 portes (30 + 1 passage du logement), tournée : 30 portes
  const ch = await p.evaluate(() => Stats.chiffres(Stats.elementsReels()));
  ok(ch.faits === 30 && ch.par.rappeler === 1 && ch.par.prospectus === 29, 'bilan en logements : 30 faits (29 prospectus, 1 à rappeler)');
  ok(await p.evaluate(() => Defis.agregats().portes) === 31, 'défis : 31 portes (immeuble 30 + nouveau passage du logement)');
  // Export / import du schéma 6
  const ex = await p.evaluate(() => JSON.parse(JSON.stringify(Echange.construireExport())));
  ok(ex.schema === 6 && ex.records['bdt/101'].lots.length === 1, 'export : schéma 6, logements');
  // Suppression d'un logement
  await p.evaluate(() => Coquille.allerVue('carte'));
  await p.evaluate(() => Panneau.ouvrir(Statuts.lotsDe('bdt/101')[0])); await p.waitForSelector('#fiche-supprimer-logement');
  await p.click('#fiche-supprimer-logement'); await p.click('#confirmer-oui'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !Statuts.aDesLogements('bdt/101') && Statuts.avancement('bdt/101').faits === 30), 'logement supprimé : il reprend le statut de l\'immeuble');
  await p.waitForTimeout(600); await recharger(p);
  ok(await p.evaluate(() => Statuts.get('bdt/101').digicode === '4589B' && Statuts.avancement('bdt/101').total === 30), 'immeuble conservé au rechargement');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

rubrique('Accessibilité (axe-core) et performance', async (env) => {
  const p = await page(env);
  await chargerZone(p);
  async function axe(nom) {
    if (!axeSrc) return;
    await p.evaluate(axeSrc);
    const v = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.filter(x => x.impact === 'serious' || x.impact === 'critical').map(x => x.id + ' (' + x.nodes.length + ') ' + x.nodes[0].html.slice(0, 80)));
    ok(!v.length, 'axe : aucune violation grave – ' + nom + (v.length ? ' : ' + v.join(' | ') : ''));
  }
  if (!axeSrc) console.log('  (axe-core absent : contrôles automatiques d\'accessibilité ignorés)');
  await axe('carte');
  await clicMaison(p, 'bdt/100'); await p.waitForSelector('#panneau.ouverte'); await axe('fiche ouverte');
  await p.keyboard.press('Escape');
  await tiroir(p, 'secteurs'); await axe('panneau secteurs');
  await p.click('.rail [data-nav=tableau]'); await p.click('label:has(#stats-demo)'); await axe('bilan');
  await p.evaluate(() => { while (Theme.libelle() !== 'Sombre') Theme.basculer(); }); await axe('bilan, thème sombre');
  await p.click('.rail [data-nav=tournees]'); await p.waitForSelector('.grille-badges'); await axe('tournées et défis');
  await p.click('.rail [data-nav=base]'); await p.waitForSelector('.base-corps .base-ligne'); await axe('base des maisons');
  await p.click('.rail [data-nav=carte]');
  const noms = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && !(b.getAttribute('aria-label') || b.textContent.trim())).length);
  ok(noms === 0, 'tous les boutons visibles ont un nom accessible');
  // Échelle d'une ville : 40 000 bâtiments, dont 6 000 cochés
  const perf = await p.evaluate(async () => {
    const fs = [], N = 40000, cols = 200, a0 = 47.2184, o0 = -1.5536;
    for (let i = 0; i < N; i++) { const la = a0 + Math.floor(i / cols) * 0.0002, lo = o0 + (i % cols) * 0.0002, d = 0.00007;
      fs.push({ type: 'Feature', id: 'bdt/' + (900000 + i), properties: { src: 'bdtopo', u1: 'Résidentiel', lgt: 1 }, geometry: { type: 'Polygon', coordinates: [[[lo, la], [lo + d, la], [lo + d, la + d], [lo, la + d], [lo, la]]] } }); }
    const m = CarteImmo.getMap(); m.setView([a0 + 0.007, o0 + 0.007], 18, { animate: false });
    DataImmo.ajouter(fs); const t0 = performance.now(); CarteImmo.afficherBatiments(fs); CarteImmo.majVue(); const creation = performance.now() - t0;
    const t1 = performance.now(); Statuts.modifier(fs.slice(0, 6000).map(f => f.id), { statut: 'prospectus' }); const pointage = performance.now() - t1;
    const frames = []; let last = performance.now();
    for (let i = 0; i < 30; i++) { m.panBy([50, 30], { animate: false }); await new Promise(r => requestAnimationFrame(r)); const n = performance.now(); frames.push(n - last); last = n; }
    frames.sort((x, y) => x - y);
    const dessines18 = CarteImmo.nbDessines();
    const t2 = performance.now(); m.setView([a0 + 0.02, o0 + 0.02], 13, { animate: false }); await new Promise(r => setTimeout(r, 600)); const apercu = performance.now() - t2;
    return { creation: Math.round(creation), pointage: Math.round(pointage), median: Math.round(frames[15]), p90: Math.round(frames[27]), dessines18, apercu: CarteImmo.modeApercu(), dessines13: CarteImmo.nbDessines(), carreaux: document.querySelectorAll('.leaflet-overlay-pane path').length };
  });
  ok(perf.creation < 2500 && perf.p90 < 300 && perf.dessines18 < 3000, 'performance : 40 000 bâtiments, seuls ceux de la vue sont dessinés, déplacement fluide (' + JSON.stringify(perf) + ')');
  ok(perf.apercu && perf.dessines13 === 0, 'vue éloignée : carte d\'avancement par carreaux, aucun bâtiment dessiné');
  ok(!p.erreurs.length, 'aucune erreur JavaScript (' + p.erreurs.join(' | ') + ')');
  await p.ctx.close();
});

// ---------------------------------------------------------------------------------------------
(async () => {
  const env = await T.demarrer(8150 + Math.floor(Math.random() * 40));
  const filtre = process.argv[2];
  for (const r of rubriques) {
    if (filtre && !r.nom.toLowerCase().includes(filtre.toLowerCase())) continue;
    titre(r.nom);
    try { await r.fn(env); } catch (e) { ok(false, 'exception : ' + String(e.message || e).split('\n')[0]); }
  }
  await env.fermer();
  process.exit(T.bilan() ? 1 : 0);
})();
