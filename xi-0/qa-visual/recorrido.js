#!/usr/bin/env node
// Recorrido visual de xi-0: captura pantallas (escritorio y móvil), texto visible, errores de consola
// y peticiones fallidas de una lista de rutas. Usa el Chrome o Edge instalado (playwright-core).
//
// Estado actual (web publicada):
//   node ~/.claude/xi-0/qa-visual/recorrido.js --url https://sitio.com --rutas /reportes --out <dir>
// Después del cambio (build local, con fallback de SPA):
//   node ~/.claude/xi-0/qa-visual/recorrido.js --dist <carpeta del build> --rutas /reportes --out <dir>
// Opciones: --esperar <ms> (extra, por defecto 1500) · --hasta-sin <regex> (texto de carga a esperar que desaparezca,
// por defecto "Loading|Cargando") · --canal chrome|msedge · --sin-movil
// Nota GitHub Pages: un 404 del documento inicial con la app cargando bien es el fallback de SPA (404.html), no una falla.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const sig = process.argv[i + 1];
  if (sig === undefined || sig.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = sig; i++; }
}
if ((!args.url && !args.dist) || !args.out) {
  console.error('Uso: recorrido.js (--url <base> | --dist <carpeta>) --rutas /a,/b --out <carpeta>');
  process.exit(1);
}
// Las rutas pueden ir sin barra inicial ("reportes,ajustes"); así Git Bash no las convierte en rutas de Windows.
const rutas = String(args.rutas || '/').split(',').map((r) => r.trim()).filter(Boolean)
  .map((r) => (/^[A-Za-z]:[\\/]/.test(r) ? r.replace(/^[A-Za-z]:[\\/].*?[\\/]Git(?=[\\/])/i, '') : r).replace(/\\/g, '/'))
  .map((r) => (r.startsWith('/') ? r : '/' + r));
const esperar = Number(args.esperar || 1500);
const out = path.resolve(args.out);
fs.mkdirSync(out, { recursive: true });

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.csv': 'text/csv' };

function servir(dir) {
  const raiz = path.resolve(dir);
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let f = path.join(raiz, u);
    if (!f.startsWith(raiz)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      const idx = path.join(f, 'index.html');
      f = fs.existsSync(idx) ? idx : (path.extname(u) ? null : path.join(raiz, 'index.html'));
    }
    if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

const slug = (r) => (r.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '_') || 'inicio');

(async () => {
  let servidor = null;
  let base = args.url && String(args.url).replace(/\/+$/, '');
  if (args.dist) { servidor = await servir(args.dist); base = servidor.base; }

  let navegador;
  for (const canal of [args.canal, 'chrome', 'msedge'].filter(Boolean)) {
    try { navegador = await chromium.launch({ channel: canal, headless: true }); break; } catch { /* probar el siguiente */ }
  }
  if (!navegador) { console.error('No encontré Chrome ni Edge instalados.'); process.exit(1); }

  const vistas = [{ nombre: 'escritorio', viewport: { width: 1440, height: 900 } }];
  if (!args['sin-movil']) vistas.push({ nombre: 'movil', viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });

  // El informe entra al historial de la tarea: la carpeta va relativa, sin la ruta de esta máquina.
  const distRelativa = path.relative(process.cwd(), path.resolve(args.dist || '.')).replace(/\\/g, '/') || '.';
  const distInforme = /^\.\.|^[a-zA-Z]:|^\//.test(distRelativa) ? path.basename(path.resolve(args.dist || '.')) : distRelativa;
  const informe = [`# Recorrido visual`, `- Base: ${args.url || `build local ${distInforme}`}`, `- Fecha: ${new Date().toISOString()}`, ''];
  let problemas = 0;

  for (const ruta of rutas) {
    informe.push(`## ${ruta}`);
    for (const v of vistas) {
      const ctx = await navegador.newContext({ viewport: v.viewport, isMobile: v.isMobile, deviceScaleFactor: v.deviceScaleFactor });
      const pag = await ctx.newPage();
      const consola = [];
      const fallidas = [];
      pag.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consola.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
      pag.on('pageerror', (e) => consola.push(`excepción: ${String(e.message).slice(0, 300)}`));
      pag.on('requestfailed', (r) => fallidas.push(`${r.failure() && r.failure().errorText} ${r.url()}`));
      pag.on('response', (r) => { if (r.status() >= 400) fallidas.push(`${r.status()} ${r.url()}`); });

      const t0 = Date.now();
      let estado = 'ok';
      try {
        await pag.goto(base + ruta, { waitUntil: 'networkidle', timeout: 60000 });
      } catch (e) { estado = `timeout/errores al cargar: ${e.message.split('\n')[0]}`; }
      // Espera a que desaparezcan los textos de carga (los datos grandes llegan después de networkidle).
      const patronCarga = String(args['hasta-sin'] || 'Loading|Cargando');
      const cargo = await pag.waitForFunction((p) => !new RegExp(p, 'i').test(document.body.innerText), patronCarga, { timeout: 60000 })
        .then(() => true).catch(() => false);
      if (!cargo) estado = estado === 'ok' ? `sigue mostrando /${patronCarga}/ tras 60 s` : estado;
      // Recorre la página con scroll para disparar lo que se anima o carga al entrar en pantalla
      // (IntersectionObserver); una captura de página completa no hace scroll por sí sola.
      await pag.evaluate(async () => {
        const paso = Math.max(200, Math.floor(window.innerHeight * 0.8));
        for (let y = 0; y < document.documentElement.scrollHeight; y += paso) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 250));
        }
        window.scrollTo(0, 0);
      });
      await pag.waitForTimeout(esperar);
      const ms = Date.now() - t0;
      const png = `${slug(ruta)}-${v.nombre}.png`;
      await pag.screenshot({ path: path.join(out, png), fullPage: true });
      const anchoDesborda = await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (v.nombre === 'escritorio') {
        const texto = await pag.evaluate(() => document.body.innerText);
        fs.writeFileSync(path.join(out, `${slug(ruta)}.txt`), texto);
      }
      problemas += consola.length + fallidas.length + (anchoDesborda ? 1 : 0) + (estado === 'ok' ? 0 : 1);
      informe.push(`### ${v.nombre} (${v.viewport.width}×${v.viewport.height}) — ${ms} ms`,
        `- Captura: \`${png}\``, `- Carga: ${estado}`,
        `- Scroll horizontal: ${anchoDesborda ? '**sí (desborda)**' : 'no'}`,
        `- Consola (${consola.length}):${consola.length ? '\n' + consola.slice(0, 20).map((x) => `  - ${x}`).join('\n') : ' limpia'}`,
        `- Peticiones fallidas (${fallidas.length}):${fallidas.length ? '\n' + fallidas.slice(0, 20).map((x) => `  - ${x}`).join('\n') : ' ninguna'}`, '');
      await ctx.close();
    }
  }
  await navegador.close();
  if (servidor) servidor.srv.close();
  informe.push(`**Problemas detectados: ${problemas}**`);
  fs.writeFileSync(path.join(out, 'recorrido.md'), informe.join('\n'));
  console.log(`recorrido: ${rutas.length} ruta(s), ${problemas} problema(s) → ${path.join(out, 'recorrido.md')}`);
})().catch((e) => { console.error(e); process.exit(1); });
