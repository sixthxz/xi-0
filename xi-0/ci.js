#!/usr/bin/env node
// Verificación de una tarea de xi-0 en el CI del proyecto (GitHub Actions), sin correr la suite en local.
//
// Sube una instantánea del worktree de la tarea (lo que tiene, con o sin commit, menos .xi-0/) a una rama
// desechable tarea/<id>-ci-<n>, espera la corrida del workflow configurado y deja el resultado en
// <worktree>/.xi-0/ci/. La rama de la tarea no se toca: así el commit único del final no necesita push forzado.
//
// Uso (lo corre la sesión principal, en primer plano con timeout de hasta 600000):
//   node ~/.claude/xi-0/ci.js <worktree_tarea>               instantánea, push y espera (hasta 540 s)
//   node ~/.claude/xi-0/ci.js <worktree_tarea> --ver <n>     sigue esperando la corrida n
//   node ~/.claude/xi-0/ci.js <worktree_tarea> --comprobar   ¿el último commit es lo que pasó en verde?
//   node ~/.claude/xi-0/ci.js <worktree_tarea> --limpiar     borra las ramas tarea/<id>-ci-* del remoto
// Opciones: --esperar <segundos> (por defecto 540), --sin-esperar (solo instantánea y push).
// Salida: 0 verde o hecho · 1 rojo o no coincide · 2 error de uso o de config · 3 sigue corriendo.
//
// Requiere en .claude/xi-0/config.json: "ci": { "workflow": "<archivo del workflow>" } y remoto.push=true
// con remote_permitido. Solo empuja a refs/heads/tarea/<id>-ci-<n>, nunca forzado.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || '') : null; };
const bandera = (n) => args.includes(n);
const salir = (codigo, msg) => { if (msg) (codigo === 2 ? console.error : console.log)(msg); process.exit(codigo); };

const wt = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
if (!wt || !fs.existsSync(wt)) salir(2, 'Uso: node ci.js <worktree_tarea> [--ver <n> | --comprobar | --limpiar] [--esperar <s>] [--sin-esperar]');

// git con safe.directory: en repos de otro dueño ("dubious ownership") git se niega sin esto.
function git(a, extra = {}) {
  return execFileSync('git', ['-c', 'safe.directory=*', '-C', wt, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...extra }).trim();
}
const leer = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

const raiz = path.dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
const cfg = leer(path.join(raiz, '.claude', 'xi-0', 'config.json'));
if (!cfg) salir(2, `No hay config de xi-0 en ${raiz}/.claude/xi-0/config.json.`);
const activa = leer(path.join(raiz, '.claude', 'xi-0', 'activa.json'));
const id = activa && activa.tarea;
if (!id) salir(2, 'No hay tarea abierta (.claude/xi-0/activa.json sin "tarea").');
const ci = cfg.ci || {};
const r = cfg.remoto || {};
if (!ci.workflow) salir(2, 'La config no tiene "ci": { "workflow": "<archivo>" }. Sin eso la verificación va en local (config.verificacion).');
if (!r.push || !r.remote_permitido) salir(2, 'El CI necesita subir una rama: remoto.push=true y remote_permitido en la config.');
const remoto = r.remote_permitido;
const prefijo = `tarea/${id}-ci-`;
const dir = path.join(wt, '.xi-0', 'ci');
fs.mkdirSync(dir, { recursive: true });

// dueño/repo de GitHub a partir del remoto (gh lo necesita explícito: en un repo de otro dueño no lo deduce).
function repoGitHub() {
  const url = git(['remote', 'get-url', remoto]);
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? m[1] : null;
}
function gh(a) {
  return execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: wt, env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' } }).trim();
}
const dormir = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);

// Árbol de lo que hay en el worktree (o solo en HEAD), sin .xi-0/, con un índice aparte: no toca el del worktree.
function arbol(conCambios) {
  const indice = path.join(os.tmpdir(), `xi0-ci-${process.pid}-${Date.now()}.index`);
  const env = { env: { ...process.env, GIT_INDEX_FILE: indice } };
  try {
    git(['read-tree', 'HEAD'], env);
    if (conCambios) git(['add', '-A', '--', '.', ':(exclude).xi-0'], env);
    git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.xi-0'], env);
    return git(['write-tree'], env);
  } finally { fs.rmSync(indice, { force: true }); }
}

function ramasCI() {
  const salida = git(['ls-remote', '--heads', remoto, `refs/heads/${prefijo}*`]);
  return salida.split('\n').filter(Boolean).map((l) => l.split('\t')[1].replace('refs/heads/', ''));
}

function guardar(c) {
  const txt = [
    `corrida: ${c.n}`,
    `rama: ${c.rama}`,
    `instantanea: ${c.commit} (árbol ${c.arbol}, sobre ${c.base})`,
    `run: ${c.url || 'sin run todavía'}`,
    `estado: ${c.estado}`,
    `resultado: ${c.resultado || 'pendiente'}`,
    `hora: ${new Date().toISOString()}`,
    ...(c.log ? ['', '## Fallas (últimas líneas del log)', '', '```', c.log, '```'] : []),
  ].join('\n') + '\n';
  for (const n of [String(c.n), 'ultimo']) {
    fs.writeFileSync(path.join(dir, `${n}.md`), txt);
    fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(c, null, 1));
  }
  return txt;
}

function esperar(c, tope) {
  const repo = repoGitHub();
  if (!repo) salir(2, `El remoto "${remoto}" no es de GitHub: no se puede leer el CI.`);
  const fin = Date.now() + tope * 1000;
  let run = null;
  while (Date.now() < fin) {
    if (!run) {
      const lista = JSON.parse(gh(['run', 'list', '-R', repo, '--branch', c.rama, '--workflow', ci.workflow, '--json', 'databaseId,status,conclusion,headSha,url', '-L', '5']) || '[]');
      run = lista.find((x) => x.headSha === c.commit) || null;
    } else {
      run = JSON.parse(gh(['run', 'view', String(run.databaseId), '-R', repo, '--json', 'databaseId,status,conclusion,headSha,url']));
    }
    if (run) { c.run = run.databaseId; c.url = run.url; c.estado = run.status; c.resultado = run.conclusion || null; }
    if (run && run.status === 'completed') break;
    dormir(10);
  }
  if (!run) { c.estado = 'sin run'; guardar(c); salir(3, `No apareció ninguna corrida de ${ci.workflow} para ${c.rama} en ${tope} s. ¿El workflow corre en push a tarea/**? Vuelve a mirar con --ver ${c.n}.`); }
  if (run.status !== 'completed') { guardar(c); salir(3, `La corrida ${c.url} sigue (${run.status}). Vuelve a mirar con: node ~/.claude/xi-0/ci.js "${wt}" --ver ${c.n}`); }
  if (run.conclusion !== 'success') {
    try { c.log = gh(['run', 'view', String(run.databaseId), '-R', repo, '--log-failed']).split('\n').slice(-150).join('\n'); } catch { c.log = '(no se pudo leer el log)'; }
  }
  const txt = guardar(c);
  salir(run.conclusion === 'success' ? 0 : 1, txt);
}

const tope = Number(opcion('--esperar')) || 540;

if (bandera('--limpiar')) {
  const ramas = ramasCI();
  if (ramas.length) git(['push', remoto, ...ramas.map((x) => `:refs/heads/${x}`)]);
  salir(0, ramas.length ? `Borradas del remoto: ${ramas.join(', ')}` : 'No había ramas de CI de esta tarea.');
}

if (bandera('--comprobar')) {
  const u = leer(path.join(dir, 'ultimo.json'));
  if (!u) salir(1, 'No hay corrida de CI registrada (.xi-0/ci/ultimo.json).');
  const actual = arbol(false);
  if (u.resultado !== 'success') salir(1, `La última corrida (${u.n}) no está en verde: ${u.resultado || u.estado}.`);
  if (actual !== u.arbol) salir(1, `El último commit (árbol ${actual}) no es lo que pasó en verde en la corrida ${u.n} (árbol ${u.arbol}). Corre el CI otra vez.`);
  salir(0, `Verificado: el último commit es lo mismo que pasó en verde en ${u.url}.`);
}

const ver = opcion('--ver');
if (ver !== null) {
  const c = leer(path.join(dir, `${ver}.json`));
  if (!c) salir(2, `No hay registro de la corrida ${ver} en .xi-0/ci/.`);
  esperar(c, tope);
}

// Instantánea y push.
const base = git(['rev-parse', 'HEAD']);
const arbolActual = arbol(true);
let identidad = [];
try { git(['config', 'user.email']); } catch { identidad = ['-c', 'user.name=xi-0', '-c', 'user.email=xi-0@localhost.invalid']; }
const commit = execFileSync('git', ['-c', 'safe.directory=*', ...identidad, '-C', wt, 'commit-tree', arbolActual, '-p', base, '-m', `ci: instantánea de la tarea ${id} (no se une)`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const usados = ramasCI().map((x) => Number(x.slice(prefijo.length))).filter(Number.isFinite);
const locales = fs.readdirSync(dir).map((f) => Number((/^(\d+)\.json$/.exec(f) || [])[1])).filter(Number.isFinite);
const n = Math.max(0, ...usados, ...locales) + 1;
const rama = `${prefijo}${n}`;
git(['push', remoto, `${commit}:refs/heads/${rama}`]);
const c = { n, rama, commit, arbol: arbolActual, base, estado: 'subida', resultado: null };
if (bandera('--sin-esperar')) { guardar(c); salir(0, `Subida ${rama} (${commit}).`); }
guardar(c);
esperar(c, tope);
