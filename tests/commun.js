/*
 * Outils communs des tests de bout en bout (Playwright, non livré avec l'application).
 * Les services externes (tuiles, géocodage IGN, Overpass) sont simulés par interception réseau :
 * les tests ne dépendent pas d'Internet.
 */
const path = require('path');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const RACINE = path.resolve(__dirname, '..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO8c+fOfwAHRQMe8OoWuQAAAABJRU5ErkJggg==', 'base64');
const sq = (lat, lon, d) => [{ lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon }];
const lat0 = 47.2184, lon0 = -1.5536;

// Grille de maisons : nl lignes × nc colonnes, ids à partir de `base`, rues facultatives par ligne
function grille(nl, nc, base, rues, dLon) {
  const els = [];
  for (let i = 0; i < nl; i++) for (let j = 0; j < nc; j++) {
    const k = i * nc + j, rue = rues ? rues[i % rues.length] : null;
    els.push({ type: 'way', id: base + k, tags: Object.assign({ building: 'house' }, rue ? { 'addr:street': rue, 'addr:housenumber': String(j * 2 + 1) } : {}),
      geometry: sq(lat0 + i * 0.00025, lon0 + (dLon || 0) + j * 0.00025, 0.00009) });
  }
  return els;
}

async function demarrer(port) {
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: RACINE, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const b = await chromium.launch();
  return { b, srv, url: 'http://localhost:' + port + '/', fermer: async () => { await b.close(); srv.kill(); } };
}

/*
 * Ouvre l'application. opts : { contexte, ctx, bienvenue, batiments, overpass(route, n, els), animations }
 * Par défaut : animations réduites (tests plus rapides et déterministes), présentation de bienvenue déjà vue.
 */
async function page(env, opts = {}) {
  const ctx = opts.ctx || await env.b.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, reducedMotion: opts.animations ? 'no-preference' : 'reduce', acceptDownloads: true }, opts.contexte || {}));
  if (!opts.bienvenue) await ctx.addInitScript(() => { try { localStorage.setItem('secteurimmo-aide', '1'); } catch (e) {} });
  const p = await ctx.newPage();
  p.erreurs = [];
  p.on('pageerror', e => p.erreurs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) p.erreurs.push('console: ' + m.text()); });
  p.appels = { overpass: 0, reverse: 0, search: 0, tuiles: 0 };
  await p.route('https://tile.openstreetmap.org/**', r => { p.appels.tuiles++; r.fulfill({ body: png, contentType: 'image/png' }); });
  await p.route('https://data.geopf.fr/wmts**', r => r.fulfill({ body: png, contentType: 'image/png' }));
  await p.route('https://data.geopf.fr/geocodage/search**', r => { p.appels.search++; r.fulfill({ json: { features: [
    { properties: { label: 'Nantes', postcode: '44000', city: 'Nantes', type: 'municipality' }, geometry: { coordinates: [lon0, lat0] } },
    { properties: { label: 'Rue des Lilas 44000 Nantes', postcode: '44000', city: 'Nantes', type: 'street' }, geometry: { coordinates: [lon0 + 0.0005, lat0 + 0.0003] } }] } }); });
  await p.route('https://data.geopf.fr/geocodage/reverse**', r => { p.appels.reverse++; r.fulfill({ json: { features: [{ properties: { label: '8 Rue Test 44000 Nantes', distance: 12 } }] } }); });
  const els = opts.batiments || grille(3, 4, 100, ['Rue des Lilas', 'Avenue du Parc', null]);
  const repondre = (r) => {
    const q = decodeURIComponent(r.request().postData() || ''); const m = q.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
    const [s, w, n, e] = m ? m.slice(1).map(Number) : [-90, -180, 90, 180];
    r.fulfill({ json: { elements: els.filter(x => { const g = x.geometry[0]; return g.lat >= s && g.lat <= n && g.lon >= w && g.lon <= e; }) } });
  };
  await p.route('https://overpass-api.de/**', r => { p.appels.overpass++; if (opts.overpass) return opts.overpass(r, p.appels.overpass, repondre); repondre(r); });
  await p.route('https://overpass.kumi.systems/**', r => { p.appels.overpass++; if (opts.overpassMiroir) return opts.overpassMiroir(r); repondre(r); });
  await p.goto(env.url);
  await p.waitForFunction(() => document.documentElement.classList.contains('pret'));
  p.ctx = ctx;
  return p;
}

// Position à l'écran du centre d'une maison
const pt = (p, id) => p.evaluate((id) => {
  const c = CarteImmo.centre(id); const r = CarteImmo.getMap().getContainer().getBoundingClientRect(); const m = CarteImmo.getMap().latLngToContainerPoint(c);
  return { x: m.x + r.left, y: m.y + r.top };
}, id);
const clicMaison = async (p, id) => { const c = await pt(p, id); await p.mouse.click(c.x, c.y); };

async function vue(p, lat, lon, z) {
  await p.evaluate(([a, o, z]) => CarteImmo.getMap().setView([a, o], z, { animate: false }), [lat, lon, z]);
  await p.waitForTimeout(150);
}
async function chargerZone(p, lat, lon, z) {
  await vue(p, lat || lat0 + 0.00025, lon || lon0 + 0.0004, z || 19);
  await p.waitForSelector('#pastille-charger.action');
  await p.click('#pastille-charger');
  await p.waitForFunction(() => CarteImmo.total() > 0 && !DataImmo.enCours());
}
// Ouvre un panneau du tiroir et attend qu'il soit réellement affiché
async function tiroir(p, nom) {
  await p.click('.rail [data-nav=' + nom + ']');
  await tiroirAffiche(p);
}
// Le tiroir est rendu (visible et son contenu lisible)
async function tiroirAffiche(p) {
  await p.waitForFunction(() => {
    const t = document.getElementById('tiroir'), s = t.querySelector('.tiroir-section:not([hidden])');
    return getComputedStyle(t).visibility === 'visible' && s && s.innerText.trim().length > 0 && !(s.querySelector('.liste-cartes') && s.querySelector('.liste-cartes').children.length && !s.querySelector('.liste-cartes').innerText.trim());
  });
  await p.waitForTimeout(150);
}
const recharger = async (p) => { await p.reload(); await p.waitForFunction(() => document.documentElement.classList.contains('pret')); await p.waitForTimeout(300); };
const notif = (p) => p.locator('#notifications .notif:not(.sortie)').last().locator('.texte').innerText().catch(() => '');

let nbOk = 0, nbKo = 0;
const ok = (c, m) => { if (c) nbOk++; else nbKo++; console.log(c ? '  OK  ' : '  FAIL', m); };
const titre = (t) => console.log('\n■ ' + t);
const bilan = () => { console.log(`\n${nbOk} contrôle(s) OK, ${nbKo} échec(s)`); return nbKo; };
module.exports = { demarrer, page, pt, clicMaison, vue, chargerZone, recharger, tiroir, tiroirAffiche, notif, ok, titre, bilan, lat0, lon0, grille, sq, RACINE };
