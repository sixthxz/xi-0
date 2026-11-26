#!/usr/bin/env node
// Instala xi-0 en la carpeta global de Claude Code (~/.claude) y, si se pide, lo activa en un repo.
//
//   node instalar.js                                   copia xi-0 y la habilidad, y genera los 25 agentes
//   node instalar.js --activar <repo>                  además deja la config y los hooks en ese repo
//   node instalar.js --activar <repo> --plantilla node la config sale de la plantilla mínima de Node
//   node instalar.js --revisar <repo>                  solo revisa la config de ese repo; no instala nada
//
// Sobrescribe los archivos de xi-0 que ya existan en ~/.claude (también los agentes generados) y no toca
// nada más. No borra archivos. En un repo nunca sobrescribe config.json ni settings.json.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ORIGEN = __dirname;
const CLAUDE = path.join(os.homedir(), '.claude');
const DESTINO = path.join(CLAUDE, 'xi-0');
const aTexto = (p) => p.replace(/\\/g, '/');
const argumento = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i < 0 ? null : process.argv[i + 1] || '';
};

function copiar(desde, hasta) {
  let n = 0;
  for (const e of fs.readdirSync(desde, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const a = path.join(desde, e.name);
    const b = path.join(hasta, e.name);
    if (e.isDirectory()) n += copiar(a, b);
    else { fs.mkdirSync(hasta, { recursive: true }); fs.copyFileSync(a, b); n++; }
  }
  return n;
}

// Los hooks y la barra de estado apuntan a la instalación de esta máquina.
function ajustes() {
  const txt = fs.readFileSync(path.join(ORIGEN, 'xi-0', 'settings.ejemplo.json'), 'utf8');
  return txt.split('<XI0>').join(aTexto(DESTINO));
}

function repoDe(valor) {
  const repo = path.resolve(valor || '');
  if (!valor || !fs.existsSync(path.join(repo, '.git'))) {
    console.error(`"${repo}" no es la raíz de un repo git.`);
    process.exit(1);
  }
  return repo;
}

// Con safe.directory en la línea de comandos, git responde también en un repo de otro dueño ("dubious ownership"),
// que sin eso daba avisos falsos: "la rama base no existe", "el remoto no existe".
const git = (repo, ...args) => {
  try { return execFileSync('git', ['-c', `safe.directory=${repo.replace(/\\/g, '/')}`, '-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
// true si git, tal como lo corren los agentes (sin ese -c), rechaza el repo por su dueño.
function dueñoDistinto(repo) {
  try { execFileSync('git', ['-C', repo, 'rev-parse', '--git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return false; }
  catch (e) { return /dubious ownership/i.test(String(e.stderr || '')); }
}
// Las variables de entorno de los settings del repo (settings.json y settings.local.json).
function entornoDeSettings(repo) {
  const env = {};
  for (const n of ['settings.json', 'settings.local.json']) {
    try { Object.assign(env, JSON.parse(fs.readFileSync(path.join(repo, '.claude', n), 'utf8').replace(/^﻿/, '')).env || {}); } catch { /* sin archivo */ }
  }
  return env;
}

// Avisos sobre la config de un repo. No cambia nada. Con una config dañada el guardián niega todas las
// llamadas, así que conviene verlo aquí antes que en mitad de una tarea.
function revisar(repo) {
  const archivo = path.join(repo, '.claude', 'xi-0', 'config.json');
  if (!fs.existsSync(archivo)) return [`no existe ${aTexto(archivo)}. Créala con: node instalar.js --activar "${aTexto(repo)}"`];
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return [`config.json no es JSON válido (${e.message}). Así el guardián niega todas las llamadas.`]; }
  const EQ = JSON.parse(fs.readFileSync(path.join(ORIGEN, 'xi-0', 'equipos.json'), 'utf8'));
  const avisos = [];

  for (const k of ['proyecto', 'worktrees', 'rama_base', 'remoto', 'verificacion', 'carpetas', 'comandos'])
    if (cfg[k] === undefined || cfg[k] === null) avisos.push(`falta "${k}".`);
  if (/<nombre>/.test(`${cfg.proyecto} ${cfg.worktrees}`)) avisos.push('"proyecto" o "worktrees" siguen con <nombre>: pon el nombre de tu proyecto.');
  if (dueñoDistinto(repo)) {
    const env = entornoDeSettings(repo);
    const n = Number(env.GIT_CONFIG_COUNT) || 0;
    const cubierto = Array.from({ length: n }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]])
      .some(([k, v]) => k === 'safe.directory' && v);
    if (!cubierto)
      avisos.push('git rechaza este repo por su dueño ("dubious ownership"): los agentes no podrán usar git. Añade a "env" de .claude/settings.local.json: "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "safe.directory", "GIT_CONFIG_VALUE_0": "<ruta del repo o *>".');
  }
  if (cfg.rama_base && git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${cfg.rama_base}`) === null)
    avisos.push(`la rama base "${cfg.rama_base}" no existe en el repo.`);

  const verif = cfg.verificacion || {};
  if (!Object.values(verif).some((v) => Array.isArray(v) && v.length)) avisos.push('"verificacion" está vacía: nadie sabrá cómo comprobar el proyecto.');

  const carpetas = cfg.carpetas || {};
  const patrones = (e) => (Array.isArray(carpetas[e]) ? carpetas[e] : (carpetas[e] || {}).incluye || []);
  for (const e of Object.keys(EQ.equipos))
    if (carpetas[e] === undefined) avisos.push(`"carpetas" no tiene a ${e} (${EQ.equipos[e].nombre}): no podrá escribir nada.`);
  if (!patrones('prisma').length && !patrones('forja').length) avisos.push('ni prisma (Front end) ni forja (Back end) tienen carpetas: nadie puede escribir código.');
  // Una carpeta de código que no existe casi siempre es la plantilla sin ajustar.
  for (const e of ['prisma', 'forja']) {
    const fijas = patrones(e).filter((p) => !p.startsWith('.xi-0/') && !p.startsWith('**')).map((p) => p.split(/[*?[{]/)[0].replace(/\/[^/]*$/, ''));
    const con = fijas.filter((p) => p && p !== '.');
    if (con.length && !con.some((p) => fs.existsSync(path.join(repo, p))))
      avisos.push(`ninguna carpeta de ${e} existe en el repo (${[...new Set(con)].slice(0, 3).join(', ')}): ¿es la plantilla sin ajustar?`);
  }

  const comandos = cfg.comandos || {};
  for (const e of ['prisma', 'forja', 'argos'])
    if (patrones(e).length && !Array.isArray(comandos[e])) avisos.push(`"comandos" no tiene a ${e}: solo podrá correr los de "_desconocido".`);
  for (const [e, lista] of Object.entries(comandos))
    for (const c of Array.isArray(lista) ? lista : [])
      if (typeof c === 'string' && c.startsWith('re:')) {
        try { new RegExp(c.slice(3)); }
        catch (err) { avisos.push(`"comandos.${e}" tiene una expresión inválida (${c}): el guardián negaría todo Bash.`); }
      }
      // Un permitido sin "re:" vale si el comando es igual o sigue con un espacio: "node pruebas/" nunca coincide con "node pruebas/x.js".
      else if (typeof c === 'string' && /[\/\\=:]$/.test(c))
        avisos.push(`"comandos.${e}" tiene "${c}", que nunca coincide con un comando: un permitido es el comando completo o su comienzo hasta un espacio. Para una carpeta usa una expresión, por ejemplo "re:^node +pruebas/[^ ]+[.]js$".`);

  const r = cfg.remoto || {};
  if (r.push && !r.remote_permitido) avisos.push('"remoto.push" es true pero falta "remote_permitido".');
  if (r.push && r.remote_permitido && !(git(repo, 'remote') || '').split('\n').includes(r.remote_permitido))
    avisos.push(`el remoto "${r.remote_permitido}" no existe en el repo.`);
  if (r.pr && !r.push) avisos.push('"remoto.pr" es true pero "push" es false: no hay rama publicada para el PR.');
  if (r.pr && !r.repo_pr) avisos.push('"remoto.pr" es true pero falta "repo_pr" (<usuario>/<repo>).');

  const ci = cfg.ci || {};
  if (ci.workflow) {
    if (!r.push) avisos.push('"ci.workflow" está puesto pero "remoto.push" es false: el CI necesita subir una rama. Pon push=true o deja workflow en null.');
    if (cfg.rama_base && git(repo, 'cat-file', '-e', `${cfg.rama_base}:.github/workflows/${ci.workflow}`) === null)
      avisos.push(`"ci.workflow" es "${ci.workflow}", pero .github/workflows/${ci.workflow} no está en ${cfg.rama_base}.`);
    const todos = Object.values(cfg.verificacion || {}).flat();
    for (const c of ci.no_local || []) if (!todos.includes(c)) avisos.push(`"ci.no_local" tiene "${c}", que no está en "verificacion": el guardián compara el comando exacto.`);
  }

  const qv = cfg.qa_visual;
  if (qv && !qv.propio && !fs.existsSync(path.join(DESTINO, 'qa-visual', 'node_modules')))
    avisos.push(`hay "qa_visual" pero falta npm install en ${aTexto(path.join(DESTINO, 'qa-visual'))}.`);
  return avisos;
}

function mostrarRevision(repo) {
  const avisos = revisar(repo);
  if (!avisos.length) console.log('Config revisada: sin avisos.');
  else console.log(`Config: ${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'}\n` + avisos.map((a) => '  - ' + a).join('\n'));
  return avisos.length;
}

if (argumento('--revisar') !== null) {
  process.exit(mostrarRevision(repoDe(argumento('--revisar'))) ? 1 : 0);
}

const plantilla = argumento('--plantilla') || 'ejemplo';
const archivoPlantilla = path.join(ORIGEN, 'xi-0', `config.${plantilla}.json`);
if (!/^[a-z]+$/.test(plantilla) || !fs.existsSync(archivoPlantilla)) {
  console.error(`No hay plantilla "${plantilla}". Las que hay: ejemplo (.NET y Angular), node (un paquete de Node).`);
  process.exit(1);
}

const n1 = copiar(path.join(ORIGEN, 'xi-0'), DESTINO);
// Todas las habilidades del repo: xi-0 y sus comandos por fase (xi-0-revisar…).
const habilidades = fs.readdirSync(path.join(ORIGEN, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
let n2 = 0;
for (const h of habilidades) n2 += copiar(path.join(ORIGEN, 'skills', h), path.join(CLAUDE, 'skills', h));
console.log(`Copiados ${n1} archivos a ${aTexto(DESTINO)} y ${n2} de ${habilidades.length} habilidades (${habilidades.join(', ')}) a ${aTexto(path.join(CLAUDE, 'skills'))}.`);

execFileSync(process.execPath, [path.join(DESTINO, 'generar-agentes.js')], { stdio: 'inherit' });

if (argumento('--activar') === null) {
  console.log(`
Listo. Para usarlo en un repo:
  node instalar.js --activar <ruta del repo>
Para el QA visual (opcional): npm install dentro de ${aTexto(path.join(DESTINO, 'qa-visual'))}
Si Claude Code está abierto, reinícialo: los agentes y la habilidad se leen al abrir la sesión.`);
  process.exit(0);
}

const repo = repoDe(argumento('--activar'));
const carpeta = path.join(repo, '.claude', 'xi-0');
fs.mkdirSync(carpeta, { recursive: true });

const config = path.join(carpeta, 'config.json');
if (fs.existsSync(config)) console.log(`Ya existe ${aTexto(config)}: no se toca.`);
else {
  fs.copyFileSync(archivoPlantilla, config);
  console.log(`Creado ${aTexto(config)} desde la plantilla "${plantilla}". AJÚSTALO a tu repo: carpetas, comandos, verificacion y remoto.`);
}

const settings = path.join(repo, '.claude', 'settings.json');
if (fs.existsSync(settings)) {
  const propuesta = path.join(carpeta, 'settings.propuesto.json');
  fs.writeFileSync(propuesta, ajustes());
  console.log(`Ya existe ${aTexto(settings)}: no se toca. Copia a mano "env", "permissions", "statusLine" y "hooks" desde ${aTexto(propuesta)}.`);
} else {
  fs.writeFileSync(settings, ajustes());
  console.log(`Creado ${aTexto(settings)} (agent teams, barra de estado, hooks del guardián y lectura de .env negada).`);
}
console.log('');
mostrarRevision(repo);
console.log(`
Cuando la ajustes, vuelve a revisarla con: node instalar.js --revisar "${aTexto(repo)}"
Si no quieres que .claude/ entre al historial del repo, añádelo a .git/info/exclude.
Reinicia Claude Code en ese repo (los hooks y agent teams se leen al abrir la sesión) y escribe: /xi-0 <tu orden>
Un equipo de agentes gasta varias veces lo que una sesión sola. Empieza con una tarea chica y mira el costo con:
  node ${aTexto(path.join(DESTINO, 'metricas.js'))} "${aTexto(repo)}"`);
