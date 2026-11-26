#!/usr/bin/env node
// Reporta fallas de xi-0 como issues en el repo de xi-0 (el de ~/.claude/xi-0/instalacion.json).
//
// El repo de xi-0 es público y la falla sale de una tarea en un proyecto que no lo es: antes de publicar, el
// texto se limpia de todo lo que identifique al proyecto (rutas, nombre, repo de GitHub, correos y cosas que
// parecen secretos). Si ya hay un issue abierto con el mismo título, se comenta en él en vez de duplicarlo.
//
// Uso (lo corre la sesión principal):
//   node ~/.claude/xi-0/reportar.js --titulo "<título>" --cuerpo <archivo.md> --proyecto "<repo principal>" [--dry-run]
//     una falla que notó xi-0 (instrucciones que se contradicen, un agente atascado…)
//   node ~/.claude/xi-0/reportar.js --recolectar --proyecto "<repo principal>" [--desde <ISO>] [--dry-run]
//     al cerrar la tarea: junta del registro del guardián lo que es falla de xi-0 sin que nadie tenga que notarlo
//     (errores del guardián, errores de scripts de xi-0, el mismo bloqueo repetido) y abre un issue por cada una
// --dry-run imprime lo que se publicaría, ya limpio, sin publicar nada.
// Salida: 0 publicado o dry-run (imprime las URLs) · 2 error de uso · 1 gh falló.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || '') : null; };
const ensayo = args.includes('--dry-run');
const recolectar = args.includes('--recolectar');
const salir = (codigo, msg) => { if (msg) (codigo ? console.error : console.log)(msg); process.exit(codigo); };
const USO = 'Uso: node reportar.js --titulo "<título>" --cuerpo <archivo.md> --proyecto "<repo>" [--dry-run]\n     node reportar.js --recolectar --proyecto "<repo>" [--desde <ISO>] [--dry-run]';

const proyecto = valor('--proyecto') ? path.resolve(valor('--proyecto')) : null;
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
const reposProyecto = new Set([].concat((cfg.remoto && cfg.remoto.repo_pr) || []));
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
  let t = String(texto);
  for (const [re, por] of reemplazos) t = t.replace(re, por);
  return t;
}
const pie = () => [
  '',
  '---',
  `Reportado por xi-0 desde una tarea${activa ? ` (${activa.tamano || '?'}${activa.modo ? `, ${activa.modo}` : ''}, reglas ${activa.reglas || '?'})` : ''}.`,
  `Versión instalada: ${instalacion.commit || 'desconocida'} · ${new Date().toISOString().slice(0, 10)}. Datos del proyecto quitados antes de publicar.`,
].join('\n');

// ---------- publicar ----------
// Issues que abrió este script, por título. Las listas de GitHub (gh issue list, la API REST y el buscador)
// tardan en mostrar un issue recién creado: en la prueba real, dos fallas iguales seguidas abrían dos issues.
// Pedir un issue por su número sí es inmediato, así que el registro local manda y la lista es el respaldo.
const REGISTRO = process.env.XI0_ISSUES || path.join(os.homedir(), '.claude', 'xi-0-historial', 'issues.json');
const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function publicar(tituloCrudo, cuerpoCrudo) {
  const titulo = limpiar(tituloCrudo).slice(0, 200);
  const cuerpo = limpiar(cuerpoCrudo).trimEnd() + '\n' + pie() + '\n';
  if (ensayo) return [0, `# ${titulo}\n\n${cuerpo}`];
  const clave = `${repoXi0.toLowerCase()} ${titulo.trim().toLowerCase()}`;
  const registro = leer(REGISTRO) || {};
  const tmp = path.join(os.tmpdir(), `xi0-issue-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(tmp, cuerpo);
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
      return [0, `Ya había un issue igual; se agregó un comentario: ${igual.url}`];
    }
    const crear = () => gh(['issue', 'create', '-R', repoXi0, '--title', titulo, '--body-file', tmp, '--label', 'desde-tarea']);
    let url;
    try { url = crear(); } catch (e) {
      if (!/label/i.test(String(e.stderr || ''))) throw e;
      gh(['label', 'create', 'desde-tarea', '-R', repoXi0, '--color', 'D93F0B', '--description', 'Falla de xi-0 encontrada durante una tarea real']);
      url = crear();
    }
    registro[clave] = { number: Number(url.split('/').pop()), url, fecha: new Date().toISOString() };
    try { fs.mkdirSync(path.dirname(REGISTRO), { recursive: true }); fs.writeFileSync(REGISTRO, JSON.stringify(registro, null, 1) + '\n'); } catch { /* el issue ya está; solo se pierde la deduplicación */ }
    return [0, url];
  } catch (e) {
    return [1, `gh falló: ${String(e.stderr || e.message).trim().slice(0, 300)}`];
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---------- recolectar del registro del guardián ----------
// Solo lo que es falla de xi-0 sin necesidad de criterio:
// - el guardián falló (motivo "El guardián falló…"): siempre es un error de xi-0 o de su configuración;
// - un script de xi-0 tuvo un error interno (decision "error-script", lo anotan ci.js, enlazar.js y metricas.js);
// - el mismo bloqueo se repitió REPETIDO veces o más: un bloqueo falso, o una instrucción que no se entiende.
const REPETIDO = 3;
// El motivo sin lo que cambia de una vez a otra: comandos y rutas entre comillas, números, horas.
const forma = (m) => String(m).replace(/"[^"]*"/g, '"…"').replace(/`[^`]*`/g, '`…`').replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
const corto = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function fallasDelRegistro(desde) {
  const filas = (fs.existsSync(path.join(proyecto, '.claude', 'xi-0', 'registro.jsonl')) ? fs.readFileSync(path.join(proyecto, '.claude', 'xi-0', 'registro.jsonl'), 'utf8') : '')
    .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && (!desde || r.t >= desde));
  const grupos = new Map();
  const sumar = (clase, clave, r) => {
    const k = `${clase} ${clave}`;
    const g = grupos.get(k) || { clase, clave, veces: 0, quienes: new Set(), primero: r.t, ultimo: r.t, ejemplo: r.motivo };
    g.veces++; g.quienes.add(r.quien || '?'); g.ultimo = r.t;
    grupos.set(k, g);
  };
  for (const r of filas) {
    const m = String(r.motivo || '');
    if (/^El guardián falló/.test(m) || r.decision === 'error') sumar('guardian', forma(m), r);
    else if (r.decision === 'error-script') sumar('script', `${r.script || '?'}: ${forma(m)}`, r);
    else if (r.decision === 'deny' || r.decision === 'block') sumar('bloqueo', forma(m), r);
  }
  return [...grupos.values()].filter((g) => g.clase !== 'bloqueo' || g.veces >= REPETIDO);
}

function issueDe(g) {
  const quienes = [...g.quienes].join(', ');
  const cuando = `entre ${g.primero} y ${g.ultimo}`;
  if (g.clase === 'guardian') return [
    `El guardián falló: ${corto(g.clave.replace(/^El guardián falló y por seguridad no deja pasar la llamada: /, ''))}`,
    `**Qué pasó:** el guardián tuvo un error y negó la llamada por seguridad (${g.veces} ${g.veces === 1 ? 'vez' : 'veces'}, ${cuando}; agentes: ${quienes}).\n\n**Motivo registrado:**\n\n> ${g.ejemplo}\n\n**Qué se esperaba:** que el guardián decidiera sin fallar.`,
  ];
  if (g.clase === 'script') return [
    `Error en ${corto(g.clave)}`,
    `**Qué pasó:** un script de xi-0 terminó con un error interno (${g.veces} ${g.veces === 1 ? 'vez' : 'veces'}, ${cuando}).\n\n**Error registrado:**\n\n> ${g.ejemplo}`,
  ];
  return [
    `Bloqueo repetido del guardián: ${corto(g.clave)}`,
    `**Qué pasó:** el guardián negó lo mismo ${g.veces} veces en una tarea (${cuando}; agentes: ${quienes}). Cada bloqueo cuesta un turno. Puede ser un bloqueo falso, o una instrucción que lleva al agente a intentar algo que la regla no deja.\n\n**Motivo (ejemplo):**\n\n> ${g.ejemplo}\n\n**Qué revisar:** si la regla debería dejarlo pasar, o si las instrucciones del agente deberían decir otra forma de hacerlo.`,
  ];
}

// ---------- entrada ----------
if (recolectar) {
  if (!proyecto) salir(2, USO);
  const desde = valor('--desde') || (activa && activa.inicio) || null;
  const fallas = fallasDelRegistro(desde);
  if (!fallas.length) salir(0, 'Sin fallas de xi-0 en el registro de esta tarea.');
  const salidas = []; let peor = 0;
  for (const g of fallas) {
    const [titulo, cuerpo] = issueDe(g);
    const [codigo, msg] = publicar(titulo, cuerpo);
    peor = Math.max(peor, codigo); salidas.push(msg);
  }
  salir(peor, salidas.join(ensayo ? '\n\n========\n\n' : '\n'));
}

const tituloCrudo = valor('--titulo');
const archivoCuerpo = valor('--cuerpo');
if (!tituloCrudo || !archivoCuerpo) salir(2, USO);
let cuerpoCrudo;
try { cuerpoCrudo = fs.readFileSync(archivoCuerpo, 'utf8'); } catch { salir(2, `No se puede leer ${archivoCuerpo}.`); }
salir(...publicar(tituloCrudo, cuerpoCrudo));
