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

// --- --recolectar: del registro del guardián, solo lo que es falla de xi-0 ---
const inicio = '2026-11-26T10:00:00.000Z';
fs.writeFileSync(path.join(proyecto, '.claude', 'xi-0', 'activa.json'), JSON.stringify({ tarea: '20261126-fecha', tamano: 'mediana', reglas: 4, worktree_tarea: worktree, inicio }));
const registro = [
  { t: '2026-11-26T09:00:00.000Z', quien: 'argos', decision: 'deny', motivo: 'argos no puede ejecutar "sort". Permitidos: git.' }, // antes de la tarea
  { t: '2026-11-26T10:05:00.000Z', quien: 'forja', decision: 'deny', motivo: 'El guardián falló y por seguridad no deja pasar la llamada: Invalid regular expression: /(/: Unterminated group. Revisa .claude/xi-0/config.json' },
  ...['sort', 'sort -u', 'sort -r', 'sort -n'].map((c, i) => ({ t: `2026-11-26T10:1${i}:00.000Z`, quien: 'argos', decision: 'deny', motivo: `argos no puede ejecutar "${c}". Permitidos: git, ls.` })),
  ...[1, 2].map((i) => ({ t: `2026-11-26T10:2${i}:00.000Z`, quien: 'prisma', decision: 'deny', motivo: 'prisma no es dueño de "api/x.cs".' })),
  { t: '2026-11-26T10:30:00.000Z', evento: 'script', script: 'ci.js', decision: 'error-script', motivo: `Command failed: git push origin ${adelante(worktree)}` },
  { t: '2026-11-26T10:31:00.000Z', quien: 'argos', decision: 'lanza', tipo: 'argos-ligero' },
];
fs.writeFileSync(path.join(proyecto, '.claude', 'xi-0', 'registro.jsonl'), registro.map((x) => JSON.stringify(x)).join('\n') + '\n');
const rec = spawnSync(process.execPath, [REPORTAR, '--recolectar', '--proyecto', proyecto, '--dry-run'], { encoding: 'utf8', env: { ...process.env, XI0_INSTALACION: instalacion } });
const issues = rec.stdout.split('\n\n========\n\n');
caso('recolectar termina bien', rec.status === 0, rec.stderr);
caso('recolectar arma tres issues', issues.length === 3, rec.stdout.slice(0, 500));
caso('el error del guardián es un issue', /^# El guardián falló: Invalid regular expression/m.test(rec.stdout), rec.stdout);
caso('el bloqueo repetido junta las cuatro veces aunque cambie el comando', /# Bloqueo repetido del guardián: argos no puede ejecutar "…"/.test(rec.stdout) && /negó lo mismo 4 veces/.test(rec.stdout), rec.stdout);
caso('un bloqueo de dos veces no se reporta', !/no es dueño/.test(rec.stdout), rec.stdout);
caso('lo anterior al inicio de la tarea no cuenta', !/negó lo mismo 5 veces/.test(rec.stdout), rec.stdout);
caso('el error de script es un issue, con la ruta limpia', /^# Error en ci\.js/m.test(rec.stdout) && rec.stdout.includes('<worktree>') && !rec.stdout.includes(adelante(worktree)), rec.stdout);
fs.writeFileSync(path.join(proyecto, '.claude', 'xi-0', 'registro.jsonl'), JSON.stringify({ t: '2026-11-26T10:40:00.000Z', quien: 'argos', decision: 'deny', motivo: 'una vez' }) + '\n');
const nada = spawnSync(process.execPath, [REPORTAR, '--recolectar', '--proyecto', proyecto, '--dry-run'], { encoding: 'utf8', env: { ...process.env, XI0_INSTALACION: instalacion } });
caso('sin fallas, lo dice y no arma nada', nada.status === 0 && /Sin fallas de xi-0/.test(nada.stdout), nada.stdout);

// --- anotar.js: el error interno de un script queda en el registro ---
require(path.join(__dirname, '..', 'xi-0', 'anotar.js')).anotar('enlazar.js', worktree.replace(/wt.*/, 'mi-tienda-secreta'), new Error('algo se rompió\nsegunda línea'));
const ultima = JSON.parse(fs.readFileSync(path.join(proyecto, '.claude', 'xi-0', 'registro.jsonl'), 'utf8').trim().split('\n').pop());
caso('anotar deja el error del script en el registro', ultima.decision === 'error-script' && ultima.script === 'enlazar.js' && /algo se rompió segunda línea/.test(ultima.motivo), JSON.stringify(ultima));

let fallos = 0;
for (const [nombre, ok, detalle] of casos) if (!ok) { fallos++; console.log(`FALLA  ${nombre}\n       ${String(detalle).trim().slice(0, 600)}`); }
fs.rmSync(base, { recursive: true, force: true });
console.log(`${casos.length - fallos} de ${casos.length} casos bien${fallos ? `, ${fallos} con falla` : ''}.`);
process.exit(fallos ? 1 : 0);
