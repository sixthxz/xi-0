#!/usr/bin/env node
// Enlaza node_modules de un worktree al del repo principal, para no instalar dependencias en cada tarea.
//
// pnpm y npm arman node_modules con enlaces relativos dentro de la carpeta, así que un enlace a la carpeta
// entera del repo principal sirve tal cual. En Windows es una junction (no pide administrador); en Linux y
// macOS, un enlace simbólico. Solo se enlaza una carpeta de paquete cuando su package.json y su lockfile son
// iguales a los del repo principal: si la tarea cambia dependencias, ese worktree instala por su cuenta.
//
// Uso (lo corre la sesión principal):
//   node ~/.claude/xi-0/enlazar.js <worktree>            enlaza lo que se pueda y dice qué no
//   node ~/.claude/xi-0/enlazar.js <worktree> --quitar   quita los enlaces (el original no se toca)
//
// Cuidado: git worktree remove ATRAVIESA el enlace y borra el node_modules del repo principal. Antes de
// borrar un worktree enlazado, --quitar. El guardián niega git worktree remove mientras haya enlaces.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCKS = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json'];
const args = process.argv.slice(2);
const wt = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
require('./anotar.js').alFallar('enlazar.js', wt);
if (!wt || !fs.existsSync(wt)) { console.error('Uso: node enlazar.js <worktree> [--quitar]'); process.exit(2); }

// Carpetas de paquete del worktree (la raíz y hasta dos niveles abajo), sin entrar a node_modules ni a .git.
function paquetes(raiz) {
  const salida = [];
  const recorrer = (rel, nivel) => {
    const abs = path.join(raiz, rel);
    if (fs.existsSync(path.join(abs, 'package.json'))) salida.push(rel);
    if (nivel >= 2) return;
    let items = [];
    try { items = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const it of items) if (it.isDirectory() && !/^(node_modules|\.git|\.xi-0|\.worktrees|dist|build)$/.test(it.name)) recorrer(path.join(rel, it.name), nivel + 1);
  };
  recorrer('', 0);
  return salida;
}
const esEnlace = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const leer = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
const iguales = (a, b) => (a === null && b === null) || (a !== null && b !== null && a.equals(b));

if (args.includes('--quitar')) {
  const quitados = [];
  for (const rel of paquetes(wt)) {
    const nm = path.join(wt, rel, 'node_modules');
    if (esEnlace(nm)) { fs.unlinkSync(nm); quitados.push(path.join(rel, 'node_modules') || 'node_modules'); }
  }
  console.log(quitados.length ? `Enlaces quitados: ${quitados.join(', ')}. Ya se puede borrar el worktree.` : 'No había enlaces de node_modules.');
  process.exit(0);
}

const comun = execFileSync('git', ['-c', 'safe.directory=*', '-C', wt, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const principal = path.dirname(comun);
// Rutas reales: en Windows una carpeta puede llegar con su nombre corto (C:/Users/RUNNER~1) y git da el largo.
const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
if (real(principal) === real(wt)) { console.log('Es el repo principal: no hay nada que enlazar.'); process.exit(0); }

const enlazados = [];
const distintos = [];
for (const rel of paquetes(wt)) {
  const aqui = path.join(wt, rel);
  const alla = path.join(principal, rel);
  const nombre = rel || '(raíz)';
  const destino = path.join(alla, 'node_modules');
  const nm = path.join(aqui, 'node_modules');
  if (esEnlace(nm)) { enlazados.push(`${nombre} (ya estaba)`); continue; }
  if (fs.existsSync(nm)) continue; // ya tiene sus dependencias instaladas
  if (!fs.existsSync(destino)) { distintos.push(`${nombre}: el repo principal no tiene node_modules ahí`); continue; }
  const cambia = ['package.json', ...LOCKS].filter((f) => !iguales(leer(path.join(aqui, f)), leer(path.join(alla, f))));
  if (cambia.length) { distintos.push(`${nombre}: cambia ${cambia.join(', ')} respecto del repo principal`); continue; }
  fs.symlinkSync(destino, nm, process.platform === 'win32' ? 'junction' : 'dir');
  enlazados.push(nombre);
}

const informe = [
  '# Dependencias del worktree',
  '',
  `enlazado: ${enlazados.length ? enlazados.join(', ') : 'nada'}`,
  `sin enlazar: ${distintos.length ? distintos.join(' · ') : 'nada'}`,
  '',
  'Con node_modules enlazado nadie instala dependencias aquí (el guardián lo niega): escribiría en el del repo principal.',
  'Antes de borrar este worktree: node ~/.claude/xi-0/enlazar.js <worktree> --quitar. git worktree remove borra el original a través del enlace.',
].join('\n') + '\n';
try { fs.mkdirSync(path.join(wt, '.xi-0'), { recursive: true }); fs.writeFileSync(path.join(wt, '.xi-0', 'dependencias.md'), informe); } catch { /* sin .xi-0 no pasa nada */ }
console.log(informe);
