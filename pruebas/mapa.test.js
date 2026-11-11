#!/usr/bin/env node
// Mapa: xi-0/mapa.html contra los criterios de la tarea 20261111-mapa-flujo (CA-1 a CA-23).
// Solo mira lo que ve o hace una persona: textos, roles y nombres accesibles, foco, animaciones en
// curso, desplazamiento y contraste. No depende de clases, ids ni nombres internos del script.
// La parte en navegador usa playwright-core de la instalación del QA visual (~/.claude/xi-0/qa-visual)
// y el Chrome o Edge instalado; si no están, esa parte se omite y lo dice.
// Uso: node pruebas/mapa.test.js [--ref <commit> | --archivo <html>] [--capturas <carpeta>]
//   --ref main prueba la versión de main (sirve para ver qué fallaba antes de un cambio).
//   Con node --test, las mismas opciones van en MAPA_REF, MAPA_ARCHIVO y MAPA_CAPTURAS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const raiz = path.join(__dirname, '..');
const args = { ref: process.env.MAPA_REF, archivo: process.env.MAPA_ARCHIVO, capturas: process.env.MAPA_CAPTURAS };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[i + 1], i++;
}
let archivo = path.resolve(args.archivo || path.join(raiz, 'xi-0', 'mapa.html'));
if (args.ref) {
  archivo = path.join(os.tmpdir(), `mapa-${args.ref.replace(/\W+/g, '_')}.html`);
  fs.writeFileSync(archivo, execFileSync('git', ['show', `${args.ref}:xi-0/mapa.html`], { cwd: raiz }));
}
if (args.capturas) args.capturas = path.resolve(raiz, args.capturas);
const HTML = fs.readFileSync(archivo, 'utf8');

const fallas = [];
const notas = [];
let total = 0;
let ultimo = '';
const caso = (nombre, ok, detalle) => {
  total++;
  ultimo = nombre;
  if (!ok) fallas.push(`${nombre}${detalle ? ': ' + detalle : ''}`);
};

// ---------- sin navegador ----------
caso('CA-15 nada en bucle: sin animaciones infinitas ni SMIL', !/\binfinite\b|indefinite|iterations\s*:\s*Infinity|<animate/i.test(HTML),
  (HTML.match(/.{0,40}(\binfinite\b|indefinite|iterations\s*:\s*Infinity|<animate).{0,40}/i) || [''])[0]);
// www.w3.org es el espacio de nombres de SVG, no se descarga.
const externas = [...new Set((HTML.match(/https?:\/\/[^\s"'`)<>]+/g) || []).map((u) => new URL(u).host))].filter((h) => h !== 'www.w3.org');
caso('CA-23 sin recursos externos nuevos (solo las fuentes que ya estaban)',
  externas.every((h) => ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(h)) && !/<script[^>]+src=/i.test(HTML), externas.join(', '));

// ---------- en navegador ----------
let chromium = null;
try {
  ({ chromium } = require(path.join(os.homedir(), '.claude', 'xi-0', 'qa-visual', 'node_modules', 'playwright-core')));
} catch { /* sin QA visual instalado */ }

// Cuenta el trabajo por cuadro y los intervalos desde antes de que corra el script de la página.
const CONTADORES = () => {
  window.__raf = 0; window.__int = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); };
  const si = window.setInterval.bind(window);
  window.setInterval = (...a) => { window.__int++; return si(...a); };
};
const reposo = async (pag, ms = 1500) => pag.evaluate(async (ms) => {
  const r0 = window.__raf;
  await new Promise((ok) => setTimeout(ok, ms));
  return {
    animaciones: document.getAnimations().length,
    smil: document.querySelectorAll('animate,animateMotion,animateTransform,animateColor,set').length,
    cuadros: window.__raf - r0,
    intervalos: window.__int,
  };
}, ms);

// Texto del panel visible, la lista de pasos (el <ol> con más elementos) y el paso actual.
const panel = (pag) => pag.locator('[role=tabpanel]:not([hidden])');
const pasos = (pag) => panel(pag).evaluate((p) => {
  const ol = [...p.querySelectorAll('ol')].sort((a, b) => b.querySelectorAll(':scope>li').length - a.querySelectorAll(':scope>li').length)[0];
  if (!ol) return { textos: [], actual: -1, enfocables: [] };
  const lis = [...ol.querySelectorAll(':scope>li')];
  const marcado = (li) => li.matches('[aria-current]:not([aria-current=false]),[aria-selected=true]')
    || !!li.querySelector('[aria-current]:not([aria-current=false]),[aria-selected=true]');
  return {
    textos: lis.map((li) => li.innerText.replace(/\s+/g, ' ')),
    actual: lis.findIndex(marcado),
    enfocables: lis.map((li) => [li, ...li.querySelectorAll('button,a[href],[tabindex]')].some((e) => e.tabIndex >= 0 && !e.disabled && e.offsetParent !== null)),
  };
});
const tamano = async (pag, nombre) => {
  await pag.getByRole('group', { name: /tama/i }).getByRole('button', { name: nombre, exact: true }).click();
  return (await panel(pag).innerText()).replace(/\s+/g, ' ');
};
const indice = (textos, re) => textos.findIndex((t) => re.test(t));

// Contraste WCAG de cada texto visible del panel contra el primer fondo opaco hacia arriba.
const contraste = (pag) => panel(pag).evaluate((p) => {
  const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fondo = (e) => { for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c; } return [255, 255, 255]; };
  let peor = { r: 99 };
  for (const e of p.querySelectorAll('*')) {
    const s = getComputedStyle(e);
    const texto = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texto || !e.offsetParent || e.disabled || e.closest('[aria-hidden=true],button:disabled') || s.visibility === 'hidden') continue;
    const a = lum(rgb(s.color)), b = lum(fondo(e)), r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const grande = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    const minimo = grande ? 3 : 4.5;
    if (r / minimo < peor.r / (peor.min || 1)) peor = { r, min: minimo, texto: e.innerText.slice(0, 40) };
  }
  return peor;
});
// La página no se desplaza a lo ancho y ningún texto del panel queda fuera de la ventana.
const ancho = (pag) => pag.evaluate(() => {
  const fuera = [...document.querySelectorAll('[role=tabpanel]:not([hidden]) *')].filter((e) => {
    const r = e.getBoundingClientRect();
    return e.offsetParent && r.width && (r.right > innerWidth + 1 || r.left < -1) && !e.closest('svg');
  });
  return { desborda: document.documentElement.scrollWidth > innerWidth + 1, fuera: fuera.slice(0, 3).map((e) => e.outerHTML.slice(0, 60)) };
});
const caja = async (pag, nombre) => pag.getByRole('button', { name: nombre }).first().boundingBox();

async function navegador() {
  for (const canal of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel: canal, headless: true }); } catch { /* el siguiente */ }
  }
  return null;
}

async function abrir(nav, opciones = {}) {
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 800 }, ...opciones });
  await ctx.addInitScript(CONTADORES);
  const pag = await ctx.newPage();
  const errores = [];
  pag.on('pageerror', (e) => errores.push(e.message));
  await pag.goto(pathToFileURL(archivo).href, { waitUntil: 'load' });
  return { ctx, pag, errores };
}
const pestana = (pag, nombre) => pag.getByRole('tab', { name: nombre }).click();
const captura = async (pag, nombre) => {
  if (args.capturas) await pag.screenshot({ path: path.join(args.capturas, nombre + '.png'), fullPage: true });
};

async function enNavegador(nav) {
  if (args.capturas) fs.mkdirSync(args.capturas, { recursive: true });
  const { ctx, pag, errores } = await abrir(nav);

  // CA-15 y CA-18: en reposo, después de que termina lo que pasa una sola vez al cargar (la ayuda se va a los 7 s).
  await pag.waitForTimeout(8500);
  const r = await reposo(pag);
  notas.push(`reposo en Mapa: ${JSON.stringify(r)}`);
  caso('CA-15/CA-18 en reposo no hay animaciones en curso', r.animaciones === 0 && r.smil === 0, JSON.stringify(r));
  caso('CA-18 en reposo no hay trabajo por cuadro ni intervalos', r.cuadros === 0 && r.intervalos === 0, JSON.stringify(r));
  await captura(pag, 'mapa-escritorio');

  // CA-1: la pestaña Flujo se encuentra y se abre con teclado.
  await pag.locator('body').focus();
  let llego = false;
  for (let i = 0; i < 40 && !llego; i++) {
    await pag.keyboard.press('Tab');
    llego = await pag.evaluate(() => /flujo/i.test(document.activeElement.textContent) && document.activeElement.getAttribute('role') === 'tab');
  }
  caso('CA-1 la pestaña Flujo se alcanza con Tab', llego);
  if (llego) await pag.keyboard.press('Enter');
  const hayFlujo = llego && await panel(pag).getByRole('group', { name: /tama/i }).count() > 0;
  caso('CA-1 con Enter se abre la vista del flujo, con su selector de tamaño', hayFlujo);
  if (!hayFlujo) { await ctx.close(); return; }

  // CA-2 y CA-21: tres tamaños, el elegido se lee como seleccionado y el flujo cambia.
  const grupo = pag.getByRole('group', { name: /tama/i });
  const texto = {};
  const lista = {};
  for (const n of ['Chica', 'Mediana', 'Grande']) {
    texto[n] = await tamano(pag, n);
    lista[n] = await pasos(pag);
    const marcados = await grupo.getByRole('button').evaluateAll((bs) => bs.filter((b) => ['aria-pressed', 'aria-checked', 'aria-selected'].some((a) => b.getAttribute(a) === 'true')).map((b) => b.textContent.trim()));
    caso(`CA-2/CA-21 ${n} queda marcado como elegido y solo él`, marcados.length === 1 && marcados[0] === n, marcados.join(','));
    await captura(pag, `flujo-${n.toLowerCase()}-escritorio`);
  }
  caso('CA-2 el flujo cambia con el tamaño', new Set(Object.values(lista).map((l) => l.textos.join('|'))).size === 3);

  // CA-3 y CA-4: chica.
  const ch = texto.Chica;
  caso('CA-3 chica: sin líderes de fase', !/Norte|Meridiano/.test(ch) && !/Yunque/.test(ch.replace(/Yunque no participa/g, '')), (ch.match(/.{0,30}(Norte|Meridiano|Yunque(?! no participa)).{0,30}/) || [''])[0]);
  caso('CA-3 chica: entran quien construye y QA, y DevOps solo si se publica', /Front end|Back end/.test(ch) && /QA/.test(ch) && /DevOps[^.]{0,40}solo si se publica|solo si se publica[^.]{0,40}DevOps/i.test(ch));
  caso('CA-3 chica: sin agentes ligeros', /ligeros?\s*:?\s*no\b|sin (agentes )?ligeros|ningún (agente )?ligero/i.test(ch));
  caso('CA-3 chica: los equipos le reportan directo a xi-0', /(reporta|entrega)n?\s+(directo\s+)?a xi-0|le entrega a xi-0/i.test(ch));
  const condiciones = [/un solo lado/i, /contratos/i, /dependencias/i, /pantallas/i, /datos/i, /permisos/i, /corridas largas/i];
  caso('CA-4 chica: dice cuándo es chica', condiciones.every((re) => re.test(ch)), condiciones.filter((re) => !re.test(ch)).join(' '));
  caso('CA-4 chica: si deja de cumplir una condición ya no es chica', /ya no es chica|deja de ser chica/i.test(ch));

  // CA-5 y CA-6: mediana y grande.
  const md = texto.Mediana;
  caso('CA-5 mediana: líder de fase solo con dos o más equipos', /dos o más equipos/i.test(md));
  caso('CA-5 mediana: una fase sin líder recibe de xi-0 y le entrega a xi-0', /sin líder/i.test(md) && /(recibe|reciben) de xi-0/i.test(md) && /entregan? a xi-0|le entregan? a xi-0/i.test(md));
  caso('CA-5 mediana: pasos en paralelo', /paralelo/i.test(md));
  const gr = texto.Grande;
  caso('CA-6 grande: los tres líderes de fase', ['Norte', 'Yunque', 'Meridiano'].every((l) => gr.includes(l)));
  caso('CA-6 grande: proyecto completo o tres fases con dos o más equipos', /proyecto completo/i.test(gr) && /tres fases/i.test(gr) && /dos o más equipos/i.test(gr));

  // CA-7: cada paso dice quién, qué entrega y a quién, y se alcanza con teclado.
  for (const n of ['Chica', 'Mediana', 'Grande']) {
    const l = lista[n];
    caso(`CA-7 ${n}: cada paso dice qué entrega y a quién`, l.textos.length >= 4 && l.textos.every((t) => /entrega/i.test(t) && /a quién|para /i.test(t)), l.textos.find((t) => !/entrega/i.test(t) || !/a quién|para /i.test(t)));
    caso(`CA-7 ${n}: cada paso se alcanza con Tab`, l.enfocables.length > 0 && l.enfocables.every(Boolean));
  }
  await tamano(pag, 'Mediana');
  const sig = pag.getByRole('button', { name: /siguiente/i });
  const ant = pag.getByRole('button', { name: /anterior/i });
  const a0 = (await pasos(pag)).actual;
  await sig.focus(); await pag.keyboard.press('Enter'); await pag.keyboard.press('Enter');
  const a2 = (await pasos(pag)).actual;
  await ant.focus(); await pag.keyboard.press('Enter');
  const a1 = (await pasos(pag)).actual;
  caso('CA-7/CA-21 con teclado se avanza y se retrocede, y el paso actual se lee como actual', a0 >= 0 && a2 === a0 + 2 && a1 === a0 + 1, `${a0} → ${a2} → ${a1}`);
  const focos = [];
  for (const loc of [grupo.getByRole('button', { name: 'Chica', exact: true }), sig]) {
    await loc.focus();
    focos.push(await pag.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none'; }));
  }
  await pag.locator('body').focus();
  for (let i = 0; i < 60; i++) {
    await pag.keyboard.press('Tab');
    if (await pag.evaluate(() => !!document.activeElement.closest('ol li'))) break;
  }
  focos.push(await pag.evaluate(() => { const s = getComputedStyle(document.activeElement); return !!document.activeElement.closest('ol li') && (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none'); }));
  caso('CA-21 foco visible en tamaño, siguiente y paso', focos.every(Boolean), focos.join(','));

  // CA-10 a CA-12: commits y publicación.
  const unico = /(un solo|único) commit|commit único/i;
  const lc = lista.Chica.textos;
  caso('CA-10 chica: sin commit hasta el visto bueno de QA', /sin commit/i.test(ch) && indice(lc, /QA/) >= 0 && indice(lc, /QA/) < indice(lc, unico) && lc.slice(0, indice(lc, unico)).every((t) => !/por unidad/i.test(t)));
  caso('CA-10 chica: quien construyó hace un solo commit con código, pruebas y .xi-0/', /(Front end|Back end)/.test(lc[indice(lc, unico)] || '') && /pruebas/.test(lc[indice(lc, unico)] || '') && /\.xi-0\//.test(lc[indice(lc, unico)] || ''));
  for (const n of ['Mediana', 'Grande']) {
    const l = lista[n].textos;
    caso(`CA-11 ${n}: commits por unidad y, al entregar, xi-0 deja un solo commit`, l.some((t) => /por unidad/i.test(t)) && /xi-0/.test(l[indice(l, unico)] || '') && /un solo commit/i.test(l[indice(l, unico)] || ''));
  }
  for (const n of ['Chica', 'Mediana', 'Grande']) {
    const l = lista[n].textos, pub = indice(l, /publica la rama/i);
    caso(`CA-12 ${n}: se publica después del commit único y del visto bueno de QA`, pub > indice(l, unico) && indice(l, unico) > indice(l, /QA/) && indice(l, /QA/) >= 0, `qa ${indice(l, /QA/)}, commit ${indice(l, unico)}, publica ${pub}`);
  }
  caso('CA-12 el visto bueno de Seguridad cuando entra', /Seguridad cuando entra|visto bueno de Seguridad/i.test(md));

  // CA-13 y CA-14: relevo, en orden.
  for (const n of ['Mediana', 'Grande']) {
    const t = texto[n], i1 = t.search(/\.xi-0\/relevo\//), i2 = t.indexOf('cierra', i1), i3 = t.search(/vigía/i), i4 = t.search(/agente nuevo|otro agente|otro QA/i);
    caso(`CA-13 ${n}: relevo en cuatro etapas, en orden`, i1 >= 0 && i1 < i2 && i2 < i3 && i3 < i4, `${i1} ${i2} ${i3} ${i4}`);
    caso(`CA-13 ${n}: sigue desde "al terminar" o diagnostica si venció el tope`, /al terminar/.test(t) && /tope/.test(t) && /diagnostica/i.test(t));
    caso(`CA-14 ${n}: cuándo aplica y que los ligeros no dejan relevo`, /4 minutos/.test(t) && /ligeros no dejan relevo/i.test(t));
  }

  // CA-8 y CA-9: textos.
  await pestana(pag, 'Mapa');
  const tipo = await pag.getByRole('button', { name: 'Corrección', exact: true }).evaluate((b) => {
    const g = b.closest('[role=group]');
    const nombre = g ? (g.getAttribute('aria-label') || [...(g.getAttribute('aria-labelledby') || '').split(' ')].map((id) => (document.getElementById(id) || {}).textContent || '').join(' ')) : '';
    return nombre + ' | ' + (g ? g.innerText : '');
  });
  caso('CA-8 el selector de tipo no se rotula como tamaño', !/tama/i.test(tipo), tipo);
  await pestana(pag, 'Explicación');
  const exp = (await panel(pag).innerText()).replace(/\s+/g, ' ');
  await pestana(pag, 'Límite');
  const lim = (await panel(pag).innerText()).replace(/\s+/g, ' ');
  await pestana(pag, 'Mapa');
  await pag.getByRole('button', { name: 'Ramas y PRs' }).click();
  const todo = [exp, lim, (await pag.locator('body').innerText()).replace(/\s+/g, ' ')].join(' ');
  const contra = [/une su rama/i, /propio worktree y su propia rama/i, /líderes de fase unen las ramas/i, /commits wip en commits limpios/i, /van en segundo plano/i];
  caso('CA-9 ningún texto contradice §9 (ramas por equipo, unir ramas, limpiar wip, segundo plano)', contra.every((re) => !re.test(todo)), contra.filter((re) => re.test(todo)).map((re) => (todo.match(new RegExp('.{0,50}' + re.source + '.{0,30}', 'i')) || [''])[0]).join(' || '));
  caso('CA-9 no negociables: si Yunque no participa, publica DevOps; commit único; relevo', /si Yunque no participa[^.]*DevOps/.test(exp) && /un solo commit/.test(exp) && /relevo/.test(exp));
  const ligeros = todo.split(/(?<=\.)\s/).filter((o, i, a) => /ligero/i.test((a[i - 1] || '') + o) && /deja un relevo/i.test(o) && !/no dejan relevo|ligeros no/i.test(o));
  caso('CA-9 ningún texto dice que un agente ligero deja relevo (§9 l. 792)', ligeros.length === 0, ligeros.join(' || '));
  await pag.getByRole('button', { name: 'Comunicación' }).click();

  // CA-22: lo que ya existía.
  await pag.getByRole('button', { name: /^Producto, líder/ }).click();
  await pag.waitForTimeout(900);
  caso('CA-22 tocar un nodo abre su detalle', await pag.getByRole('heading', { name: /Producto, líder Brújula/ }).isVisible());
  await pag.getByRole('button', { name: 'Ver todo el mapa' }).click();
  await pag.waitForTimeout(900);
  await pag.getByRole('button', { name: /^QA, líder/ }).click();
  await pag.waitForTimeout(900);
  const qa = await pag.locator('body').innerText();
  caso('CA-9 el detalle de un equipo no dice que tiene rama propia', !/La suya propia/.test(qa));
  await pag.getByRole('button', { name: 'Ver todo el mapa' }).click();
  await pag.waitForTimeout(900);
  const n0 = await caja(pag, /^Producto, líder/);
  await pag.getByRole('button', { name: 'Acercar' }).click(); await pag.waitForTimeout(900);
  const n1 = await caja(pag, /^Producto, líder/);
  await pag.getByRole('button', { name: 'Alejar' }).click(); await pag.waitForTimeout(900);
  const n2 = await caja(pag, /^Producto, líder/);
  caso('CA-22 zoom con botones', n1.width > n0.width * 1.05 && n2.width < n1.width * 0.95, `${n0.width} ${n1.width} ${n2.width}`);
  const mapa = await pag.getByRole('group', { name: 'Mapa de agentes de xi-0' }).boundingBox();
  await pag.mouse.move(mapa.x + 60, mapa.y + 60); await pag.mouse.wheel(0, -400); await pag.waitForTimeout(400);
  const n3 = await caja(pag, /^Producto, líder/);
  caso('CA-22 zoom con la rueda', Math.abs(n3.width - n2.width) > 2, `${n2.width} → ${n3.width}`);
  await pag.mouse.move(mapa.x + 60, mapa.y + 60); await pag.mouse.down(); await pag.mouse.move(mapa.x + 200, mapa.y + 140, { steps: 8 }); await pag.mouse.up();
  await pag.waitForTimeout(300);
  const n4 = await caja(pag, /^Producto, líder/);
  caso('CA-22 arrastre', Math.abs(n4.x - n3.x) > 50, `${n3.x} → ${n4.x}`);
  await pag.getByRole('button', { name: 'Ramas y PRs' }).click();
  caso('CA-22 vista Ramas y PRs', await pag.getByText('rama de la tarea').first().isVisible());
  await pag.getByRole('button', { name: 'Comunicación' }).click();
  const f = pag.getByRole('button', { name: 'Fallas devueltas' });
  await f.click();
  caso('CA-22 filtros de líneas', (await f.getAttribute('aria-pressed')) === 'false');
  await f.click();
  await pag.getByLabel('Quién puede').selectOption({ index: 1 });
  caso('CA-22 "Quién puede"', await pag.getByRole('heading', { name: /Quién puede/ }).isVisible());
  await pag.waitForTimeout(1200);
  const r2 = await reposo(pag);
  caso('CA-16 después de interactuar, el movimiento termina solo', r2.animaciones === 0 && r2.cuadros === 0, JSON.stringify(r2));
  await pestana(pag, 'Explicación');
  const secciones = ['Políticas por nivel', 'No negociables', 'Negociables', 'Rutas obligatorias', 'Ramas y PRs', 'Herramientas por equipo', 'Fases y equipos'];
  const faltan = [];
  for (const s of secciones) if (!(await panel(pag).getByRole('heading', { name: s, exact: true }).isVisible())) faltan.push(s);
  caso('CA-22 pestaña Explicación con sus secciones', faltan.length === 0, faltan.join(', '));
  await pestana(pag, 'Límite');
  await pag.getByLabel('Simular uso').fill('90');
  const l90 = await panel(pag).innerText();
  caso('CA-22 pestaña Límite: la barra cambia el nivel', /90%/.test(l90) && /Guardado/.test(l90) && /punto de guardado/i.test(l90));
  for (const t of ['Flujo', 'Explicación', 'Límite']) {
    await pestana(pag, t); await pag.waitForTimeout(500);
    const r3 = await reposo(pag, 1000);
    caso(`CA-18 en reposo en ${t}`, r3.animaciones === 0 && r3.cuadros === 0 && r3.smil === 0, JSON.stringify(r3));
  }
  caso('sin errores de la página', errores.length === 0, errores.join(' | '));
  await ctx.close();

  // CA-17: con movimiento reducido, los cambios ocurren sin animación.
  const rm = await abrir(nav, { reducedMotion: 'reduce' });
  await rm.pag.waitForTimeout(300);
  await rm.pag.getByRole('button', { name: /^Producto, líder/ }).click();
  const tras = await rm.pag.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(document.getAnimations().length))));
  const c1 = await caja(rm.pag, /^Producto, líder/);
  await rm.pag.waitForTimeout(900);
  const c2 = await caja(rm.pag, /^Producto, líder/);
  caso('CA-17 con movimiento reducido, tocar un nodo no anima nada', tras === 0 && Math.abs(c1.x - c2.x) < 1 && Math.abs(c1.width - c2.width) < 1, `animaciones ${tras}, ${c1.x}→${c2.x}`);
  await pestana(rm.pag, 'Flujo');
  await rm.pag.getByRole('button', { name: /siguiente/i }).click();
  const tras2 = await rm.pag.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(document.getAnimations().length))));
  caso('CA-17 con movimiento reducido, avanzar de paso no anima nada', tras2 === 0, String(tras2));
  await rm.ctx.close();

  // CA-23: abierto como archivo local y sin red, el flujo sigue usable.
  const sr = await abrir(nav, { offline: true });
  await pestana(sr.pag, 'Flujo');
  await tamano(sr.pag, 'Grande');
  await sr.pag.getByRole('button', { name: /siguiente/i }).click();
  const pasoSinRed = await sr.pag.locator('[aria-current=step]').count();
  caso('CA-23 sin red, el flujo se abre y se recorre', pasoSinRed === 1 && sr.errores.length === 0, `pasos actuales ${pasoSinRed}; ${sr.errores.join(' | ')}`);
  await sr.ctx.close();

  // CA-19 y CA-20: anchos, temas y contraste.
  for (const [w, h, tema] of [[360, 740, 'light'], [360, 740, 'dark'], [1280, 800, 'dark']]) {
    const v = await abrir(nav, { viewport: { width: w, height: h }, colorScheme: tema, ...(w < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    for (const t of ['Mapa', 'Explicación', 'Límite']) {
      await pestana(v.pag, t);
      const a = await ancho(v.pag);
      caso(`CA-19 ${w} px ${tema}, ${t}: sin desplazamiento horizontal`, !a.desborda, JSON.stringify(a));
    }
    await pestana(v.pag, 'Flujo');
    for (const n of ['Chica', 'Mediana', 'Grande']) {
      await tamano(v.pag, n);
      const a = await ancho(v.pag);
      caso(`CA-19 ${w} px ${tema}, Flujo ${n}: sin desplazamiento horizontal ni textos cortados`, !a.desborda && a.fuera.length === 0, JSON.stringify(a));
      const c = await contraste(v.pag);
      notas.push(`contraste más bajo ${w} px ${tema} ${n}: ${c.r.toFixed(2)} (mínimo ${c.min}) en "${c.texto}"`);
      caso(`CA-20 ${w} px ${tema}, Flujo ${n}: contraste suficiente`, c.r >= c.min, `${c.r.toFixed(2)} < ${c.min} en "${c.texto}"`);
      if (n === 'Mediana' || w < 500) await captura(v.pag, `flujo-${n.toLowerCase()}-${w}-${tema}`);
    }
    if (w < 500) { await pestana(v.pag, 'Mapa'); await captura(v.pag, `mapa-${w}-${tema}`); }
    caso(`sin errores de la página (${w} px ${tema})`, v.errores.length === 0, v.errores.join(' | '));
    await v.ctx.close();
  }
}

(async () => {
  let omitida = '';
  const nav = chromium ? await navegador() : null;
  if (!nav) omitida = chromium ? 'no encontré Chrome ni Edge' : 'falta playwright-core en ~/.claude/xi-0/qa-visual';
  else {
    try { await enNavegador(nav); } catch (e) { caso('la prueba en navegador terminó', false, `${e.message.split('\n')[0]} (después de "${ultimo}")`); }
    await nav.close();
  }
  console.log(notas.map((n) => 'nota   ' + n).join('\n'));
  if (omitida) console.log(`OMITIDA la parte en navegador: ${omitida}.`);
  if (fallas.length) {
    console.log(fallas.map((f) => 'FALLA  ' + f).join('\n'));
    console.log(`\n${total - fallas.length} de ${total} comprobaciones bien (${path.basename(archivo)}).`);
    process.exit(1);
  }
  console.log(`${total} de ${total} comprobaciones bien (${path.basename(archivo)}).`);
})();
