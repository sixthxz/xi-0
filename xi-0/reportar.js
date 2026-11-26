#!/usr/bin/env node
// Reporta una falla de xi-0 como issue en el repo de xi-0 (el de ~/.claude/xi-0/instalacion.json).
//
// El repo de xi-0 es público y la falla sale de una tarea en un proyecto que no lo es: antes de publicar, el
// texto se limpia de todo lo que identifique al proyecto (rutas, nombre, repo de GitHub, correos y cosas que
// parecen secretos). Si ya hay un issue abierto con el mismo título, se comenta en él en vez de duplicarlo.
//
// Uso (lo corre la sesión principal):
//   node ~/.claude/xi-0/reportar.js --titulo "<título>" --cuerpo <archivo.md> --proyecto "<repo principal>" [--dry-run]
// --dry-run imprime el título y el cuerpo ya limpios, sin publicar nada.
// Salida: 0 publicado (imprime la URL) o dry-run · 2 error de uso · 1 gh falló.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || '') : null; };
const ensayo = args.includes('--dry-run');
const salir = (codigo, msg) => { if (msg) (codigo ? console.error : console.log)(msg); process.exit(codigo); };

const tituloCrudo = valor('--titulo');
const archivoCuerpo = valor('--cuerpo');
const proyecto = valor('--proyecto') ? path.resolve(valor('--proyecto')) : null;
if (!tituloCrudo || !archivoCuerpo) salir(2, 'Uso: node reportar.js --titulo "<título>" --cuerpo <archivo.md> --proyecto "<repo principal>" [--dry-run]');
let cuerpoCrudo;
try { cuerpoCrudo = fs.readFileSync(archivoCuerpo, 'utf8'); } catch { salir(2, `No se puede leer ${archivoCuerpo}.`); }

const leer = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const instalacion = leer(process.env.XI0_INSTALACION || path.join(__dirname, 'instalacion.json')) || {};
const repoXi0 = process.env.XI0_REPO || instalacion.repo;
if (!repoXi0 && !ensayo) salir(2, 'No sé en qué repo abrir el issue: falta ~/.claude/xi-0/instalacion.json (corre node instalar.js desde el repo de xi-0).');

// ---------- qué identifica al proyecto ----------
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Una ruta en sus formas: con \ o /, y la de Git Bash (/d/carpeta). Sin distinguir mayúsculas.
function formasDeRuta(p) {
  const adelante = p.split('\\').join('/');
  const formas = new Set([p, adelante, adelante.split('/').join('\\')]);
  const m = /^([A-Za-z]):\/(.*)$/.exec(adelante);
  if (m) formas.add(`/${m[1].toLowerCase()}/${m[2]}`);
  return [...formas].filter((f) => f.length > 3);
}
const reemplazos = []; // [regex, texto], en el orden en que se aplican
const rutas = []; // [forma, texto]: se aplican primero y de la más larga a la más corta (el worktree antes que su carpeta)
const agregarRuta = (p, texto) => { if (p) for (const f of formasDeRuta(p)) rutas.push([f, texto]); };

const cfg = proyecto ? leer(path.join(proyecto, '.claude', 'xi-0', 'config.json')) || {} : {};
const activa = proyecto ? leer(path.join(proyecto, '.claude', 'xi-0', 'activa.json')) : null;
if (proyecto) {
  if (cfg.worktrees) agregarRuta(path.resolve(proyecto, cfg.worktrees), '<worktrees>');
  if (activa && activa.worktree_tarea) agregarRuta(path.resolve(activa.worktree_tarea), '<worktree>');
  agregarRuta(proyecto, '<repo>');
}
agregarRuta(os.homedir(), '~');
for (const [f, texto] of rutas.sort((a, b) => b[0].length - a[0].length)) reemplazos.push([new RegExp(escapar(f), 'gi'), texto]);

// Repos de GitHub del proyecto: los remotos y repo_pr, menos el propio repo de xi-0.
const reposProyecto = new Set([].concat(cfg.remoto && cfg.remoto.repo_pr || []));
if (proyecto) {
  try {
    const remotos = execFileSync('git', ['-c', 'safe.directory=*', '-C', proyecto, 'remote', '-v'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const m of remotos.matchAll(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s/g)) reposProyecto.add(m[1]);
  } catch { /* sin git */ }
}
for (const r of reposProyecto) {
  if (repoXi0 && r.toLowerCase() === repoXi0.toLowerCase()) continue;
  reemplazos.push([new RegExp(escapar(r), 'gi'), '<repo-del-proyecto>']);
  const nombre = r.split('/')[1];
  if (nombre && nombre.length >= 3) reemplazos.push([new RegExp(`\\b${escapar(nombre)}\\b`, 'gi'), '<proyecto>']);
}
// Nombre del proyecto: el de la config y el de la carpeta.
for (const n of [cfg.proyecto, proyecto && path.basename(proyecto)]) {
  if (n && n.length >= 3 && !/^(repo|app|src|main)$/i.test(n)) reemplazos.push([new RegExp(`\\b${escapar(n)}\\b`, 'gi'), '<proyecto>']);
}
// Lo que parece un secreto, venga de donde venga.
reemplazos.push([/\b(ghp|gho|ghs|ghu|github_pat|sk-ant|sk|xox[abprs])[-_][A-Za-z0-9_-]{10,}/g, '<secreto>']);
reemplazos.push([/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD))\s*[=:]\s*["']?[^\s"']+["']?/g, '$1=<secreto>']);
reemplazos.push([/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<correo>']);
reemplazos.push([/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s)]+/gi, '$1://<secreto>']);

function limpiar(texto) {
  let t = texto;
  for (const [re, por] of reemplazos) t = t.replace(re, por);
  return t;
}

const titulo = limpiar(tituloCrudo).slice(0, 200);
const pie = [
  '',
  '---',
  `Reportado por xi-0 desde una tarea${activa ? ` (${activa.tamano || '?'}${activa.modo ? `, ${activa.modo}` : ''}, reglas ${activa.reglas || '?'})` : ''}.`,
  `Versión instalada: ${instalacion.commit || 'desconocida'} · ${new Date().toISOString().slice(0, 10)}. Datos del proyecto quitados antes de publicar.`,
].join('\n');
const cuerpo = limpiar(cuerpoCrudo).trimEnd() + '\n' + pie + '\n';

if (ensayo) salir(0, `# ${titulo}\n\n${cuerpo}`);

// ---------- publicar ----------
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = path.join(os.tmpdir(), `xi0-issue-${process.pid}.md`);
fs.writeFileSync(tmp, cuerpo);
// Issues que abrió este script, por título. Las listas de GitHub (gh issue list, la API REST y el buscador)
// tardan en mostrar un issue recién creado: en la prueba real, dos fallas iguales seguidas abrían dos issues.
// Pedir un issue por su número sí es inmediato, así que el registro local manda y la lista es el respaldo.
const REGISTRO = process.env.XI0_ISSUES || path.join(os.homedir(), '.claude', 'xi-0-historial', 'issues.json');
const clave = `${repoXi0.toLowerCase()} ${titulo.trim().toLowerCase()}`;
const registro = leer(REGISTRO) || {};
let resultado;
try {
  let igual = null;
  const previo = registro[clave];
  if (previo) {
    try {
      const v = JSON.parse(gh(['issue', 'view', String(previo.number), '-R', repoXi0, '--json', 'number,state,url']));
      if (v.state === 'OPEN') igual = v;
    } catch { /* ya no existe */ }
  }
  if (!igual) {
    let abiertos = [];
    try { abiertos = JSON.parse(gh(['issue', 'list', '-R', repoXi0, '--state', 'open', '--label', 'desde-tarea', '--json', 'number,title,url', '-L', '200']) || '[]'); } catch { /* la etiqueta todavía no existe */ }
    igual = abiertos.find((i) => i.title.trim().toLowerCase() === titulo.trim().toLowerCase()) || null;
  }
  if (igual) {
    gh(['issue', 'comment', String(igual.number), '-R', repoXi0, '--body-file', tmp]);
    resultado = [0, `Ya había un issue igual; se agregó un comentario: ${igual.url}`];
  } else {
    const crear = () => gh(['issue', 'create', '-R', repoXi0, '--title', titulo, '--body-file', tmp, '--label', 'desde-tarea']);
    let url;
    try { url = crear(); } catch (e) {
      if (!/label/i.test(String(e.stderr || ''))) throw e;
      gh(['label', 'create', 'desde-tarea', '-R', repoXi0, '--color', 'D93F0B', '--description', 'Falla de xi-0 encontrada durante una tarea real']);
      url = crear();
    }
    registro[clave] = { number: Number(url.split('/').pop()), url, fecha: new Date().toISOString() };
    try { fs.mkdirSync(path.dirname(REGISTRO), { recursive: true }); fs.writeFileSync(REGISTRO, JSON.stringify(registro, null, 1) + '\n'); } catch { /* el issue ya está; solo se pierde la deduplicación */ }
    resultado = [0, url];
  }
} catch (e) {
  resultado = [1, `gh falló: ${String(e.stderr || e.message).trim().slice(0, 300)}`];
}
fs.rmSync(tmp, { force: true });
salir(...resultado);
