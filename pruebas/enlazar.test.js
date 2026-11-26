#!/usr/bin/env node
// Pruebas de xi-0/enlazar.js en un repo temporal con un worktree real.
// Comprueba: enlaza cuando package.json y lockfile son iguales, no enlaza si cambian, el worktree resuelve
// los paquetes del repo principal, --quitar deja el original intacto, y después de --quitar borrar el
// worktree con git ya no toca el node_modules del repo principal.
// Uso: node pruebas/enlazar.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ENLAZAR = path.join(__dirname, '..', 'xi-0', 'enlazar.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'xi0-enlazar-'));
const repo = path.join(base, 'repo');
const wt = path.join(base, 'wt');
const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=prueba', '-c', 'user.email=prueba@example.invalid', ...a], { encoding: 'utf8' }).trim();
const escribir = (p, txt) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); };
const esEnlace = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

execFileSync('git', ['init', '-q', '-b', 'main', repo]);
git('config', 'core.autocrlf', 'false');
escribir(path.join(repo, '.gitignore'), 'node_modules/\n');
// Raíz y un paquete "spa" con sus propias dependencias.
for (const d of ['', 'spa']) {
  escribir(path.join(repo, d, 'package.json'), `{"name":"p${d}","version":"1.0.0"}\n`);
  escribir(path.join(repo, d, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n# ${d || 'raiz'}\n`);
  escribir(path.join(repo, d, 'node_modules', 'dep', 'index.js'), `module.exports = '${d || 'raiz'}';\n`);
}
git('add', '.');
git('commit', '-q', '-m', 'base');
git('worktree', 'add', '-q', wt, '-b', 'tarea/t1');
// En la tarea, spa cambia su lockfile: no se puede enlazar.
escribir(path.join(wt, 'spa', 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n# spa con una dependencia nueva\n");

const correr = (...a) => spawnSync(process.execPath, [ENLAZAR, ...a], { encoding: 'utf8' });
const casos = [];
const caso = (nombre, ok, detalle = '') => casos.push([nombre, ok, detalle]);

let r = correr(wt);
caso('termina bien', r.status === 0, r.stderr);
caso('enlaza la raíz (package.json y lockfile iguales)', esEnlace(path.join(wt, 'node_modules')), r.stdout);
caso('no enlaza spa (cambió el lockfile)', !esEnlace(path.join(wt, 'spa', 'node_modules')) && /spa: cambia pnpm-lock\.yaml/.test(r.stdout), r.stdout);
caso('el worktree resuelve los paquetes del repo principal', require(path.join(wt, 'node_modules', 'dep')) === 'raiz');
caso('deja el informe en .xi-0/dependencias.md', /enlazado: \(raíz\)/.test(fs.readFileSync(path.join(wt, '.xi-0', 'dependencias.md'), 'utf8')));
r = correr(wt);
caso('correrlo otra vez no rompe nada', r.status === 0 && /ya estaba/.test(r.stdout), r.stdout + r.stderr);
r = correr(repo);
caso('en el repo principal no hace nada', r.status === 0 && /Es el repo principal/.test(r.stdout), r.stdout + r.stderr);

r = correr(wt, '--quitar');
caso('--quitar quita el enlace', r.status === 0 && !fs.existsSync(path.join(wt, 'node_modules')), r.stdout);
caso('--quitar deja el original intacto', fs.existsSync(path.join(repo, 'node_modules', 'dep', 'index.js')));
fs.rmSync(path.join(wt, '.xi-0'), { recursive: true, force: true });
git('worktree', 'remove', '--force', wt);
caso('sin enlace, git worktree remove no toca el original', fs.existsSync(path.join(repo, 'node_modules', 'dep', 'index.js')) && !fs.existsSync(wt));

let fallos = 0;
for (const [nombre, ok, detalle] of casos) if (!ok) { fallos++; console.log(`FALLA  ${nombre}\n       ${String(detalle).trim().slice(0, 300)}`); }
fs.rmSync(base, { recursive: true, force: true });
console.log(`${casos.length - fallos} de ${casos.length} casos bien${fallos ? `, ${fallos} con falla` : ''}.`);
process.exit(fallos ? 1 : 0);
