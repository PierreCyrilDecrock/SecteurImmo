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

// ---------- Simulation du service WFS de l'IGN (BD TOPO, BAN-PLUS) à partir d'une grille ----------
// Étiquettes OSM de la grille -> champs BD TOPO : house = maison (1 logement), apartments = immeuble
// (building:flats logements), shed/garage = annexe, retail/commercial = commerce, yes = usage inconnu.
function versIgn(els) {
  const bat = [], adr = [], lien = [];
  els.forEach(x => {
    const t = x.tags || {}, b = t.building || 'yes';
    const p = { cleabs: 'BATIMENT' + String(x.id).padStart(16, '0'), etat_de_l_objet: 'En service', construction_legere: b === 'shed',
      usage_1: { house: 'Résidentiel', apartments: 'Résidentiel', shed: 'Annexe', garage: 'Annexe', retail: 'Commercial et services', commercial: 'Commercial et services' }[b] || 'Indifférencié',
      usage_2: t['test:usage2'] || null,
      nombre_de_logements: b === 'house' ? 1 : b === 'apartments' ? (+t['building:flats'] || 10) : 0, nombre_d_etages: b === 'apartments' ? 4 : 1 };
    bat.push({ type: 'Feature', id: 'batiment.' + x.id, geometry: { type: 'MultiPolygon', coordinates: [[x.geometry.map(g => [g.lon, g.lat, 12])]] }, properties: p, c: x.geometry[0] });
    if (t['addr:street']) {
      const ia = '44999_' + x.id;
      // Point d'entrée : au milieu du côté sud du bâtiment
      const g = x.geometry, pt = [(g[0].lon + g[1].lon) / 2, g[0].lat];
      adr.push({ type: 'Feature', id: 'adresse.' + x.id, geometry: { type: 'Point', coordinates: pt }, properties: { id_adr: ia, numero: +t['addr:housenumber'] || null, rep: t['test:rep'] || null, nom_voie: t['addr:street'], insee_com: '44999' }, c: x.geometry[0], parcelle: t['test:parcelle'] });
      if (!t['test:parcelle']) lien.push({ type: 'Feature', id: 'lien.' + x.id, geometry: null, properties: { id_adr: ia, id_bat: p.cleabs, nb_adr: 1, nb_bat: 1, idu: '44999000AB' + String(x.id).padStart(4, '0') }, c: x.geometry[0] });
    }
  });
  // Parcelle partagée (« test:parcelle ») : comme l'IGN, chaque adresse est reliée à chaque bâtiment de la parcelle
  const parcelles = {};
  els.forEach(x => { const k = (x.tags || {})['test:parcelle']; if (k) (parcelles[k] = parcelles[k] || []).push(x); });
  Object.keys(parcelles).forEach(k => {
    const bs = parcelles[k], as = adr.filter(a => a.parcelle === k);
    as.forEach(a => bs.forEach(x => lien.push({ type: 'Feature', id: 'lien.' + a.properties.id_adr + '.' + x.id, geometry: null,
      properties: { id_adr: a.properties.id_adr, id_bat: 'BATIMENT' + String(x.id).padStart(16, '0'), nb_adr: as.length, nb_bat: bs.length, idu: '44999000AC' + k.padStart(4, '0') }, c: a.c })));
  });
  adr.forEach(a => { delete a.parcelle; });
  return { 'BDTOPO_V3:batiment': bat, 'BAN-PLUS:adresse': adr, 'BAN-PLUS:lien_adresse_bati': lien };
}
function dansPoly(lat, lon, poly) {
  let d = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) d = !d;
  }
  return d;
}
// Répond à une requête GetFeature (pagination COUNT / STARTINDEX, filtre BBOX ou CQL)
function reponseWfs(url, couches) {
  const u = new URL(url), q = k => u.searchParams.get(k);
  let liste = couches[q('TYPENAMES')] || [];
  const bbox = q('BBOX'), cql = q('CQL_FILTER');
  if (bbox) { const [s, w, n, e] = bbox.split(',').map(Number); liste = liste.filter(f => f.c.lat >= s && f.c.lat <= n && f.c.lon >= w && f.c.lon <= e); }
  else if (cql && /INTERSECTS/.test(cql)) {
    const pts = cql.match(/POLYGON\(\((.*)\)\)/)[1].split(',').map(x => x.trim().split(/\s+/).map(Number)).map(([lon, lat]) => [lat, lon]);
    liste = liste.filter(f => dansPoly(f.c.lat, f.c.lon, pts));
  } else if (cql && /insee_com/.test(cql)) liste = liste.filter(f => f.properties.insee_com === cql.match(/'(\w+)'/)[1]);
  const debut = +q('STARTINDEX') || 0, nb = +q('COUNT') || 5000;
  const page = liste.slice(debut, debut + nb).map(({ c, ...f }) => f);
  return { type: 'FeatureCollection', features: page, numberMatched: liste.length, numberReturned: page.length };
}
// Commune simulée : « Testville » (44999), un rectangle autour de la grille de test
const COMMUNE = { nom: 'Testville', code: '44999', codesPostaux: ['44999'], population: 1234, departement: { nom: 'Loire-Atlantique', code: '44' } };
function contourCommune() {
  const s = lat0 - 0.0005, w = lon0 - 0.0005, n = lat0 + 0.004, e = lon0 + 0.004;
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
}

async function demarrer(port) {
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: RACINE, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  // Adresses IP locales visibles en WebRTC (synchronisation) ; caméra simulée
  const b = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
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
  p.appels = { overpass: 0, reverse: 0, search: 0, tuiles: 0, wfs: 0, communes: 0 };
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
  const couches = versIgn(els);
  p.couchesIgn = couches;
  const repondreWfs = (r) => r.fulfill({ json: reponseWfs(r.request().url(), couches) });
  await p.route('https://data.geopf.fr/wfs/**', r => { p.appels.wfs++; if (opts.wfs) return opts.wfs(r, p.appels.wfs, repondreWfs); repondreWfs(r); });
  await p.route('https://geo.api.gouv.fr/**', r => {
    p.appels.communes++;
    const u = r.request().url();
    if (/\/communes\/\d+/.test(u)) return r.fulfill({ json: Object.assign({}, COMMUNE, { contour: contourCommune() }) });
    r.fulfill({ json: [COMMUNE, { nom: 'Testville-sur-Mer', code: '44998', codesPostaux: ['44998'], population: 80, departement: { nom: 'Loire-Atlantique' } }] });
  });
  // DPE : un par maison ayant une étiquette « test:dpe » (rattaché par l'identifiant d'adresse BAN)
  const dpe = els.filter(x => (x.tags || {})['test:dpe']).map((x, i) => ({ numero_dpe: 'DPE' + x.id, identifiant_ban: '44999_' + x.id,
    numero_voie_ban: (x.tags || {})['addr:housenumber'] || null, nom_rue_ban: (x.tags || {})['addr:street'] || null, etiquette_dpe: x.tags['test:dpe'], etiquette_ges: 'C',
    date_etablissement_dpe: '2024-0' + (1 + i % 9) + '-15', type_batiment: x.tags.building === 'apartments' ? 'appartement' : 'maison', surface_habitable_logement: 90 + i,
    periode_construction: '1948-1974', complement_adresse_logement: null, id_rnb: null, _geopoint: x.geometry[0].lat + ',' + x.geometry[0].lon }));
  await p.route('https://data.ademe.fr/**', r => { p.appels.dpe = (p.appels.dpe || 0) + 1; if (opts.dpe) return opts.dpe(r); r.fulfill({ json: { total: dpe.length, results: dpe } }); });
  // DVF : une vente par maison ayant « test:vente » (prix), sur sa parcelle
  await p.route('https://app.dvf.etalab.gouv.fr/**', r => {
    p.appels.dvf = (p.appels.dvf || 0) + 1;
    const section = r.request().url().split('/').pop();
    const mutations = els.filter(x => (x.tags || {})['test:vente'] && section === '000AB').map(x => ({ id_mutation: 'M' + x.id, date_mutation: '2025-03-1' + (x.id % 9), nature_mutation: 'Vente',
      valeur_fonciere: x.tags['test:vente'], adresse_numero: (x.tags || {})['addr:housenumber'] || 'None', adresse_suffixe: 'None', adresse_nom_voie: String((x.tags || {})['addr:street'] || '').toUpperCase(),
      id_parcelle: '44999000AB' + String(x.id).padStart(4, '0'), type_local: 'Maison', surface_reelle_bati: '100', nombre_pieces_principales: '5' }));
    r.fulfill({ json: { mutations } });
  });
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
  await p.waitForFunction(() => CarteImmo.total() > 0 && !Telechargements.enCours());
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
