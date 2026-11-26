#!/usr/bin/env node
// Guardián de xi-0: un solo script para todos los hooks de la sección 11.
// Lee el evento por stdin y decide según quién llama (agent_type) y la config del proyecto.
// Sin config del proyecto no hace nada. Sin .claude/xi-0/activa.json solo aplica la regla de remotos.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..'); // la carpeta xi-0 donde está instalado (normalmente ~/.claude/xi-0)
// Si equipos.json no se puede leer, el error se guarda y se trata al recibir el evento (ver fallar).
let EQ = { fases: {}, equipos: {}, palabras_max: {} };
let errorCarga = null;
try { EQ = JSON.parse(fs.readFileSync(path.join(BASE, 'equipos.json'), 'utf8')); } catch (err) { errorCarga = err; }
const LIDERES_FASE = Object.keys(EQ.fases);
const EQUIPOS = Object.keys(EQ.equipos);
const TODOS_LIDERES = [...LIDERES_FASE, ...EQUIPOS];

// ---------- utilidades ----------
// En Windows acepta también rutas estilo Git Bash (/d/carpeta → D:/carpeta).
const win = (p) => (process.platform === 'win32' ? String(p).replace(/^\/([a-zA-Z])(\/|$)/, (_, l) => `${l.toUpperCase()}:/`) : String(p));
const norm = (p) => path.resolve(win(p)).replace(/\\/g, '/').replace(/\/+$/, '');
const leer = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function negar(motivo) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[xi-0] ${motivo}` },
  }));
  registrar({ decision: 'deny', motivo });
  process.exit(0);
}
function frenar(motivo) { // TaskCreated / TaskCompleted / SubagentStop: exit 2 con stderr
  process.stderr.write(`[xi-0] ${motivo}\n`);
  registrar({ decision: 'block', motivo });
  process.exit(2);
}
function pasar() { process.exit(0); }

let ctx = { raiz: null, evento: null, quien: null };
function registrar(extra) {
  if (!ctx.raiz) return;
  try {
    fs.appendFileSync(path.join(ctx.raiz, '.claude', 'xi-0', 'registro.jsonl'),
      JSON.stringify({ t: new Date().toISOString(), evento: ctx.evento, quien: ctx.quien, herramienta: ctx.herramienta, ...extra, sesion: ctx.sesion }) + '\n');
  } catch { /* el registro nunca debe romper el hook */ }
}

function globARegex(g) {
  let r = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { // **/ o ** al final
        i++;
        if (g[i + 1] === '/') { i++; r += '(?:.*/)?'; } else r += '.*';
      } else r += '[^/]*';
    } else if (c === '?') r += '[^/]';
    else if (c === '{') { const fin = g.indexOf('}', i); r += '(?:' + g.slice(i + 1, fin).split(',').map(escapar).join('|') + ')'; i = fin; }
    else r += escapar(c);
  }
  return new RegExp('^' + r + '$', 'i');
}
function escapar(s) { return s.replace(/[.+^$()|[\]\\]/g, '\\$&'); }
const coincide = (rel, globs) => (globs || []).some((g) => globARegex(g).test(rel));

// Raíz del repo principal (aunque estemos en un worktree).
function raizPrincipal(cwd) {
  try {
    const comun = execFileSync('git', ['-C', win(cwd), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return norm(path.dirname(comun));
  } catch { return raizSinGit(cwd); }
}
// Si git no responde (por ejemplo "dubious ownership" en una carpeta de otro dueño), la raíz se busca
// leyendo .git: sin esto el guardián no encontraba la config y dejaba pasar todo.
function raizSinGit(cwd) {
  try {
    const wt = raizWorktree(path.join(win(cwd), 'x'));
    if (!wt) return null;
    const punto = path.join(wt, '.git');
    if (fs.statSync(punto).isDirectory()) return wt;
    const gitdir = path.resolve(wt, fs.readFileSync(punto, 'utf8').match(/^gitdir:\s*(.+)$/m)[1].trim());
    let comun = gitdir;
    try { comun = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch { /* no es un worktree */ }
    return norm(path.dirname(comun));
  } catch { return null; }
}
// Raíz del worktree que contiene un archivo (sube hasta encontrar .git, archivo o carpeta).
function raizWorktree(archivo) {
  let d = path.dirname(path.resolve(win(archivo)));
  while (true) {
    if (fs.existsSync(path.join(d, '.git'))) return norm(d);
    const padre = path.dirname(d);
    if (padre === d) return null;
    d = padre;
  }
}

function nivelLimite(raiz) {
  const l = leer(path.join(raiz, '.claude', 'limite.json'));
  if (!l) return { nivel: 'normal', pct: null };
  const ahora = Date.now() / 1000;
  const cinco = l.five_hour && l.five_hour.resets_at > ahora ? l.five_hour.used_percentage : 0;
  const siete = l.seven_day && l.seven_day.resets_at > ahora ? l.seven_day.used_percentage : 0;
  const pct = Math.max(cinco || 0, siete >= EQ.limite.pausa ? siete : 0);
  const n = pct >= EQ.limite.pausa ? 'pausa' : pct >= EQ.limite.guardado ? 'guardado' : pct >= EQ.limite.ahorro ? 'ahorro' : 'normal';
  return { nivel: n, pct };
}

// Quién llama: xi-0 (sesión principal), un líder, un ligero (<equipo>-ligero) o desconocido.
function identificar(agentType) {
  if (!agentType) return { rol: 'xi-0', equipo: 'xi-0' };
  if (LIDERES_FASE.includes(agentType)) return { rol: 'fase', equipo: agentType };
  if (EQUIPOS.includes(agentType)) return { rol: 'equipo', equipo: agentType };
  const m = /^(.+)-ligero$/.exec(agentType);
  if (m && EQUIPOS.includes(m[1])) return { rol: 'ligero', equipo: m[1] };
  return { rol: 'desconocido', equipo: agentType };
}

// ---------- reglas ----------
// Reglas 4: .xi-0/ es el rastro de trabajo de la tarea. Viaja en los commits de la rama mientras se trabaja
// (lo leen los worktrees paralelos y la reanudación), pero no entra en el commit único ni en lo que se publica:
// un PR unido tal cual lo dejaba en main del proyecto.
const reglasRastro = (activa) => Number((activa || {}).reglas) >= 4;
const SIN_RASTRO = 'Al entregar, xi-0 archiva .xi-0/ fuera del repo y lo saca del commit único (git rm -r -q --cached .xi-0 antes del commit; en una chica, git add -A -- . ":!.xi-0").';
function reglaRastroEnRama(cfg, raiz, rama, activa) {
  const base = cfg.rama_base || 'main';
  const donde = rama === 'HEAD' && activa.worktree_tarea ? win(activa.worktree_tarea) : win(raiz);
  let salida = '';
  try {
    salida = execFileSync('git', ['-c', 'core.quotepath=false', '-C', donde, 'diff', '--name-only', `${base}...${rama}`, '--', '.xi-0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return; } // la rama o la base no existen aquí: esta regla no bloquea por eso
  const archivos = salida.split('\n').filter(Boolean);
  if (archivos.length) negar(`La rama ${rama} trae .xi-0/ (${archivos.length} archivos, por ejemplo ${archivos[0]}): el rastro de la tarea no se publica. ${SIN_RASTRO}`);
}
// La carpeta donde corre cada pieza: sigue los cd del comando y el -C de git. Es lectura de texto, como el
// resto de la regla: un cd dentro de $( ) o de un script no se sigue.
function carpetasDePiezas(lista, inicio) {
  let dir = inicio;
  const ir = (desde, a) => path.resolve(win(desde), win(a.replace(/^~(?=[\/\\]|$)/, os.homedir())));
  return lista.map((p) => {
    if (/^(cd|pushd|Set-Location|sl)$/i.test(p[0] || '')) {
      const destino = p.slice(1).filter((t) => !/^-/.test(t)).join(' '); // una ruta con espacios sin comillas
      dir = destino ? ir(dir, destino) : os.homedir();
      return dir;
    }
    const i = indicePrograma(p, esGit);
    if (i >= 0) {
      for (let j = i + 1; j < p.length && p[j].startsWith('-'); j += /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)$/.test(p[j]) ? 2 : 1)
        if (p[j] === '-C' && p[j + 1]) return ir(dir, p[j + 1]);
    }
    return dir;
  });
}
const leerConfig = (r) => JSON.parse(fs.readFileSync(path.join(r, '.claude', 'xi-0', 'config.json'), 'utf8').replace(String.fromCharCode(0xFEFF), ''));
function leerActiva(r) {
  const archivo = path.join(r, '.claude', 'xi-0', 'activa.json');
  const a = leer(archivo);
  if (!a && fs.existsSync(archivo)) throw new Error(`${archivo} existe pero no se puede leer`);
  return a;
}
// Un git o gh que actúa en otro repo con xi-0 activado (cd <repo> && gh pr create …, git -C <repo> push …)
// se juzga con la config y la tarea de ese repo. Si el otro repo no tiene config, con las del repo de la sesión,
// como siempre: así salirse del repo nunca afloja la regla.
function reglaRemotosPorRepo(cfg, quien, comando, activa, raiz, cwd) {
  const lista = expandirVariables(piezas(comando));
  const carpetas = carpetasDePiezas(lista, cwd || raiz);
  const grupos = new Map([[raiz, []]]);
  const repoDe = {};
  lista.forEach((p, i) => {
    let r = raiz;
    if (subcomandoGit(p) || subcomandoGh(p)) {
      const d = norm(carpetas[i]);
      if (repoDe[d] === undefined) {
        const otro = fs.existsSync(win(d)) ? raizPrincipal(d) : null;
        repoDe[d] = otro && otro !== raiz && fs.existsSync(path.join(otro, '.claude', 'xi-0', 'config.json')) ? otro : raiz;
      }
      r = repoDe[d];
    }
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(p);
  });
  for (const [r, ps] of grupos) {
    if (r === raiz) reglaRemotos(cfg, quien, ps, activa, raiz);
    else reglaRemotos(leerConfig(r), quien, ps, leerActiva(r), r);
  }
}
function reglaRemotos(cfg, quien, lista, activa, raiz) {
  const r = cfg.remoto || {};
  // Quién sube la rama y abre el PR: Yunque; si no está activo en la tarea (reglas 3), Faro (el líder, no sus ligeros).
  const sinYunque = Number((activa || {}).reglas) >= 3 && Array.isArray(activa.fases) && !activa.fases.includes('yunque');
  const publica = sinYunque ? 'faro' : 'yunque';
  const Publica = sinYunque ? 'Faro' : 'Yunque';
  const esQuienPublica = quien.equipo === publica && quien.rol !== 'ligero';
  const protegidas = new Set(['main', 'master', cfg.rama_base].filter(Boolean));
  for (const p of lista) {
    const g = subcomandoGit(p);
    if (g && g.sub === 'push') {
      if (!r.push) negar('git push está desactivado en este proyecto (remoto.push=false). El trabajo se queda en ramas locales.');
      const opciones = g.args.filter((a) => a.startsWith('-'));
      const [remoto, ...ramas] = g.args.filter((a) => !a.startsWith('-'));
      if (!r.remote_permitido || remoto !== r.remote_permitido || opciones.some((o) => /^--repo\b/.test(o)))
        negar(`Solo se permite push al remoto "${r.remote_permitido}", escrito así: git push ${r.remote_permitido || '<remoto>'} tarea/<id>. Nunca al repo original.`);
      if (!esQuienPublica && quien.equipo !== 'xi-0') negar(`Solo ${Publica} sube la rama de la tarea (y abre su único PR).`);
      const destinos = ramas.map((x) => x.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, ''));
      if (destinos.some((d) => protegidas.has(d))) negar('Nunca push a main/master: se sube la rama tarea/<id> y se abre un PR.');
      if (opciones.some((o) => /^--force/.test(o) || /^-[a-zA-Z]*f/.test(o)) || ramas.some((x) => x.startsWith('+'))) negar('Nada de push forzado.');
      if (!ramas.length || opciones.some((o) => /^--(all|mirror|branches)$/.test(o)))
        negar(`El push nombra la rama que sube: git push ${r.remote_permitido} tarea/<id>. Sin rama, o con --all o --mirror, podría subir main.`);
      if (reglasRastro(activa)) for (const x of ramas) reglaRastroEnRama(cfg, raiz, x.replace(/^\+/, '').split(':')[0] || 'HEAD', activa);
    }
    const gh = subcomandoGh(p);
    if (gh === 'create') {
      if (!r.pr) negar('No se abren PRs reales en este proyecto (remoto.pr=false). Yunque deja el PR en .xi-0/PR.md.');
      // Sin tarea abierta no hay Yunque ni Faro: la sesión principal abre el PR de su propia rama (mantenimiento).
      const mantenimiento = !activa && quien.rol === 'xi-0';
      if (!esQuienPublica && !mantenimiento) negar(`Solo ${Publica} abre el PR de la tarea.`);
      // repo_pr puede ser uno ("yo/fork") o una lista, cuando el proyecto abre PRs en repos hermanos.
      const repos = [].concat(r.repo_pr || []).map((x) => String(x).toLowerCase());
      const destino = repoDestino(p);
      if (!repos.length || !destino || !repos.some((x) => destino === x || destino.endsWith(`github.com/${x}`)))
        negar(`gh pr create debe llevar -R ${repos.join(' o ') || '<fork configurado>'}.`);
      if (reglasRastro(activa)) {
        const h = p.findIndex((t) => /^(-H|--head)$/.test(t));
        const cabeza = h >= 0 ? p[h + 1] : ((p.find((t) => t.startsWith('--head=')) || '').slice(7) || activa.rama);
        if (cabeza) reglaRastroEnRama(cfg, raiz, cabeza.replace(/^[^:]+:/, ''), activa);
      }
    }
    if (gh === 'merge') {
      if (!r.merge) negar('El merge está desactivado (remoto.merge=false). El usuario une el PR.');
      if (quien.equipo !== 'faro') negar('Solo DevOps (Faro) une a main.');
    }
  }
}

// Parte un comando en piezas, y cada pieza en palabras, respetando comillas como lo hace el shell:
// "git push" entre comillas es una sola palabra (un texto), pero git push fork "main" son cuatro.
// Separan piezas: ; & | salto de línea, paréntesis, $( ... ) y comillas invertidas, también dentro de comillas dobles.
// Lo que se le pasa a otro shell (bash -c "...", eval "...") se revisa también por dentro.
// La usa la regla de remotos, que no puede depender de cómo esté escrito el comando.
const ES_SHELL = /(^|[\/\\])(bash|sh|zsh|dash|eval|pwsh|powershell|cmd|wsl)(\.exe)?$/i;
function piezas(comando, nivel = 0) {
  const texto = String(comando).replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(\n|$)/g, '\n');
  const salida = [];
  const pila = []; // comillas en las que estábamos al entrar a $( ... ) o a comillas invertidas
  let pieza = []; let palabra = null; let comilla = null; let invertidas = false;
  const cierraPalabra = () => { if (palabra !== null) { pieza.push(palabra); palabra = null; } };
  const cierraPieza = () => { cierraPalabra(); if (pieza.length) salida.push(pieza); pieza = []; };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comilla === "'") { if (c === "'") comilla = null; else palabra += c; continue; }
    // Dentro de comillas dobles la barra invertida solo escapa $ ` " \ y el salto de línea ("C:\Program Files\Git\bin\git.exe").
    if (c === '\\' && i + 1 < texto.length && (comilla !== '"' || '$`"\\\n'.includes(texto[i + 1]))) { i++; if (texto[i] !== '\n') palabra = (palabra || '') + texto[i]; continue; }
    if (c === '$' && texto[i + 1] === '(') { i++; cierraPieza(); pila.push(comilla); comilla = null; continue; }
    if (c === '`') {
      cierraPieza();
      if (invertidas) { comilla = pila.pop() || null; invertidas = false; } else { pila.push(comilla); comilla = null; invertidas = true; }
      continue;
    }
    if (comilla === '"') { if (c === '"') comilla = null; else palabra = (palabra || '') + c; continue; }
    if (c === "'" || c === '"') { comilla = c; palabra = palabra || ''; continue; }
    if (c === ')' && pila.length && !invertidas) { cierraPieza(); comilla = pila.pop() || null; continue; }
    if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')') { cierraPieza(); continue; }
    if (/\s/.test(c)) { cierraPalabra(); continue; }
    palabra = (palabra || '') + c;
  }
  cierraPieza();
  if (nivel < 3) {
    for (const p of [...salida]) {
      if (p.some((t) => ES_SHELL.test(t))) for (const t of p) if (/\s/.test(t)) salida.push(...piezas(t, nivel + 1));
    }
  }
  return salida;
}
// Un comando guardado en una variable (G="git -C ."; $G push fork main) se revisa con su valor:
// las asignaciones del mismo comando se sustituyen donde aparece $G o ${G}.
// Una variable que no se asignó ahí (viene del entorno) no se puede saber: subcomandoGit y subcomandoGh
// la tratan como un posible git o gh.
const VARIABLE = /^\$(?:(\w+)|\{(\w+)(?:[:\-=+?][^}]*)?\})$/; // $G, ${G} y ${G:-git}
function expandirVariables(lista) {
  const valores = {};
  return lista.map((p) => {
    const salida = [];
    let inicio = true; // las asignaciones solo cuentan antes del comando (o tras export)
    for (const t of p) {
      const a = /^(\w+)=([\s\S]*)$/.exec(t);
      if (a && (inicio || salida[salida.length - 1] === 'export')) { valores[a[1]] = a[2]; salida.push(t); continue; }
      const v = VARIABLE.exec(t);
      const nombre = v && (v[1] || v[2]);
      // Un valor que es una ruta que existe ("D:/Git Projects/app") queda en una palabra; si no, se parte como un comando.
      if (nombre && valores[nombre] !== undefined) {
        const val = valores[nombre];
        if (/\s/.test(val) && /[\/\\]/.test(val) && fs.existsSync(win(val))) salida.push(val);
        else salida.push(...val.split(/\s+/).filter(Boolean));
      } else salida.push(t);
      if (t !== 'export') inicio = false;
    }
    return salida;
  });
}
const esGit = (t) => /(^|[\/\\])git(\.exe)?$/i.test(t);
const esGh = (t) => /(^|[\/\\])gh(\.exe)?$/i.test(t);
// Índice del programa en la pieza; si no aparece por nombre, una variable sin valor conocido puede serlo.
function indicePrograma(p, es) {
  const i = p.findIndex(es);
  return i >= 0 ? i : p.findIndex((t) => VARIABLE.test(t));
}
// El repo que nombra un gh: -R dueño/repo, --repo dueño/repo o --repo=dueño/repo (en minúsculas, sin .git).
function repoDestino(p) {
  for (let i = 0; i < p.length; i++) {
    const m = /^--repo=(.+)$/.exec(p[i]);
    const v = m ? m[1] : /^(-R|--repo)$/.test(p[i]) ? p[i + 1] : null;
    if (v) return v.toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
  }
  return null;
}
// El subcomando de git de una pieza, esté donde esté (env git …, xargs git …, git -C . push …).
function subcomandoGit(p) {
  const i = indicePrograma(p, esGit);
  if (i < 0) return null;
  let j = i + 1;
  while (j < p.length && p[j].startsWith('-')) j += /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)$/.test(p[j]) ? 2 : 1;
  return { sub: p[j] || '', args: p.slice(j + 1) };
}
// 'create' o 'merge' si la pieza es un gh pr create o gh pr merge.
function subcomandoGh(p) {
  const i = indicePrograma(p, esGh);
  if (i < 0) return null;
  const resto = p.slice(i + 1);
  const k = resto.indexOf('pr'); // puede llevar opciones antes: gh -R dueño/repo pr create
  if (k < 0) return null;
  const sub = resto.slice(k + 1).find((t) => !t.startsWith('-'));
  return ['create', 'merge'].includes(sub) ? sub : null;
}

// Quita cuerpos de heredoc y el contenido entre comillas para no confundir texto con comandos.
// Se recorre de izquierda a derecha: manda la comilla que abre primero, así un apóstrofo dentro de
// comillas dobles ("don't") no se toma por el comienzo de otra cadena.
function limpiar(comando) {
  const t = comando.replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\s*(\n|$)/g, '<<HEREDOC\n');
  let salida = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && i + 1 < t.length) { salida += c + t[++i]; continue; } // \' y \" no abren cadena
    if (c !== "'" && c !== '"') { salida += c; continue; }
    let j = i + 1;
    while (j < t.length && t[j] !== c) j += c === '"' && t[j] === '\\' ? 2 : 1;
    if (j >= t.length) { salida += t.slice(i); break; } // comilla sin cerrar: se deja como está
    salida += c + c;
    i = j;
  }
  return salida;
}

// Parte un comando en piezas simples: separa && || ; | y saltos de línea, quita cd y variables iniciales.
// Un comando que mete otro dentro (bash -c, sh -c, eval, powershell -c) se revisa también por dentro.
function segmentos(comando) {
  const internos = [];
  for (const m of comando.matchAll(/\b(?:bash|sh|eval|powershell|pwsh)(?:\s+-\w+)*\s+(['"])([\s\S]*?)\1/g)) internos.push(...segmentos(m[2]));
  return limpiar(comando).split(/&&|\|\||;|\||\n/).map((s) => s.trim())
    .map((s) => s.replace(/^(\w+=("[^"]*"|'[^']*'|\S+)\s+)+/, ''))
    .map((s) => s.replace(/^(GIT_CONFIG_\w+=\S+\s+)+/, ''))
    .map((s) => s.replace(/^((time(\s+-p)?|nohup|timeout\s+\d+[smh]?)\s+)+/, '')) // envoltorios: se revisa lo que envuelven
    // Redirecciones que no escriben ningún archivo (2>&1, >/dev/null): sin esto una expresión terminada en $ nunca coincide.
    .map((s) => s.replace(/\s*(?:\d*>&\d+|&>>?\s*\/dev\/null|\d*>>?\s*\/dev\/null)(?=\s|$)/g, '').trim())
    // Una asignación sola (F="ruta") no ejecuta nada. Con $( ) dentro no entra aquí y se sigue revisando.
    .filter((s) => !/^\w+=(""|''|[^\s$`()]*)$/.test(s))
    .filter((s) => s && !/^cd\s/.test(s) && !/^(echo|true|exit)\b/.test(s))
    .concat(internos);
}

// La caché de compañeros y ligeros vence a los 5 min: una llamada que espera más hace que el turno
// siguiente vuelva a escribir todo el contexto (en una tarea real medida, el 25% del costo).
// Se mira el comando crudo, porque las esperas suelen ir entre comillas (python -c "...time.sleep(299)").
const ESPERA_MAX_S = 240;
const RELEVO_MIN = 10;
function relevoReciente(equipo, raices) {
  return raices.filter(Boolean).some((r) => {
    try { return Date.now() - fs.statSync(path.join(win(r), '.xi-0', 'relevo', `${equipo}.md`)).mtimeMs < RELEVO_MIN * 60000; } catch { return false; }
  });
}
function reglaEsperas(quien, ti, activa, raices) {
  if (quien.rol === 'xi-0') return;
  const cmd = String(ti.command || '');
  // Con reglas 3: quien deja una corrida en segundo plano escribe antes su relevo, para que otro agente
  // pueda retomar el trabajo. A un ligero nadie le entrega el aviso de segundo plano: usa nohup.
  if (Number((activa || {}).reglas) >= 3) {
    const desprendida = ti.run_in_background || /(^|[;&|(\n])\s*nohup\s/.test(cmd);
    if (quien.rol === 'ligero' && ti.run_in_background)
      negar('Un ligero no usa segundo plano: nadie recibe el aviso. Lanza la corrida con nohup y salida a archivo, y devuelve la ruta de ese archivo.');
    // Reglas 4: tampoco un líder de equipo. En una tarea real, varios lanzaron la verificación en segundo plano
    // y se quedaron parados esperando un aviso que a un compañero no le llega.
    if (Number(activa.reglas) >= 4 && quien.rol === 'equipo' && ti.run_in_background)
      negar(`No uses segundo plano: a un compañero no le llega el aviso de que terminó y te quedarías parado. Si tarda menos de 10 min, córrelo en primer plano con timeout hasta 600000. Si tarda más, escribe .xi-0/relevo/${quien.equipo}.md, lánzalo con nohup <comando> > <archivo> 2>&1 & y cierra tu turno: xi-0 vigila el archivo y lanza tu relevo.`);
    if (quien.rol === 'equipo' && desprendida && !relevoReciente(quien.equipo, raices))
      negar(`Antes de dejar una corrida en segundo plano escribe .xi-0/relevo/${quien.equipo}.md (qué lanzaste, "resultado: <archivo>" y "tope: <hora>"). Vale por ${RELEVO_MIN} min.`);
  }
  if (ti.run_in_background) return;
  const seg = [];
  // sleep como comando (inicio, tras ; & | ( o do/then), no dentro de un texto como un mensaje de commit
  for (const m of cmd.matchAll(/(?:^|[;&|(\n]|\bdo|\bthen)\s*sleep\s+(\d+(?:\.\d+)?)([smh]?)\b/g)) seg.push(+m[1] * ({ m: 60, h: 3600 }[m[2]] || 1));
  for (const m of cmd.matchAll(/\btime\.sleep\(\s*(\d+(?:\.\d+)?)/g)) seg.push(+m[1]);
  for (const m of cmd.matchAll(/Start-Sleep\s+(?:-s(?:econds)?\s+)?(\d+)/gi)) seg.push(+m[1]);
  for (const m of cmd.matchAll(/Start-Sleep\s+-m(?:illiseconds)?\s+(\d+)/gi)) seg.push(+m[1] / 1000);
  for (const m of cmd.matchAll(/\btimeout\s+\/t\s+(\d+)/gi)) seg.push(+m[1]);
  if (!seg.length && !/Wait-Process|\btail\s+-f\b|Get-Content\b[^|;]*-Wait/i.test(cmd)) return;
  const tope = Number(ti.timeout) || 120000;
  if (Math.max(0, ...seg) > ESPERA_MAX_S || tope > (ESPERA_MAX_S + 30) * 1000) {
    const forma = Number((activa || {}).reglas) >= 4
      ? 'Para mirar una corrida que ya lanzaste: "sleep 230; tail -n 20 <archivo de salida>" con timeout 250000, una vez por llamada (sin for, while ni until). Si no va a terminar pronto, deja tu relevo y cierra tu turno.'
      : 'Para esperar una corrida: "sleep 230" con timeout 250000 y una comprobación corta, repetido; o devuelve a tu líder el archivo de salida y que él lance un ligero nuevo que la espere.';
    negar(`Ninguna llamada espera más de ${ESPERA_MAX_S / 60} min (sleep largo, o espera con timeout de ${Math.round(tope / 1000)} s): tu caché vence a los 5 min y el turno siguiente volvería a escribir todo tu contexto. ${forma}`);
  }
}

// Comprobaciones de solo lectura sobre un archivo: tail -n 20 x.log, tail -20 x.log, test -s x.log, [ -f x.log ].
const COMPROBACION = /^(tail\s+(?:-n\s*)?-?\d+\s+[^\s|;&<>]+|test\s+-[efs]\s+[^\s|;&<>]+|\[\s+-[efs]\s+[^\s|;&<>]+\s+\])$/;
function reglaComandos(cfg, quien, comando, raizTarea, activa) {
  if (quien.rol === 'xi-0') return; // el líder solo prepara ramas y worktrees; lo vigila su SKILL.md
  const clave = quien.rol === 'fase' ? quien.equipo : quien.equipo;
  let permitidos = (cfg.comandos || {})[clave] || (cfg.comandos || {})._desconocido || [];
  // Sin Yunque activo (reglas 3), Faro abre el PR; reglaRemotos ya validó repo y remoto.
  const sinYunque = Number((activa || {}).reglas) >= 3 && Array.isArray(activa.fases) && !activa.fases.includes('yunque');
  if (sinYunque && quien.rol === 'equipo' && quien.equipo === 'faro') permitidos = [...permitidos, 'gh pr create'];
  for (const s of segmentos(comando)) {
    // Cada permitido es un prefijo ("npm ci") o una regex con "re:" ("re:^node\\s+\\S*recorrido\\.js\\b").
    const vale = (p) => (p.startsWith('re:') ? new RegExp(p.slice(3)).test(s) : s === p || s.startsWith(p + ' '));
    const corta = /^sleep\s+(\d+(?:\.\d+)?)s?$/.exec(s); // esperar poco siempre vale (ver reglaEsperas)
    // Reglas 4: mirar la salida de una corrida siempre vale, aunque el equipo no tenga tail o test en su lista.
    // Antes el mensaje de la regla de esperas sugería una comprobación que la lista podía negar.
    const mira = Number((activa || {}).reglas) >= 4 && COMPROBACION.test(s) && !/\.env\b/.test(s);
    if (!(corta && +corta[1] <= ESPERA_MAX_S) && !mira && !permitidos.some(vale)) {
      negar(`${clave} no puede ejecutar "${s.slice(0, 80)}". Permitidos: ${permitidos.join(', ') || 'ninguno'}. Si de verdad lo necesitas, pídelo a Sextante por tu líder de fase.`);
    }
    reglaDependencias(cfg, clave, s, raizTarea);
  }
}

// Tarea chica (reglas 3): la tarea sale en un solo commit. Quien construye no hace commit hasta que QA
// dejó su resultado completo y sin fallas abiertas. Excepción: guardar avance ("wip:") con el límite en Guardado o Pausa.
function reglaCommitChica(quien, comando, activa, raizTarea, limite) {
  if (Number((activa || {}).reglas) < 3 || activa.tamano !== 'chica' || !raizTarea) return;
  if (!['equipo', 'ligero'].includes(quien.rol) || !['prisma', 'forja'].includes(quien.equipo)) return;
  const lista = piezas(comando);
  // Reglas 4: el commit único no lleva .xi-0/. Un "git add -A" (o "git add .") en el mismo comando lo metería.
  const agregaRastro = reglasRastro(activa) && lista.some((q) => {
    const a = subcomandoGit(q);
    return a && a.sub === 'add' && a.args.some((x) => /^(-A|--all|\.|\.xi-0(\/.*)?)$/.test(x)) && !a.args.some((x) => /^:(!|\(exclude\))\/?\.xi-0/.test(x));
  });
  for (const p of lista) {
    const g = subcomandoGit(p);
    if (!g || g.sub !== 'commit') continue;
    let mensaje = '';
    g.args.forEach((a, i) => {
      const m = /^--message=(.*)$/.exec(a);
      if (m) mensaje = mensaje || m[1];
      else if (/^(--message|-[a-zA-Z]*m)$/.test(a)) mensaje = mensaje || g.args[i + 1] || '';
    });
    if (/^wip:/i.test(mensaje.trim()) && ['guardado', 'pausa'].includes(limite.nivel)) continue;
    const faltan = faltanEnResultado(raizTarea, true);
    const abiertas = leerFallas(raizTarea).filter((x) => /^abiert/i.test(x.estado || ''));
    if (faltan.length || abiertas.length)
      negar(`En una tarea chica el commit es uno solo y va después de QA: ${faltan.length ? `a .xi-0/qa/resultado.md le faltan ${faltan.join(' · ')}` : `hay fallas abiertas (${abiertas.map((a) => a.f).join(', ')})`}. Deja los cambios sin commit, avisa a xi-0 que están listos para QA y espera su visto bueno. Solo con el límite en Guardado vale un commit "wip: ...".`);
    if (reglasRastro(activa) && (agregaRastro || rastroPreparado(raizTarea)))
      negar('El commit único no lleva .xi-0/ (es el rastro de la tarea, no se entrega). Prepáralo así: git add -A -- . ":!.xi-0" y después el commit. Si ya lo agregaste: git reset -q -- .xi-0');
  }
}

// Archivos de .xi-0/ ya preparados para el commit en la copia de la tarea.
function rastroPreparado(raizTarea) {
  try {
    return execFileSync('git', ['-C', win(raizTarea), 'diff', '--cached', '--name-only', '--', '.xi-0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
  } catch { return false; }
}

function reglaDependencias(cfg, clave, s, raizTarea) {
  let paquetes = [];
  let m;
  if ((m = /^npm\s+(?:install|i|add)\s+(.+)$/.exec(s))) paquetes = m[1].split(/\s+/).filter((x) => x && !x.startsWith('-'));
  else if ((m = /^npx\s+ng\s+add\s+(\S+)/.exec(s))) paquetes = [m[1]];
  else if ((m = /^dotnet\s+add\s+.*package\s+(\S+)/.exec(s))) paquetes = [m[1]];
  if (!paquetes.length) return;
  const aprobadas = new Set((cfg.dependencias_aprobadas || []).map((x) => x.toLowerCase()));
  const permisos = raizTarea ? leer(path.join(raizTarea, '.xi-0', 'permisos.json')) : null;
  for (const x of (permisos && permisos.dependencias_aprobadas) || []) aprobadas.add(String(x).toLowerCase());
  for (const p of paquetes) {
    const nombre = p.replace(/(?!^)@.*$/, '').toLowerCase();
    if (!aprobadas.has(nombre)) negar(`La dependencia "${nombre}" no está aprobada. Sextante debe añadirla a .xi-0/permisos.json (y Égida no debe haberla vetado).`);
  }
}

// Lo que hace cumplir las reglas no lo cambia un agente: la instalación de xi-0, los settings (ahí están
// los hooks) y la carpeta .claude/xi-0 del repo (config, tarea activa, registro). Solo la sesión principal,
// que es la que conduce la persona. Aplica en cualquier repo con xi-0 activado, haya tarea o no.
// La ruta real: resuelve nombres cortos de Windows (C:/Users/RUNNER~1) y enlaces. Si el archivo todavía no
// existe (Write de uno nuevo), resuelve la carpeta más cercana que sí existe y le pega el resto.
function real(p) {
  const n = norm(p);
  try { return norm(fs.realpathSync.native(win(n))); } catch { /* no existe */ }
  const padre = path.posix.dirname(n);
  return padre === n ? n : `${real(padre)}/${path.posix.basename(n)}`;
}
function esProtegido(abs, raiz) {
  const a = real(abs).toLowerCase();
  const home = real(path.join(os.homedir(), '.claude')).toLowerCase();
  const repo = `${real(raiz).toLowerCase()}/.claude`;
  const dentro = (base) => a === base || a.startsWith(base + '/');
  return dentro(`${home}/xi-0`) || dentro(`${home}/skills/xi-0`) || dentro(`${home}/agents/xi-0`) || dentro(`${repo}/xi-0`)
    || [home, repo].some((b) => a.startsWith(`${b}/settings`) && a.endsWith('.json') && !a.slice(b.length + 1).includes('/'));
}
function reglaProtegidosArchivo(quien, archivo, raiz) {
  if (quien.rol === 'xi-0' || !archivo) return;
  if (esProtegido(norm(archivo), raiz)) negar(`${quien.equipo} no puede escribir en ${norm(archivo)}: es parte de xi-0 o de su configuración. Si hace falta un cambio, díselo a tu líder; lo hace la sesión principal con la persona.`);
}
// En Bash es una comprobación por texto, no una garantía: un comando que nombra esas rutas solo pasa si es de lectura.
const MENCION_PROTEGIDA = /\.claude\/(xi-0|skills\/xi-0|agents\/xi-0)(\/|$)|\.claude\/settings[^\/\s]*\.json|(^|[\/\s'"(])guardian\.js|(^|[\/\s'"(])equipos\.json/i;
const SOLO_LECTURA = new Set(['cat', 'head', 'tail', 'grep', 'rg', 'ls', 'wc', 'less', 'more', 'stat', 'file', 'diff', 'test', 'cd', 'node']);
function reglaProtegidosBash(quien, comando) {
  if (quien.rol === 'xi-0') return;
  const menciona = (t) => MENCION_PROTEGIDA.test(String(t).replace(/\\/g, '/'));
  for (const p of piezas(comando)) {
    if (!p.some(menciona)) continue;
    const no = () => negar(`${quien.equipo} no puede tocar la instalación ni la configuración de xi-0 desde Bash ("${p.join(' ').slice(0, 80)}"). Leer sí: cat, head, grep, ls, o node <script>.`);
    const orden = p.find((t) => !/^\w+=/.test(t)) || '';
    if (!SOLO_LECTURA.has(orden.replace(/^.*[\/\\]/, '').replace(/\.exe$/i, ''))) no();
    if (orden === 'node' && p.some((t) => /^-(e|p|-eval|-print|r|-require)$/.test(t) || (/\s/.test(t) && menciona(t)))) no();
    p.forEach((t, i) => { if (t.includes('>') && menciona(t.split('>').pop() || p[i + 1] || '')) no(); });
  }
}

// Claude Code niega a los subagentes escribir un archivo llamado reporte.md ("Subagents should return findings
// as text"); en tareas reales le pasó a Seguridad las 5 veces, y el agente dejó su entrega solo en el mensaje.
// Se niega aquí antes, con el nombre que sí sirve. El resultado es el mismo (no se escribe), pero el motivo orienta.
function reglaNombreReporte(quien, archivo) {
  if (quien.rol === 'xi-0' || !archivo) return;
  const abs = norm(archivo);
  if (/\/\.xi-0\//.test(abs) && /^reports?\.md$|^reportes?\.md$/i.test(path.posix.basename(abs)))
    negar(`No llames "${path.posix.basename(abs)}" a un archivo: Claude Code niega a los subagentes escribir archivos con ese nombre. Usa el nombre de tu entrega (Seguridad: .xi-0/seguridad/veredicto.md; si no, uno descriptivo como informe.md) y escribe ahí el mismo contenido.`);
}
function reglaCarpetas(cfg, quien, archivo, raiz, activa) {
  const abs = norm(archivo);
  const home = norm(path.join(os.homedir(), '.claude'));
  const tmp = norm(os.tmpdir());
  if (abs.startsWith(home + '/') || abs.startsWith(tmp + '/')) return; // memoria, planes, scratchpad
  const wt = raizWorktree(abs);
  if (!wt || raizPrincipal(wt) !== raiz) negar(`${quien.equipo} no puede escribir fuera del repo y sus worktrees: ${abs}`);
  const rel = abs.slice(wt.length + 1);
  // Revisar una rama que ya existe (/xi-0-revisar): nadie cambia el código revisado, solo se escribe en .xi-0/.
  if ((activa || {}).modo === 'revisar' && quien.rol !== 'xi-0' && !rel.startsWith('.xi-0/'))
    negar(`Esta tarea revisa una rama que ya existe: no se cambia "${rel}". Escribe solo en .xi-0/; lo que falte o esté mal va como falla (una prueba que falta es clase "cobertura").`);
  if (quien.rol === 'equipo' && rel === `.xi-0/relevo/${quien.equipo}.md`) return; // su relevo, sin tocar la config del repo
  const reglas = (cfg.carpetas || {})[quien.equipo] || { incluye: [] };
  const incluye = Array.isArray(reglas) ? reglas : reglas.incluye;
  const excluye = Array.isArray(reglas) ? [] : reglas.excluye || [];
  if (!coincide(rel, incluye) || coincide(rel, excluye)) {
    negar(`${quien.equipo} no es dueño de "${rel}". Sus carpetas: ${incluye.join(', ') || 'ninguna'}${excluye.length ? ` (sin ${excluye.join(', ')})` : ''}. Pide el cambio al dueño por tu líder de fase.`);
  }
}

function reglaAgent(cfg, quien, entrada, raiz, limite, activa) {
  const tipo = entrada.tool_input.subagent_type || '';
  const nombre = entrada.tool_input.name || '';
  if (limite.nivel === 'pausa') negar(`Límite en ${limite.pct}% (Pausa): no se lanza nadie. xi-0 completa estado.md y cierra.`);
  if (quien.rol === 'xi-0') {
    if (!TODOS_LIDERES.includes(tipo)) negar(`xi-0 solo lanza líderes (${TODOS_LIDERES.join(', ')}), no "${tipo || 'sin tipo'}". El trabajo lo hacen los equipos.`);
    if (nombre !== tipo) negar(`Lanza al compañero con name="${tipo}" (igual que su tipo) para que los mensajes sigan las líneas del mapa.`);
    registrar({ decision: 'lanza', tipo, nivel: limite.nivel, pct: limite.pct });
    return;
  }
  if (quien.rol !== 'equipo') negar(`${quien.equipo} no puede lanzar agentes.`);
  if (Number((activa || {}).reglas) >= 3 && activa.tamano === 'chica')
    negar('Tarea chica: el líder hace el trabajo él mismo, sin agentes ligeros. Si no alcanza, avisa a xi-0 para subirla a mediana.');
  if (tipo !== `${quien.equipo}-ligero`) negar(`${quien.equipo} solo lanza agentes ligeros "${quien.equipo}-ligero" (con el rol en el prompt).`);
  if (limite.nivel !== 'normal') negar(`Límite en ${limite.pct}% (${limite.nivel}): no se lanzan agentes ligeros nuevos. Termina lo que está en curso.`);
  const max = EQ.equipos[quien.equipo].max;
  const estado = cargarActivos(raiz);
  const activos = estado[tipo] || [];
  if (activos.length >= max) negar(`${quien.equipo} ya tiene ${activos.length} agentes activos (máximo ${max}).`);
  activos.push({ id: entrada.tool_use_id, t: Date.now() });
  estado[tipo] = activos;
  guardarActivos(raiz, estado);
  registrar({ decision: 'lanza', tipo, activos: activos.length, max });
}

const archivoActivos = (raiz) => path.join(raiz, '.claude', 'xi-0', 'activos.json');
function cargarActivos(raiz) {
  const e = leer(archivoActivos(raiz)) || {};
  const corte = Date.now() - 60 * 60 * 1000; // reservas viejas (llamadas que fallaron) caducan en 1 h
  for (const k of Object.keys(e)) e[k] = e[k].filter((x) => x.t > corte);
  return e;
}
function guardarActivos(raiz, e) { fs.writeFileSync(archivoActivos(raiz), JSON.stringify(e, null, 1)); }

function reglaMensaje(quien, entrada, v2, activa) {
  const ti = entrada.tool_input || {};
  const para = String(ti.to || ti.recipient || '').toLowerCase();
  const msg = ti.message !== undefined ? ti.message : ti.content;
  if (typeof msg !== 'string') return; // mensajes de protocolo (apagado, aprobación de plan) siempre pasan
  const palabras = msg.trim().split(/\s+/).length;
  const esLider = EQ.nombres_del_lider.includes(para);
  const destino = esLider ? 'xi-0' : para;
  const v3 = Number((activa || {}).reglas) >= 3;
  // Sin reglas 3, o sin lista de fases, todas las fases cuentan como activas (como antes).
  const faseActiva = (f) => !v3 || !Array.isArray(activa.fases) || activa.fases.includes(f);

  if (quien.rol === 'xi-0') {
    if (!LIDERES_FASE.includes(destino) && !EQUIPOS.includes(destino)) return;
    if (EQUIPOS.includes(destino) && faseActiva(EQ.equipos[destino].fase) && !/^\s*(cierra|apaga|shutdown|para)\b/i.test(msg))
      negar(`xi-0 no da órdenes a ${destino} saltándose a su líder de fase (${EQ.equipos[destino].fase}).`);
    return;
  }
  if (quien.rol === 'fase') {
    const permitidos = ['xi-0', ...LIDERES_FASE, ...EQ.fases[quien.equipo].equipos];
    if (!permitidos.includes(destino)) negar(`${quien.equipo} no tiene línea con ${destino}. Solo con xi-0, los otros líderes de fase y sus equipos.`);
    if (destino === 'xi-0' && palabras > EQ.palabras_max.fase) negar(`Resumen de fase demasiado largo (${palabras} palabras, máximo ${EQ.palabras_max.fase}). Seis líneas: estado, entregables, bloqueos, riesgos, decisiones para xi-0 y evidencia. El detalle va en archivos.`);
    if (v2 && destino === 'xi-0' && campo(msg, 'estado') !== null && !campo(msg, 'evidencia')) negar('Resumen de fase sin la línea "evidencia:" (la de tu fase: dónde está y qué huecos quedan, o "sin huecos").');
    return;
  }
  if (quien.rol === 'equipo') {
    const fase = EQ.equipos[quien.equipo].fase;
    const conLinea = EQ.lineas.some(([a, b]) => (a === quien.equipo && b === destino) || (b === quien.equipo && a === destino));
    const directo = destino === 'xi-0' && !faseActiva(fase);
    if (destino === fase && !faseActiva(fase)) negar(`${fase} no está activo en esta tarea. Repórtale a xi-0.`);
    if (destino !== fase && !conLinea && !directo) negar(`${quien.equipo} no tiene línea con ${destino}. Pásalo por ${fase}.`);
    const max = directo ? (EQ.palabras_max.directo || 250) : EQ.palabras_max.equipo;
    if (palabras > max) negar(`Ficha demasiado larga (${palabras} palabras, máximo ${max}). El mensaje solo apunta: entrega, dónde, decisiones, pendiente, necesitas.`);
    return;
  }
  negar(`${quien.equipo} no envía mensajes; entrega su resultado a su líder al terminar.`);
}

function reglaTareaCompletada(cfg, quien, raiz, activa, raizTarea, entrada) {
  if (!raizTarea) return;
  const v2 = reglasEvidencia(activa);
  const fallas = leerFallas(raizTarea);
  const abiertas = fallas.filter((x) => /^abiert/i.test(x.estado || ''));
  const titulo = `${entrada.task_title || ''} ${entrada.task_description || ''}`.toLowerCase();
  const esCierre = /qa|calidad|entrega|cierre|final|devops|publica/.test(titulo) || ['argos', 'meridiano', 'faro', 'xi-0'].includes(quien.equipo);
  const escalar = abiertas.filter((a) => a.vuelta >= EQ.vueltas_max);
  if (escalar.length) frenar(`Fallas en su vuelta ${EQ.vueltas_max} sin resolver (${escalar.map((a) => a.f).join(', ')}): se escalan a xi-0 antes de cerrar nada.`);
  if (esCierre && abiertas.length) frenar(`No se cierra con fallas abiertas: ${abiertas.map((a) => a.f).join(', ')}.`);
  if (quien.equipo !== 'argos') return;

  const qa = path.join(raizTarea, '.xi-0', 'qa');
  const faltan = faltanEnResultado(raizTarea, v2);
  if (faltan.length) frenar(`QA no completa sin probar, revisar, mirar${v2 ? ' y validar' : ''}: a .xi-0/qa/resultado.md le faltan ${faltan.join(' · ')}.`);
  if (!v2) return;

  const validez = leerTexto(path.join(qa, 'validez.md'));
  if (!validez.trim()) frenar('QA no completa sin .xi-0/qa/validez.md: cada criterio CT-n / CA-n con la prueba que lo demuestra (formato en "Reporte de validez" de tu archivo de agente).');
  const sinPrueba = criterios(raizTarea).filter((id) => !new RegExp(`\\b${id}\\b`).test(validez));
  if (sinPrueba.length) frenar(`.xi-0/qa/validez.md no dice qué prueba demuestra ${sinPrueba.join(', ')} (o por qué es un hueco y qué evidencia lo cubre).`);
  const sinClase = fallas.filter((x) => /^qa-/i.test(x.f)).map((x) => [x.f, faltanEnFallaQA(x.txt)]).filter(([, falta]) => falta.length);
  if (sinClase.length) frenar(`Fallas de QA sin clasificar: ${sinClase.map(([f, falta]) => `${f} (falta ${falta.join(', ')})`).join('; ')}.`);
  const anotadas = seccion(validez, /^#{1,6}[ \t]*pruebas existentes/im);
  const sinJustificar = pruebasExistentesCambiadas(cfg, raiz, activa, raizTarea).filter((p) => !anotadas.includes(p) && !anotadas.includes(path.posix.basename(p)));
  if (sinJustificar.length) frenar(`Cambiaron o se borraron pruebas que ya existían en ${cfg.rama_base || 'main'} y no están en "Pruebas existentes que cambiaron" de .xi-0/qa/validez.md: ${sinJustificar.join(', ')}. Anota qué cambió y el requisito o contrato que excedía, o revierte el cambio.`);
}

// ---------- evidencia (tareas con "reglas": 2 en activa.json) ----------
// Las tareas abiertas antes de las reglas de evidencia siguen con las anteriores.
const reglasEvidencia = (activa) => Number((activa || {}).reglas) >= 2;
const leerTexto = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
// Las líneas que le faltan a .xi-0/qa/resultado.md para valer como resultado de QA.
function faltanEnResultado(raizTarea, v2) {
  const resultado = leerTexto(path.join(raizTarea, '.xi-0', 'qa', 'resultado.md'));
  const lineas = [['pruebas', 'pruebas: <comandos y resultado>'], ['revisi[oó]n', 'revision: <aprobado | N hallazgos>'], ['visual', 'visual: <aprobado | no aplica | N hallazgos>']];
  if (v2) lineas.push(['validez', 'validez: <aprobado (n/n criterios) | N huecos o hallazgos>']);
  return lineas.filter(([re]) => !campos(resultado, re).some(Boolean)).map(([, linea]) => `"${linea}"`);
}

// Lee "campo: valor" aunque venga como "- campo: valor" o "**Campo:** valor" (así escriben algunos agentes).
function campos(txt, nombre) {
  const re = new RegExp(`^[ \\t>*-]*(?:${nombre})\\**[ \\t]*:[ \\t*]*(.*)$`, 'gim');
  return [...String(txt || '').matchAll(re)].map((m) => m[1].replace(/^[`*_\s]+|[`*_\s]+$/g, ''));
}
function campo(txt, nombre) { // si se repite, manda el último (el más reciente)
  const v = campos(txt, nombre);
  return v.length ? v[v.length - 1] : null;
}

function leerFallas(raizTarea) {
  const dir = path.join(raizTarea, '.xi-0', 'fallas');
  let nombres = [];
  try { nombres = fs.readdirSync(dir).filter((x) => x.endsWith('.md')); } catch { return []; }
  return nombres.map((f) => {
    const txt = leerTexto(path.join(dir, f));
    return { f, txt, estado: campo(txt, 'estado'), vuelta: Number(((campo(txt, 'vuelta') || '').match(/\d+/) || ['1'])[0]) };
  });
}

function faltanEnFallaQA(txt) {
  const falta = [];
  if (!campo(txt, 'estado')) falta.push('estado');
  if (!/^(implementaci[oó]n|prueba|requisito|cobertura)\b/i.test(campo(txt, 'clase') || '')) falta.push('clase (implementación | prueba | requisito | cobertura)');
  if (!campo(txt, 'requisito')) falta.push('requisito');
  if (!/\d/.test(campo(txt, 'vuelta') || '')) falta.push('vuelta');
  return falta;
}

function reglaFallaQA(archivo, contenido) {
  if (!/\/\.xi-0\/fallas\/qa-[^/]*\.md$/i.test(norm(archivo))) return;
  const falta = faltanEnFallaQA(contenido || '');
  if (falta.length) negar(`A la falla ${path.basename(String(archivo))} le falta ${falta.join(', ')}. Clasifícala antes de devolverla (formato en "Cuando algo falla" de tu archivo de agente).`);
}

function listarMd(dir) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return items.flatMap((it) => {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) return listarMd(p);
    return it.name.endsWith('.md') ? [p] : [];
  });
}

// Ids de criterio: CT-n en tarea.md (xi-0) y CA-n en los requisitos (Brújula).
function criterios(raizTarea) {
  const textos = [leerTexto(path.join(raizTarea, '.xi-0', 'tarea.md')), ...listarMd(path.join(raizTarea, '.xi-0', 'plan', 'requisitos')).map(leerTexto)];
  const ids = new Set();
  for (const t of textos) for (const m of t.matchAll(/\bC[AT]-\d+\b/g)) ids.add(m[0]);
  return [...ids].sort();
}

// Texto de una sección markdown, desde su encabezado hasta el siguiente de nivel 1 o 2.
function seccion(txt, encabezado) {
  const m = encabezado.exec(txt);
  if (!m) return '';
  const resto = txt.slice(m.index + m[0].length);
  const fin = resto.search(/^#{1,2}\s/m);
  return fin === -1 ? resto : resto.slice(0, fin);
}

// Archivos de prueba (carpetas de Argos) que ya existían en la rama base y que la tarea cambió o borró.
function pruebasExistentesCambiadas(cfg, raiz, activa, raizTarea) {
  if (!activa) return [];
  const base = cfg.rama_base || 'main';
  const reglas = (cfg.carpetas || {}).argos || [];
  const incluye = Array.isArray(reglas) ? reglas : reglas.incluye || [];
  const cambiadas = new Set();
  const comparaciones = activa.rama ? [`${activa.rama}-argos`, `${activa.rama}/argos`, activa.rama].map((rama) => [raiz, `${base}...${rama}`]) : [];
  // Con reglas 3 cuentan también los cambios sin commit de la copia de la tarea (en una tarea chica no hay commits hasta el final).
  if (Number(activa.reglas) >= 3 && raizTarea) comparaciones.push([win(raizTarea), base]);
  for (const [donde, que] of comparaciones) {
    let salida;
    try {
      salida = execFileSync('git', ['-c', 'core.quotepath=false', '-C', donde, 'diff', '--name-status', '--diff-filter=MDRT', que, '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { continue; } // la rama no existe o git falló: esta regla no bloquea por eso
    for (const linea of salida.split('\n')) {
      const archivo = linea.split('\t')[1]; // en un renombre es la ruta vieja
      if (archivo && !archivo.startsWith('.xi-0/') && coincide(archivo, incluye)) cambiadas.add(archivo);
    }
  }
  return [...cambiadas];
}

// ---------- entrada ----------
let crudo = '';
process.stdin.on('data', (d) => (crudo += d));
// Un error del guardián no deja pasar la llamada: en un repo con xi-0 activado, niega y dice qué falló.
// Antes de saber que el repo tiene config (enConfig) no hace nada, igual que siempre.
let enConfig = false;
let eventoActual = '';
function fallar(err) {
  if (!enConfig) process.exit(0);
  const motivo = `El guardián falló y por seguridad no deja pasar la llamada: ${String((err && err.message) || err).slice(0, 200)}. `
    + 'Revisa .claude/xi-0/config.json del repo (por ejemplo una regex "re:" mal escrita) y la instalación en ~/.claude/xi-0 (node instalar.js). Esto lo arregla una persona, no un agente.';
  if (eventoActual === 'PreToolUse') negar(motivo);
  if (eventoActual === 'TaskCreated' || eventoActual === 'TaskCompleted') frenar(motivo);
  registrar({ decision: 'error', motivo });
  process.exit(0); // SubagentStop: frenarlo dejaría al agente sin poder terminar
}
process.on('uncaughtException', fallar);
process.stdin.on('end', () => { try { atender(); } catch (err) { fallar(err); } });
function atender() {
  let e;
  try { e = JSON.parse(crudo); } catch { pasar(); }
  // El repo es el de la carpeta actual; si un agente se salió con cd, el del proyecto de la sesión.
  const raiz = [e.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean).map(raizPrincipal)
    .find((r) => r && fs.existsSync(path.join(r, '.claude', 'xi-0', 'config.json')));
  if (!raiz) pasar();
  const archivoCfg = path.join(raiz, '.claude', 'xi-0', 'config.json');
  enConfig = true;
  eventoActual = e.hook_event_name;
  ctx = { raiz, evento: e.hook_event_name, quien: e.agent_type || 'xi-0', herramienta: e.tool_name, sesion: e.session_id };
  if (errorCarga) throw new Error(`no se pudo leer equipos.json (${errorCarga.message})`);
  const cfg = JSON.parse(fs.readFileSync(archivoCfg, 'utf8').replace(String.fromCharCode(0xFEFF), ''));
  const quien = identificar(e.agent_type);
  const archivoActiva = path.join(raiz, '.claude', 'xi-0', 'activa.json');
  const activa = leer(archivoActiva);
  if (!activa && fs.existsSync(archivoActiva)) throw new Error('activa.json existe pero no se puede leer');
  const raizTarea = activa && activa.worktree_tarea ? norm(activa.worktree_tarea) : null;

  // La regla de remotos aplica siempre en el proyecto, haya tarea xi-0 activa o no.
  if (e.hook_event_name === 'PreToolUse' && e.tool_name === 'Bash') reglaRemotosPorRepo(cfg, quien, e.tool_input.command || '', activa, raiz, e.cwd);
  // Lo mismo la protección de xi-0 y su configuración.
  if (e.hook_event_name === 'PreToolUse') {
    const ti = e.tool_input || {};
    if (e.tool_name === 'Bash') reglaProtegidosBash(quien, ti.command || '');
    else if (['Write', 'Edit', 'NotebookEdit'].includes(e.tool_name)) reglaProtegidosArchivo(quien, ti.file_path || ti.notebook_path, raiz);
  }
  if (!activa) pasar();

  const limite = nivelLimite(raiz);
  const v2 = reglasEvidencia(activa);
  switch (e.hook_event_name) {
    case 'PreToolUse':
      if (e.tool_name === 'Bash') {
        reglaEsperas(quien, e.tool_input || {}, activa, [raizTarea, raizWorktree(path.join(e.cwd || process.cwd(), 'x'))]);
        reglaComandos(cfg, quien, e.tool_input.command || '', raizTarea, activa);
        reglaCommitChica(quien, e.tool_input.command || '', activa, raizTarea, limite);
      }
      else if (['Write', 'Edit', 'NotebookEdit'].includes(e.tool_name)) {
        if (quien.rol === 'desconocido') negar(`"${quien.equipo}" no pertenece al equipo xi-0 y no puede escribir mientras hay una tarea activa.`);
        const archivo = e.tool_input.file_path || e.tool_input.notebook_path;
        reglaNombreReporte(quien, archivo);
        reglaCarpetas(cfg, quien, archivo, raiz, activa);
        if (v2 && e.tool_name === 'Write') reglaFallaQA(archivo, e.tool_input.content);
      }
      else if (e.tool_name === 'Agent') reglaAgent(cfg, quien, e, raiz, limite, activa);
      else if (e.tool_name === 'SendMessage') reglaMensaje(quien, e, v2, activa);
      break;
    case 'SubagentStop': {
      const tipo = e.agent_type || '';
      registrar({ decision: 'termina', tipo });
      if (/-ligero$/.test(tipo)) {
        const est = cargarActivos(raiz);
        if (est[tipo] && est[tipo].length) { est[tipo].shift(); guardarActivos(raiz, est); }
      }
      break;
    }
    case 'TaskCreated':
      if (limite.nivel !== 'normal') frenar(`Límite en ${limite.pct}% (${limite.nivel}): no se abren tareas nuevas. Actualiza una existente si es para cerrar algo en curso.`);
      break;
    case 'TaskCompleted':
      reglaTareaCompletada(cfg, quien, raiz, activa, raizTarea, e);
      break;
  }
  pasar();
}
