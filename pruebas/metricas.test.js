#!/usr/bin/env node
// Pruebas de la tabla de tareas de xi-0/metricas.js (--registrar y --historial) en carpetas temporales.
// La tabla se escribe donde diga XI0_HISTORIAL, nunca en ~/.claude.
// Uso: node pruebas/metricas.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const METRICAS = path.join(__dirname, '..', 'xi-0', 'metricas.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'xi0-metricas-'));
const tabla = path.join(base, 'historial', 'indice.jsonl');
const repo = path.join(base, 'mi-app');
const dirXi0 = path.join(repo, '.claude', 'xi-0');
fs.mkdirSync(dirXi0, { recursive: true });

const hace = (min) => new Date(Date.now() - min * 60000).toISOString();
function tarea(id, tamano, modo) {
  const activa = { tarea: id, tipo: 'corrección', reglas: 4, tamano, fases: [], ruta: [['forja'], ['argos']], inicio: hace(30), limite_inicio: 12 };
  if (modo) activa.modo = modo;
  fs.writeFileSync(path.join(dirXi0, 'activa.json'), JSON.stringify(activa));
  // Registro del guardián: dos lanzamientos, un ligero y un bloqueo, sin id de sesión (sin costo).
  fs.writeFileSync(path.join(dirXi0, 'registro.jsonl'), [
    { t: hace(29), decision: 'lanza', tipo: 'forja' },
    { t: hace(20), decision: 'lanza', tipo: 'argos' },
    { t: hace(18), decision: 'lanza', tipo: 'argos-ligero' },
    { t: hace(10), decision: 'deny', quien: 'argos', herramienta: 'Bash', motivo: 'x' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(repo, '.claude', 'limite.json'), JSON.stringify({ five_hour: { used_percentage: 20, resets_at: Date.now() / 1000 + 3600 } }));
}
const correr = (...a) => spawnSync(process.execPath, [METRICAS, ...a], { encoding: 'utf8', env: { ...process.env, XI0_HISTORIAL: tabla } });
const casos = [];
const caso = (nombre, ok, detalle = '') => casos.push([nombre, ok, detalle]);

tarea('20261126-fecha', 'chica');
let r = correr(repo, '--registrar', '--veredicto', 'entregada', '--pr', 'https://github.com/yo/mi-app/pull/7', '--nota', 'primera con CI');
caso('registra la tarea', r.status === 0 && /Registrada en/.test(r.stdout), r.stdout + r.stderr);
caso('sigue imprimiendo el informe de siempre', /Compañeros lanzados \(2\)/.test(r.stdout), r.stdout);
const fila = JSON.parse(fs.readFileSync(tabla, 'utf8').trim().split('\n')[0]);
caso('la fila trae la tarea y el repo', fila.tarea === '20261126-fecha' && fila.repo === 'mi-app' && fila.tamano === 'chica' && fila.modo === 'tarea', JSON.stringify(fila));
caso('la fila trae la ruta aplanada', JSON.stringify(fila.ruta) === '["forja","argos"]', JSON.stringify(fila.ruta));
caso('la fila trae lanzamientos y bloqueos', fila.companeros === 2 && fila.ligeros === 1 && fila.bloqueos === 1, JSON.stringify(fila));
caso('la fila trae la duración desde el inicio', fila.minutos >= 29 && fila.minutos <= 31, String(fila.minutos));
caso('la fila trae el límite al inicio y al final', fila.limite_inicio === 12 && fila.limite_fin === 20, JSON.stringify(fila));
caso('la fila trae veredicto, PR y nota', fila.veredicto === 'entregada' && /pull\/7$/.test(fila.pr) && fila.nota === 'primera con CI', JSON.stringify(fila));
caso('sin id de sesión, el costo queda vacío', fila.usd === null && fila.agente_mas_caro === null, JSON.stringify(fila));

tarea('20261126-revisar-pr-7', 'chica', 'revisar');
correr(repo, '--registrar', '--veredicto', 'con fallas');
tarea('20261126-filtro', 'mediana');
correr(repo, '--registrar', '--veredicto', 'entregada');

r = correr('--historial');
caso('el historial lista las tres tareas', r.status === 0 && ['20261126-fecha', '20261126-revisar-pr-7', '20261126-filtro'].every((t) => r.stdout.includes(t)), r.stdout);
caso('el historial agrupa por tamaño y separa las revisiones', /\| chica \| 1 \|/.test(r.stdout) && /\| revisar chica \| 1 \|/.test(r.stdout) && /\| mediana \| 1 \|/.test(r.stdout), r.stdout);
r = correr('--historial', 'otro-repo');
caso('el historial filtra por repo', /Sin tareas registradas de otro-repo/.test(r.stdout), r.stdout);

fs.rmSync(path.join(dirXi0, 'activa.json'));
r = correr(repo, '--registrar');
caso('sin tarea abierta no registra', r.status === 2 && /antes de borrarla/.test(r.stderr), r.stderr);

let fallos = 0;
for (const [nombre, ok, detalle] of casos) if (!ok) { fallos++; console.log(`FALLA  ${nombre}\n       ${String(detalle).trim().slice(0, 400)}`); }
fs.rmSync(base, { recursive: true, force: true });
console.log(`${casos.length - fallos} de ${casos.length} casos bien${fallos ? `, ${fallos} con falla` : ''}.`);
process.exit(fallos ? 1 : 0);
