#!/usr/bin/env node
// Conformidad: los números y las líneas que los documentos escriben a mano son los de xi-0/equipos.json.
// La fuente es equipos.json (lo leen el guardián y el generador). La especificación, la habilidad y el
// README son texto fijo: esta prueba avisa cuando uno de ellos se queda atrás.
// Uso: node pruebas/conformidad.test.js
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r/g, '');
const EQ = JSON.parse(leer('xi-0/equipos.json'));
const ESP = leer('xi-0/especificacion.md');
const SKILL = leer('skills/xi-0/SKILL.md');
const README = leer('README.md');
const GUARDIAN = leer('xi-0/hooks/guardian.js');

const fallas = [];
let total = 0;
const caso = (nombre, obtenido, esperado) => {
  total++;
  if (JSON.stringify(obtenido) !== JSON.stringify(esperado))
    fallas.push(`${nombre}: se esperaba ${JSON.stringify(esperado)} y hay ${JSON.stringify(obtenido)}`);
};
const num = (texto, re) => {
  const m = texto.match(re);
  return m ? Number(m[1]) : null;
};
const seccion = (texto, desde, hasta) => {
  const i = texto.indexOf(desde);
  if (i < 0) return '';
  const j = hasta ? texto.indexOf(hasta, i + desde.length) : -1;
  return texto.slice(i, j < 0 ? undefined : j);
};

// ---------- niveles del límite ----------
const NIVELES = { ahorro: 'Ahorro', guardado: 'Guardado', pausa: 'Pausa' };
const limEsp = seccion(ESP, '## 10. Límite de sesión', '## 11.');
const limSkill = seccion(SKILL, '## Límite', '## Reanudar');
for (const [clave, nombre] of Object.entries(NIVELES)) {
  const pct = EQ.limite[clave];
  caso(`especificación, nivel ${nombre}`, num(limEsp, new RegExp(`\\*\\*${nombre}\\*\\* \\(desde (\\d+)%\\)`)), pct);
  caso(`habilidad, nivel ${nombre}`, num(limSkill, new RegExp(`\\*\\*${nombre} \\(≥(\\d+)%\\)`)), pct);
  caso(`README, nivel ${nombre}`, num(README, new RegExp(`\\| ${nombre} \\| (\\d+)% \\|`)), pct);
}
caso('especificación, nivel Normal', num(limEsp, /\*\*Normal\*\* \(menos de (\d+)%\)/), EQ.limite.ahorro);
caso('habilidad, nivel Normal', num(limSkill, /\*\*Normal \(<(\d+)%\)/), EQ.limite.ahorro);
caso('especificación, estado.md desde Guardado', num(limEsp, /Se escribe a partir del (\d+)%/), EQ.limite.guardado);
caso(
  'especificación, umbrales en puntos abiertos',
  (ESP.match(/umbrales de (\d+)\/(\d+)\/(\d+)%/) || []).slice(1).map(Number),
  [EQ.limite.ahorro, EQ.limite.guardado, EQ.limite.pausa],
);

// ---------- vueltas y palabras ----------
caso('especificación, vueltas antes de escalar', num(ESP, /Si siguen después de (\d+) vueltas/), EQ.vueltas_max);
caso('habilidad, vueltas antes de escalar', num(SKILL, /tras (\d+) vueltas se escalan/), EQ.vueltas_max);
caso('especificación, palabras de la ficha directa', num(seccion(ESP, '## 7. Comunicación', '## 8.'), /ficha de hasta (\d+) palabras/), EQ.palabras_max.directo);
caso('guardián, palabras de la ficha directa (valor de reserva)', num(GUARDIAN, /palabras_max\.directo \|\| (\d+)/), EQ.palabras_max.directo);

// ---------- equipos, fases y máximos ----------
const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const porNombre = Object.fromEntries(Object.entries(EQ.equipos).map(([id, e]) => [e.nombre, id]));
const titulos = [...ESP.matchAll(/^### (.+), líder (.+)$/gm)];
caso('especificación, equipos con sección propia', titulos.map((m) => porNombre[m[1]]).sort(), Object.keys(EQ.equipos).sort());
for (const m of titulos) {
  const id = porNombre[m[1]];
  if (!id) continue;
  caso(`especificación, líder de ${m[1]}`, sinAcentos(m[2]), id);
  // El máximo está en la tabla de equipos de la sección 3 (columna "Máx. agentes").
  const fila = (seccion(ESP, '## 3. Fases y equipos', '## 4.').split('\n').find((l) => l.startsWith(`| ${m[1]} |`)) || '').split('|').map((x) => x.trim());
  caso(`especificación, máximo de agentes de ${m[1]}`, Number(fila[5]), EQ.equipos[id].max);
  caso(`especificación, fase de ${m[1]}`, fila[2], EQ.fases[EQ.equipos[id].fase].nombre);
  // Y los ligeros de un proyecto completo (columna de su tabla en la sección 4) caben en ese máximo, salvo
  // en QA, donde el máximo es un tope menor que la suma de sus roles.
  const fin = [ESP.indexOf('\n### ', m.index + 5), ESP.indexOf('\n## 5.')].filter((i) => i > 0);
  const tabla = seccion(ESP.slice(m.index, Math.min(...fin)), '| Agente ligero |', '\n\n');
  const suma = tabla.split('\n').slice(2).reduce((s, f) => s + (Number((f.split('|')[4] || '').trim()) || 0), 0);
  caso(`especificación, los ligeros de ${m[1]} alcanzan su máximo`, suma >= EQ.equipos[id].max, true);
}
for (const [fase, f] of Object.entries(EQ.fases))
  caso(`equipos.json, equipos de la fase ${fase}`, Object.keys(EQ.equipos).filter((id) => EQ.equipos[id].fase === fase).sort(), [...f.equipos].sort());

// ---------- líneas de comunicación ----------
const filas = seccion(ESP, '## 7. Comunicación', '## 8.').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| De ') && !l.startsWith('| :-'));
const lineasEsp = filas.map((l) => {
  const c = l.split('|').map((x) => x.trim());
  return `${porNombre[c[1]]}>${porNombre[c[2]]}${c[4] === 'ida y vuelta' ? ' (ida y vuelta)' : ''}`;
});
const lineasEq = EQ.lineas.map(([a, b, tipo]) => `${a}>${b}${tipo === 'ida y vuelta' ? ' (ida y vuelta)' : ''}`);
caso('especificación, líneas de comunicación', [...lineasEsp].sort(), [...lineasEq].sort());

// ---------- no negociables ----------
const numerados = (texto) => (texto.match(/^\d+\. /gm) || []).length;
caso(
  'no negociables: la habilidad tiene los mismos que la especificación',
  numerados(seccion(SKILL, '## No negociables', '## Límite')),
  numerados(seccion(ESP, '**No negociables**', '**Negociables**')),
);

// ---------- agentes generados ----------
const GENERADOR = leer('xi-0/generar-agentes.js');
caso('generador: lee equipos.json y no repite sus números', /palabras_max:\s*\{|limite:\s*\{\s*ahorro/.test(GENERADOR), false);
caso('AGENTS.md, número de agentes', num(leer('AGENTS.md'), /(\d+) definiciones de agentes/), Object.keys(EQ.fases).length + 2 * Object.keys(EQ.equipos).length);

if (fallas.length) {
  console.log(fallas.map((f) => 'FALLA  ' + f).join('\n'));
  console.log(`\n${total - fallas.length} de ${total} comprobaciones bien.`);
  process.exit(1);
}
console.log(`${total} de ${total} comprobaciones bien.`);
