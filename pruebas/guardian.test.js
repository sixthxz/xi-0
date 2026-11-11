#!/usr/bin/env node
// Pruebas del guardián: le pasa eventos de hook sintéticos y compara la decisión.
// Uso: node pruebas/guardian.test.js [ruta a guardian.js]
// Crea un repo git temporal con una config de ejemplo; no toca ningún repo real.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const GUARDIAN = path.resolve(process.argv[2] || path.join(__dirname, '..', 'xi-0', 'hooks', 'guardian.js'));
const EJEMPLO = path.join(__dirname, '..', 'xi-0', 'config.ejemplo.json');

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xi0-prueba-'));
execFileSync('git', ['init', '-q', repo]);
fs.mkdirSync(path.join(repo, '.claude', 'xi-0'), { recursive: true });
const cfg = JSON.parse(fs.readFileSync(EJEMPLO, 'utf8'));
cfg.remoto = { push: true, remote_permitido: 'fork', pr: true, repo_pr: 'yo/fork', merge: false };
fs.writeFileSync(path.join(repo, '.claude', 'xi-0', 'config.json'), JSON.stringify(cfg));

const ACTIVAS = {
  ninguna: null,
  reglas2: { tarea: 't1', reglas: 2 },
  chica: { tarea: 't1', reglas: 3, tamano: 'chica', fases: [] },
  medianaYunque: { tarea: 't1', reglas: 3, tamano: 'mediana', fases: ['yunque'] },
  medianaMeridiano: { tarea: 't1', reglas: 3, tamano: 'mediana', fases: ['meridiano'] },
};
const palabras = (n) => Array(n).fill('palabra').join(' ');
const msg = (to, message) => ['SendMessage', { to, message }];
const bash = (command, extra) => ['Bash', { command, ...extra }];
const agente = (subagent_type, name) => ['Agent', { subagent_type, name: name || '', prompt: 'p' }];
const PASA = 'pasa';

// [nombre, tarea activa, quién llama (null = xi-0), [herramienta, entrada], PASA o regex del motivo, preparación previa]
const CASOS = [
  // --- Mensajes: como siempre con reglas 2 ---
  ['xi-0 no ordena a un equipo', 'reglas2', null, msg('prisma', 'haz el cambio'), /saltándose a su líder de fase/],
  ['xi-0 sí puede cerrar a un equipo', 'reglas2', null, msg('prisma', 'cierra ya'), PASA],
  ['un equipo no escribe a xi-0', 'reglas2', 'prisma', msg('team-lead', 'entrega lista'), /no tiene línea con xi-0/],
  ['un equipo escribe a su fase', 'reglas2', 'prisma', msg('yunque', 'entrega lista'), PASA],
  ['ficha de más de 180 palabras', 'reglas2', 'prisma', msg('yunque', palabras(190)), /Ficha demasiado larga/],
  ['equipos sin línea', 'reglas2', 'prisma', msg('codice', 'hola'), /no tiene línea con codice/],
  // --- Mensajes: tarea chica (sin líderes de fase) ---
  ['chica: xi-0 encarga directo', 'chica', null, msg('prisma', 'haz el cambio'), PASA],
  ['chica: el equipo reporta a xi-0', 'chica', 'prisma', msg('team-lead', 'entrega lista'), PASA],
  ['chica: QA reporta a xi-0', 'chica', 'argos', msg('team-lead', 'qa ok'), PASA],
  ['chica: ficha directa de 240 palabras', 'chica', 'prisma', msg('team-lead', palabras(240)), PASA],
  ['chica: ficha directa de 260 palabras', 'chica', 'prisma', msg('team-lead', palabras(260)), /Ficha demasiado larga \(260 palabras, máximo 250\)/],
  ['chica: la fase no está activa', 'chica', 'prisma', msg('yunque', 'entrega lista'), /yunque no está activo/],
  ['chica: equipos sin línea siguen negados', 'chica', 'prisma', msg('codice', 'hola'), /no tiene línea con codice/],
  // --- Mensajes: mediana con una sola fase activa ---
  ['mediana: con su fase activa, pasa por ella', 'medianaYunque', 'prisma', msg('team-lead', 'entrega'), /no tiene línea con xi-0/],
  ['mediana: xi-0 no se salta una fase activa', 'medianaYunque', null, msg('prisma', 'haz el cambio'), /saltándose a su líder de fase/],
  ['mediana: equipo de una fase inactiva reporta a xi-0', 'medianaYunque', 'argos', msg('team-lead', 'qa ok'), PASA],
  // --- Lanzar agentes ---
  ['xi-0 lanza a un líder', 'chica', null, agente('prisma', 'prisma'), PASA],
  ['xi-0 no lanza ligeros', 'reglas2', null, agente('prisma-ligero', 'x'), /solo lanza líderes/],
  ['un equipo lanza su ligero', 'reglas2', 'prisma', agente('prisma-ligero'), PASA],
  ['chica: sin ligeros', 'chica', 'prisma', agente('prisma-ligero'), /Tarea chica/],
  ['mediana: con ligeros', 'medianaMeridiano', 'forja', agente('forja-ligero'), PASA],
  // --- Remotos: con Yunque (o sin tarea) ---
  ['Yunque sube la rama', 'reglas2', 'yunque', bash('git push fork tarea/t1'), PASA],
  ['Faro no sube si está Yunque', 'reglas2', 'faro', bash('git push fork tarea/t1'), /Solo Yunque sube/],
  ['sin tarea activa también aplica', 'ninguna', 'faro', bash('git push fork tarea/t1'), /Solo Yunque sube/],
  ['Yunque abre el PR', 'medianaYunque', 'yunque', bash('gh pr create -R yo/fork --fill'), PASA],
  ['Faro no abre el PR si está Yunque', 'medianaYunque', 'faro', bash('gh pr create -R yo/fork --fill'), /Solo Yunque abre/],
  ['nunca a main', 'reglas2', 'yunque', bash('git push fork main'), /Nunca push a main/],
  ['nunca forzado', 'reglas2', 'yunque', bash('git push -f fork tarea/t1'), /push forzado/],
  ['solo el remoto permitido', 'reglas2', 'yunque', bash('git push origin tarea/t1'), /Solo se permite push al remoto/],
  ['merge desactivado', 'reglas2', 'faro', bash('gh pr merge 3'), /merge está desactivado/],
  // --- Remotos: sin Yunque publica Faro ---
  ['chica: Faro sube la rama', 'chica', 'faro', bash('git push fork tarea/t1'), PASA],
  ['chica: Faro abre el PR', 'chica', 'faro', bash('gh pr create -R yo/fork --fill'), PASA],
  ['chica: Faro, PR sin -R', 'chica', 'faro', bash('gh pr create --fill'), /debe llevar -R yo\/fork/],
  ['chica: Faro, nunca a main', 'chica', 'faro', bash('git push fork main'), /Nunca push a main/],
  ['chica: Faro, nunca forzado', 'chica', 'faro', bash('git push -f fork tarea/t1'), /push forzado/],
  ['chica: un ligero de Faro no sube', 'chica', 'faro-ligero', bash('git push fork tarea/t1'), /Solo Faro sube/],
  ['chica: Yunque ya no sube', 'chica', 'yunque', bash('git push fork tarea/t1'), /Solo Faro sube/],
  ['chica: un constructor no sube', 'chica', 'prisma', bash('git push fork tarea/t1'), /Solo Faro sube/],
  ['chica: xi-0 no abre el PR', 'chica', null, bash('gh pr create -R yo/fork --fill'), /Solo Faro abre/],
  ['mediana sin Yunque: Faro sube', 'medianaMeridiano', 'faro', bash('git push fork tarea/t1'), PASA],
  // --- Remotos: el push se reconoce esté escrito como esté ---
  ['push: git -C no lo esconde', 'reglas2', 'yunque', bash('git -C . push fork main'), /Nunca push a main/],
  ['push: git -c no lo esconde', 'reglas2', 'yunque', bash('git -c a=b push fork tarea/t1 --force'), /push forzado/],
  ['push: main entre comillas', 'reglas2', 'yunque', bash('git push fork "main"'), /Nunca push a main/],
  ['push: destino refs/heads/main', 'reglas2', 'yunque', bash('git push fork HEAD:refs/heads/main'), /Nunca push a main/],
  ['push: tarea hacia main', 'reglas2', 'yunque', bash('git push fork tarea/t1:main'), /Nunca push a main/],
  ['push: borrar main', 'reglas2', 'yunque', bash('git push fork :main'), /Nunca push a main/],
  ['push: banderas cortas juntas', 'reglas2', 'yunque', bash('git push -uf fork tarea/t1'), /push forzado/],
  ['push: forzado con +', 'reglas2', 'yunque', bash('git push fork +tarea/t1'), /push forzado/],
  ['push: el remoto es el primer argumento', 'reglas2', 'yunque', bash('git push origin fork'), /Solo se permite push al remoto/],
  ['push: tras un & solo', 'reglas2', 'yunque', bash('ls & git push origin main'), /Solo se permite push al remoto/],
  ['push: dentro de $( )', 'reglas2', 'yunque', bash('echo $(git push origin main)'), /Solo se permite push al remoto/],
  ['push: dentro de comillas invertidas', 'reglas2', 'yunque', bash('echo `git push origin main`'), /Solo se permite push al remoto/],
  ['push: $( ) dentro de comillas dobles', 'reglas2', 'yunque', bash('echo "x $(git push fork main)"'), /Nunca push a main/],
  ['push: entre paréntesis', 'reglas2', 'yunque', bash('(git push fork main)'), /Nunca push a main/],
  ['push: con env delante', 'reglas2', 'yunque', bash('env A=1 git push fork main'), /Nunca push a main/],
  ['push: dentro de bash -c', 'reglas2', 'yunque', bash('bash -c "git push fork main"'), /Nunca push a main/],
  ['push: git.exe con ruta', 'reglas2', 'yunque', bash('"C:\\Program Files\\Git\\bin\\git.exe" push fork main'), /Nunca push a main/],
  ['push: sin rama', 'reglas2', 'yunque', bash('git push fork'), /nombra la rama/],
  ['push: --all', 'reglas2', 'yunque', bash('git push --all fork'), /nombra la rama/],
  ['push: --repo', 'reglas2', 'yunque', bash('git push --repo=origin fork tarea/t1'), /Solo se permite push al remoto/],
  ['push: un agente cualquiera con -C', 'reglas2', 'prisma', bash('git -C . push fork tarea/t1'), /Solo Yunque sube/],
  ['push: remoto entre comillas vale', 'reglas2', 'yunque', bash('git push "fork" tarea/t1'), PASA],
  ['push: con -u vale', 'reglas2', 'yunque', bash('git push -u fork tarea/t1'), PASA],
  ['push: una rama que se llama parecido vale', 'reglas2', 'yunque', bash('git push fork tarea/main-menu'), PASA],
  ['push: hablar de push en un commit no es push', 'reglas2', 'yunque', bash('git commit -m "listo para git push origin main"'), PASA],
  ['gh: -R antes de pr create', 'medianaYunque', 'faro', bash('gh -R yo/fork pr create --fill'), /Solo Yunque abre/],
  ['gh: merge con env delante', 'reglas2', 'faro', bash('env gh pr merge 3'), /merge está desactivado/],
  // --- Si el guardián falla, niega ---
  ['config con una regex mal escrita', 'reglas2', 'forja', bash('dotnet build'), /El guardián falló/, { config: (c) => { c.comandos.forja = ['re:(']; } }],
  ['config que no es JSON', 'reglas2', 'forja', bash('ls'), /El guardián falló/, { config: 'roto' }],
  ['activa.json dañado', 'reglas2', 'forja', bash('ls'), /El guardián falló/, { activaRota: true }],
  ['equipos.json ilegible', 'reglas2', 'forja', bash('ls'), /El guardián falló.*equipos.json/, { sinEquipos: true }],
  ['equipos.json ilegible, al escribir', 'reglas2', 'forja', ['Write', { file_path: path.join(repo, 'api', 'x.cs'), content: 'x' }], /El guardián falló/, { sinEquipos: true }],
  // --- Esperas ---
  ['espera corta', 'reglas2', 'forja', bash('sleep 200'), PASA],
  ['espera larga', 'reglas2', 'forja', bash('sleep 300'), /Ninguna llamada espera más de 4 min/],
  ['xi-0 puede esperar', 'reglas2', null, bash('sleep 300'), PASA],
  // --- Relevo antes de una corrida en segundo plano (reglas 3) ---
  ['reglas 2: segundo plano sin relevo', 'reglas2', 'forja', bash('npm test', { run_in_background: true }), PASA],
  ['segundo plano sin relevo', 'medianaYunque', 'forja', bash('npm test', { run_in_background: true }), /escribe \.xi-0\/relevo\/forja\.md/],
  ['nohup sin relevo', 'medianaYunque', 'forja', bash('nohup npm test > salida.log'), /escribe \.xi-0\/relevo\/forja\.md/],
  ['segundo plano con relevo', 'medianaYunque', 'forja', bash('npm test', { run_in_background: true }), PASA, { relevo: 'forja', minutos: 1 }],
  ['nohup con relevo', 'medianaYunque', 'forja', bash('nohup npm test > salida.log'), PASA, { relevo: 'forja', minutos: 1 }],
  ['relevo de hace 20 minutos', 'medianaYunque', 'forja', bash('npm test', { run_in_background: true }), /escribe \.xi-0\/relevo\/forja\.md/, { relevo: 'forja', minutos: 20 }],
  ['el relevo de otro equipo no vale', 'medianaYunque', 'forja', bash('npm test', { run_in_background: true }), /escribe \.xi-0\/relevo\/forja\.md/, { relevo: 'prisma', minutos: 1 }],
  ['un ligero no usa segundo plano', 'medianaYunque', 'forja-ligero', bash('npm test', { run_in_background: true }), /Un ligero no usa segundo plano/],
  ['un ligero sí usa nohup', 'medianaYunque', 'forja-ligero', bash('nohup npm test > salida.log'), PASA],
  ['xi-0 no necesita relevo', 'chica', null, bash('npm test', { run_in_background: true }), PASA],
  ['un equipo escribe su relevo', 'chica', 'forja', ['Write', { file_path: path.join(repo, '.xi-0', 'relevo', 'forja.md'), content: 'x' }], PASA],
  ['un equipo no escribe el relevo de otro', 'chica', 'forja', ['Write', { file_path: path.join(repo, '.xi-0', 'relevo', 'prisma.md'), content: 'x' }], /no es dueño/],
  ['un ligero no escribe el relevo', 'chica', 'forja-ligero', ['Write', { file_path: path.join(repo, '.xi-0', 'relevo', 'forja.md'), content: 'x' }], /no es dueño/],
];

function correr(activa, quien, [herramienta, entrada], previo) {
  const relevos = path.join(repo, '.xi-0', 'relevo');
  fs.rmSync(relevos, { recursive: true, force: true });
  if (previo && previo.relevo) {
    fs.mkdirSync(relevos, { recursive: true });
    const r = path.join(relevos, `${previo.relevo}.md`);
    fs.writeFileSync(r, 'resultado: salida.log\ntope: 12:00\n');
    const hace = new Date(Date.now() - previo.minutos * 60000);
    fs.utimesSync(r, hace, hace);
  }
  const f = path.join(repo, '.claude', 'xi-0', 'activa.json');
  if (activa) fs.writeFileSync(f, JSON.stringify(activa)); else fs.rmSync(f, { force: true });
  fs.rmSync(path.join(repo, '.claude', 'xi-0', 'activos.json'), { force: true });
  const p = previo || {};
  if (p.activaRota) fs.writeFileSync(f, '{ esto no es JSON');
  const archivoCfg = path.join(repo, '.claude', 'xi-0', 'config.json');
  if (p.config === 'roto') fs.writeFileSync(archivoCfg, '{ esto no es JSON');
  else if (p.config) { const c = JSON.parse(JSON.stringify(cfg)); p.config(c); fs.writeFileSync(archivoCfg, JSON.stringify(c)); }
  // Un guardián copiado a una carpeta sin equipos.json al lado: no puede cargar sus datos.
  let guardian = GUARDIAN;
  if (p.sinEquipos) {
    guardian = path.join(repo, 'sin-equipos', 'hooks', 'guardian.js');
    fs.mkdirSync(path.dirname(guardian), { recursive: true });
    fs.copyFileSync(GUARDIAN, guardian);
  }
  const evento = { hook_event_name: 'PreToolUse', tool_name: herramienta, tool_use_id: 'x', cwd: repo, tool_input: entrada };
  if (quien) evento.agent_type = quien;
  // El guardián deja escribir en la carpeta temporal del sistema; aquí el repo de prueba vive en ella,
  // así que al guardián se le dice que la temporal es otra.
  const otra = path.join(repo, 'sin-tmp');
  const env = { ...process.env, TEMP: otra, TMP: otra, TMPDIR: otra };
  const r = spawnSync(process.execPath, [guardian], { input: JSON.stringify(evento), encoding: 'utf8', env });
  if (p.config) fs.writeFileSync(archivoCfg, JSON.stringify(cfg));
  let motivo = null;
  try {
    const o = JSON.parse(r.stdout).hookSpecificOutput;
    if (o.permissionDecision === 'deny') motivo = o.permissionDecisionReason;
  } catch { /* sin salida: pasa */ }
  if (r.status !== 0) motivo = motivo || `salió con código ${r.status}: ${r.stderr}`;
  return motivo;
}

let fallos = 0;
for (const [nombre, clave, quien, llamada, espera, previo] of CASOS) {
  const motivo = correr(ACTIVAS[clave], quien, llamada, previo);
  const bien = espera === PASA ? motivo === null : motivo !== null && espera.test(motivo);
  if (!bien) {
    fallos++;
    console.log(`FALLA  ${nombre}\n       se esperaba: ${espera === PASA ? 'que pasara' : espera}\n       se obtuvo:   ${motivo === null ? 'pasó' : motivo}`);
  }
}
fs.rmSync(repo, { recursive: true, force: true });
console.log(`${CASOS.length - fallos} de ${CASOS.length} casos bien${fallos ? `, ${fallos} con falla` : ''}.`);
process.exit(fallos ? 1 : 0);
