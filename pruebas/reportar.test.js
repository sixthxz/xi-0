#!/usr/bin/env node
// Pruebas de xi-0/reportar.js con --dry-run: nada se publica.
// Un proyecto falso con nombre, rutas, repo de GitHub, correo y secretos; el texto que saldría no debe tener ninguno.
// Uso: node pruebas/reportar.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const REPORTAR = path.join(__dirname, '..', 'xi-0', 'reportar.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'xi0-reportar-'));
const proyecto = path.join(base, 'Tienda Secreta', 'mi-tienda-secreta');
const worktree = path.join(base, 'Tienda Secreta', 'wt', '20261126-fecha');
fs.mkdirSync(path.join(proyecto, '.claude', 'xi-0'), { recursive: true });
fs.mkdirSync(worktree, { recursive: true });
execFileSync('git', ['init', '-q', proyecto]);
execFileSync('git', ['-C', proyecto, 'remote', 'add', 'origin', 'https://github.com/acme-corp/mi-tienda-secreta.git']);
fs.writeFileSync(path.join(proyecto, '.claude', 'xi-0', 'config.json'), JSON.stringify({
  proyecto: 'mi-tienda-secreta', worktrees: '../wt', remoto: { repo_pr: ['acme-corp/mi-tienda-secreta', 'acme-corp/bot-pedidos'] },
}));
fs.writeFileSync(path.join(proyecto, '.claude', 'xi-0', 'activa.json'), JSON.stringify({ tarea: '20261126-fecha', tamano: 'mediana', reglas: 4, worktree_tarea: worktree }));
const instalacion = path.join(base, 'instalacion.json');
fs.writeFileSync(instalacion, JSON.stringify({ repo: 'sixthxz/xi-0', commit: 'abc1234' }));

const adelante = (p) => p.split('\\').join('/');
const gitBash = (p) => adelante(p).replace(/^([A-Za-z]):/, (_, l) => `/${l.toLowerCase()}`);
const cuerpo = [
  'Qué pasó: el guardián negó un comando legítimo en mi-tienda-secreta.',
  `Ruta del repo: ${proyecto}`,
  `Misma ruta con barras: ${adelante(proyecto)} y en Git Bash: ${gitBash(proyecto)}`,
  `Worktree: ${worktree}/src/app.ts`,
  `Home: ${os.homedir()}/.claude/xi-0/hooks/guardian.js`,
  'PR en acme-corp/mi-tienda-secreta#12 y en acme-corp/bot-pedidos#3.',
  'Contacto: dueno@acme-corp.com',
  'Token: ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789',
  'DATABASE_PASSWORD=hunter2 y API_KEY: "xyz987"',
  'Conexión: postgres://admin:clave@db.acme.local:5432/tienda',
  'Es del repo sixthxz/xi-0, regla reglaEnlaces.',
].join('\n');
const archivo = path.join(base, 'cuerpo.md');
fs.writeFileSync(archivo, cuerpo);

const correr = (extra = [], env = {}) => spawnSync(process.execPath, [REPORTAR, '--titulo', 'El guardián niega pnpm test en mi-tienda-secreta', '--cuerpo', archivo, '--proyecto', proyecto, ...extra],
  { encoding: 'utf8', env: { ...process.env, XI0_INSTALACION: instalacion, ...env } });
const casos = [];
const caso = (nombre, ok, detalle = '') => casos.push([nombre, ok, detalle]);

const r = correr(['--dry-run']);
const salida = r.stdout;
caso('el ensayo termina bien', r.status === 0, r.stderr);
const prohibidos = ['mi-tienda-secreta', 'Tienda Secreta', 'acme-corp', 'bot-pedidos', 'dueno@', 'ghp_ABCDEF', 'hunter2', 'xyz987', 'admin:clave', os.homedir(), adelante(os.homedir()), adelante(proyecto), gitBash(proyecto), '20261126-fecha/src'];
for (const p of prohibidos) caso(`no queda "${p}"`, !salida.toLowerCase().includes(p.toLowerCase()), salida);
caso('el título también se limpia', /^# El guardián niega pnpm test en <proyecto>/m.test(salida), salida.split('\n')[0]);
caso('las rutas quedan como <repo>, <worktree> y ~', salida.includes('<repo>') && salida.includes('<worktree>/src/app.ts') && salida.includes('~/.claude/xi-0/hooks/guardian.js'), salida);
caso('los repos quedan como <repo-del-proyecto>', /<repo-del-proyecto>#12/.test(salida) && /<repo-del-proyecto>#3/.test(salida), salida);
caso('los secretos quedan marcados', /DATABASE_PASSWORD=<secreto>/.test(salida) && /API_KEY=<secreto>/.test(salida) && /postgres:\/\/<secreto>/.test(salida) && salida.includes('<correo>'), salida);
caso('el repo de xi-0 no se toca', salida.includes('sixthxz/xi-0') && salida.includes('reglaEnlaces'), salida);
caso('el pie trae la versión y la tarea', /Versión instalada: abc1234/.test(salida) && /\(mediana, reglas 4\)/.test(salida), salida);

const sin = correr([], { XI0_INSTALACION: path.join(base, 'no-existe.json'), XI0_REPO: '' });
caso('sin saber el repo de xi-0, no publica', sin.status === 2 && /instalacion\.json/.test(sin.stderr), sin.stderr);

let fallos = 0;
for (const [nombre, ok, detalle] of casos) if (!ok) { fallos++; console.log(`FALLA  ${nombre}\n       ${String(detalle).trim().slice(0, 600)}`); }
fs.rmSync(base, { recursive: true, force: true });
console.log(`${casos.length - fallos} de ${casos.length} casos bien${fallos ? `, ${fallos} con falla` : ''}.`);
process.exit(fallos ? 1 : 0);
