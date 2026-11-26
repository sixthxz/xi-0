#!/usr/bin/env node
// Pruebas de xi-0/ci.js sin GitHub: un repo temporal con un remoto local (bare) y --sin-esperar.
// Comprueba la instantánea (cambios sin commit y archivos nuevos sí, .xi-0/ no), que no toca la rama ni el
// índice de la tarea, la numeración de las ramas, --comprobar y --limpiar.
// Uso: node pruebas/ci.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const CI = path.join(__dirname, '..', 'xi-0', 'ci.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'xi0-ci-'));
const repo = path.join(base, 'repo');
const remoto = path.join(base, 'remoto.git');
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=prueba', '-c', 'user.email=prueba@example.invalid', ...a], { encoding: 'utf8' }).trim();

execFileSync('git', ['init', '-q', '--bare', remoto]);
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
git(repo, 'config', 'core.autocrlf', 'false');
fs.writeFileSync(path.join(repo, 'a.txt'), 'uno\n');
git(repo, 'add', 'a.txt');
git(repo, 'commit', '-q', '-m', 'base');
git(repo, 'remote', 'add', 'origin', remoto);
git(repo, 'checkout', '-q', '-b', 'tarea/t1');
fs.mkdirSync(path.join(repo, '.claude', 'xi-0'), { recursive: true });
fs.writeFileSync(path.join(repo, '.claude', 'xi-0', 'config.json'), JSON.stringify({ rama_base: 'main', ci: { workflow: 'verificacion.yml' }, remoto: { push: true, remote_permitido: 'origin' } }));
fs.writeFileSync(path.join(repo, '.claude', 'xi-0', 'activa.json'), JSON.stringify({ tarea: 't1', reglas: 4, worktree_tarea: repo }));
fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '.claude/\n');

// Lo que tiene la tarea: un cambio sin commit, un archivo nuevo y su rastro en .xi-0/.
fs.writeFileSync(path.join(repo, 'a.txt'), 'dos\n');
fs.writeFileSync(path.join(repo, 'b.txt'), 'nuevo\n');
fs.mkdirSync(path.join(repo, '.xi-0', 'qa'), { recursive: true });
fs.writeFileSync(path.join(repo, '.xi-0', 'tarea.md'), 'rastro\n');

const ci = (...a) => spawnSync(process.execPath, [CI, repo, ...a], { encoding: 'utf8' });
const casos = [];
const caso = (nombre, ok, detalle) => casos.push([nombre, ok, detalle]);

const headAntes = git(repo, 'rev-parse', 'HEAD');
const estadoAntes = git(repo, 'status', '--porcelain');
let r = ci('--sin-esperar');
caso('sube la primera instantánea', r.status === 0 && /Subida tarea\/t1-ci-1/.test(r.stdout), r.stdout + r.stderr);
const ref1 = git(remoto, 'rev-parse', 'refs/heads/tarea/t1-ci-1');
const archivos = git(remoto, 'ls-tree', '-r', '--name-only', ref1).split('\n');
caso('lleva el archivo nuevo', archivos.includes('b.txt'), archivos.join(','));
caso('lleva el cambio sin commit', git(remoto, 'show', `${ref1}:a.txt`) === 'dos', '');
caso('no lleva .xi-0/', !archivos.some((f) => f.startsWith('.xi-0/')), archivos.join(','));
caso('su padre es el HEAD de la tarea', git(remoto, 'rev-parse', `${ref1}^`) === headAntes, '');
caso('no toca la rama de la tarea', git(repo, 'rev-parse', 'HEAD') === headAntes, '');
caso('no toca el índice ni los archivos', git(repo, 'status', '--porcelain') === estadoAntes, git(repo, 'status', '--porcelain'));
caso('deja el registro en .xi-0/ci', fs.existsSync(path.join(repo, '.xi-0', 'ci', 'ultimo.json')) && fs.existsSync(path.join(repo, '.xi-0', 'ci', '1.md')), '');

r = ci('--sin-esperar');
caso('la segunda corrida es la 2', r.status === 0 && /tarea\/t1-ci-2/.test(r.stdout), r.stdout + r.stderr);

// --comprobar: el commit único (sin .xi-0/) contra la última corrida.
r = ci('--comprobar');
caso('comprobar sin corrida en verde falla', r.status === 1 && /no está en verde/.test(r.stdout), r.stdout);
const u = JSON.parse(fs.readFileSync(path.join(repo, '.xi-0', 'ci', 'ultimo.json'), 'utf8'));
u.resultado = 'success'; u.url = 'https://ejemplo/run/1';
fs.writeFileSync(path.join(repo, '.xi-0', 'ci', 'ultimo.json'), JSON.stringify(u));
r = ci('--comprobar');
caso('comprobar antes del commit no coincide', r.status === 1 && /no es lo que pasó en verde/.test(r.stdout), r.stdout);
git(repo, 'add', '-A', '--', '.', ':(exclude).xi-0');
git(repo, 'commit', '-q', '-m', 'fix: tarea t1');
r = ci('--comprobar');
caso('comprobar con el commit único coincide', r.status === 0 && /Verificado/.test(r.stdout), r.stdout + r.stderr);
fs.writeFileSync(path.join(repo, 'a.txt'), 'tres\n');
git(repo, 'commit', '-q', '-am', 'otro cambio');
r = ci('--comprobar');
caso('comprobar tras otro cambio no coincide', r.status === 1, r.stdout);

r = ci('--limpiar');
const quedan = git(remoto, 'for-each-ref', '--format=%(refname)', 'refs/heads/tarea/');
caso('limpiar borra las ramas de CI', r.status === 0 && quedan === '', quedan);

// Sin la config de CI no hace nada.
fs.writeFileSync(path.join(repo, '.claude', 'xi-0', 'config.json'), JSON.stringify({ remoto: { push: true, remote_permitido: 'origin' } }));
r = ci('--sin-esperar');
caso('sin "ci" en la config, error de config', r.status === 2 && /"ci"/.test(r.stderr), r.stderr);
fs.writeFileSync(path.join(repo, '.claude', 'xi-0', 'config.json'), JSON.stringify({ ci: { workflow: 'v.yml' }, remoto: { push: false } }));
r = ci('--sin-esperar');
caso('sin push permitido, error de config', r.status === 2 && /remoto.push=true/.test(r.stderr), r.stderr);

let fallos = 0;
for (const [nombre, ok, detalle] of casos) if (!ok) { fallos++; console.log(`FALLA  ${nombre}\n       ${String(detalle).trim().slice(0, 300)}`); }
fs.rmSync(base, { recursive: true, force: true });
console.log(`${casos.length - fallos} de ${casos.length} casos bien${fallos ? `, ${fallos} con falla` : ''}.`);
process.exit(fallos ? 1 : 0);
