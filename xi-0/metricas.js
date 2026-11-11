#!/usr/bin/env node
// Resume .claude/xi-0/registro.jsonl de un repo: lanzamientos, bloqueos del guardián y duración,
// y el costo por agente leyendo los transcripts de la sesión (id en la columna "sesion" del registro).
// Uso: node ~/.claude/xi-0/metricas.js "<repo principal>" [desde ISO] [id de sesión]

const fs = require('fs');
const path = require('path');
const os = require('os');

const repo = process.argv[2] || process.cwd();
const desde = process.argv[3] || (JSON.parse(safe(path.join(repo, '.claude', 'xi-0', 'activa.json')) || '{}').inicio);
function safe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

const filas = (safe(path.join(repo, '.claude', 'xi-0', 'registro.jsonl')) || '')
  .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && (!desde || r.t >= desde));

const cuenta = (f) => filas.filter(f).reduce((m, r) => ((m[r.tipo || r.quien] = (m[r.tipo || r.quien] || 0) + 1), m), {});
const lideres = cuenta((r) => r.decision === 'lanza' && !/-ligero$/.test(r.tipo));
const ligeros = cuenta((r) => r.decision === 'lanza' && /-ligero$/.test(r.tipo));
const bloqueos = filas.filter((r) => r.decision === 'deny' || r.decision === 'block');
const fmt = (m) => Object.entries(m).map(([k, v]) => `${k}×${v}`).join(', ') || 'ninguno';
const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);

const t0 = desde ? new Date(desde) : filas[0] && new Date(filas[0].t);
const t1 = filas.length ? new Date(filas[filas.length - 1].t) : null;
const min = t0 && t1 ? Math.round((t1 - t0) / 60000) : null;

console.log(`# Métricas xi-0
- Desde: ${desde || '(sin tarea activa)'}${min != null ? ` · ${min} min hasta el último evento` : ''}
- Compañeros lanzados (${total(lideres)}): ${fmt(lideres)}
- Agentes ligeros lanzados (${total(ligeros)}): ${fmt(ligeros)}
- Bloqueos del guardián (${bloqueos.length}):${bloqueos.length ? '' : ' ninguno'}`);
for (const b of bloqueos.slice(-15)) console.log(`  - ${b.t.slice(11, 19)} ${b.quien} ${b.herramienta || b.evento}: ${b.motivo}`);

// ---------- costo por agente ----------
// Precio de API por millón de tokens (skill claude-api, 2026-09-25): [entrada, salida, lectura de caché].
// Escribir caché cuesta 1.25× la entrada con TTL de 5 min (compañeros y ligeros) y 2× con TTL de 1 h (xi-0).
// Es una aproximación para comparar agentes, no la factura ni la unidad del límite de la suscripción.
const PRECIOS = { fable: [10, 50, 0.25], opus: [4, 20, 0.2], sonnet: [2, 10, 0.2], haiku: [1, 5, 0.1] };
const ESPERA = /(?:^|[;&|(\n]|\bdo|\bthen)\s*sleep\s+\d|\btime\.sleep\(|Start-Sleep|\btimeout\s+\/t|\btail\s+-f\b/;

function usd(modelo, u) {
  const fam = Object.keys(PRECIOS).find((k) => (modelo || '').includes(k));
  if (!fam) return 0;
  const [i, o, r] = PRECIOS[fam];
  const cc = u.cache_creation || {};
  const w5 = cc.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0, w1 = cc.ephemeral_1h_input_tokens || 0;
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + w5 * i * 1.25 + w1 * i * 2 + (u.cache_read_input_tokens || 0) * r) / 1e6;
}

// Un archivo de transcript: turnos únicos por message.id (la última línea trae el uso final),
// marcando los que siguen a una espera y los que reescribieron más de la mitad del contexto.
function leerTranscript(archivo) {
  const turnos = new Map(); const esperas = new Set(); let tras = false;
  for (const linea of (safe(archivo) || '').split('\n')) {
    if (!linea) continue;
    let d; try { d = JSON.parse(linea); } catch { continue; }
    if (desde && d.timestamp && d.timestamp < desde) continue;
    const m = d.message || {};
    if (d.type === 'assistant' && m.id && m.model !== '<synthetic>') {
      const t = turnos.get(m.id) || { modelo: m.model, espera: tras };
      if (!turnos.has(m.id)) tras = false;
      t.u = m.usage || t.u || {};
      turnos.set(m.id, t);
      for (const c of m.content || []) {
        if (c && c.type === 'tool_use' && c.name === 'Bash' && !(c.input || {}).run_in_background && ESPERA.test((c.input || {}).command || '')) esperas.add(c.id);
      }
    } else if (d.type === 'user' && Array.isArray(m.content)) {
      if (m.content.some((x) => x && x.type === 'tool_result' && esperas.has(x.tool_use_id))) tras = true;
    }
  }
  const r = { turnos: 0, usd: 0, espera: 0, vencida: 0 };
  for (const t of turnos.values()) {
    const x = usd(t.modelo, t.u), u = t.u;
    const ctx = (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.input_tokens || 0);
    r.turnos++; r.usd += x;
    if (t.espera) r.espera += x;
    if (ctx > 30000 && (u.cache_creation_input_tokens || 0) > 0.5 * ctx) r.vencida += x;
  }
  return r;
}

function transcripts(id) {
  const raiz = path.join(os.homedir(), '.claude', 'projects');
  for (const dir of fs.readdirSync(raiz)) {
    const base = fs.readdirSync(path.join(raiz, dir)).find((f) => f.startsWith(id) && f.endsWith('.jsonl'));
    if (!base) continue;
    const sesion = path.join(raiz, dir, base.slice(0, -6));
    const subs = path.join(sesion, 'subagents');
    const lista = [{ quien: 'xi-0', archivo: sesion + '.jsonl' }];
    for (const f of fs.existsSync(subs) ? fs.readdirSync(subs).filter((x) => x.endsWith('.jsonl')) : []) {
      const meta = JSON.parse(safe(path.join(subs, f.replace(/\.jsonl$/, '.meta.json'))) || '{}');
      lista.push({ quien: meta.agentType || 'subagente', archivo: path.join(subs, f) });
    }
    return lista;
  }
  return [];
}

const sesiones = process.argv[4] ? [process.argv[4]] : [...new Set(filas.map((r) => r.sesion).filter(Boolean))];
if (!sesiones.length) {
  console.log('- Costo: el registro no trae id de sesión (se guarda desde el 2026-11-03). Pásalo como tercer argumento.');
} else {
  const porAgente = {}; let todo = { turnos: 0, usd: 0, espera: 0, vencida: 0 };
  for (const id of sesiones) {
    for (const { quien, archivo } of transcripts(id)) {
      const r = leerTranscript(archivo), a = (porAgente[quien] = porAgente[quien] || { turnos: 0, usd: 0 });
      a.turnos += r.turnos; a.usd += r.usd;
      for (const k of Object.keys(todo)) todo[k] += r[k];
    }
  }
  const pct = (x) => `${todo.usd ? Math.round((100 * x) / todo.usd) : 0}%`;
  console.log(`- Costo a precio de API (aprox.): $${todo.usd.toFixed(2)} en ${todo.turnos} turnos (sesión ${sesiones.map((s) => s.slice(0, 8)).join(', ')})`);
  console.log(`  - Turnos que siguen a una espera: $${todo.espera.toFixed(2)} (${pct(todo.espera)}). Turnos con la caché vencida: $${todo.vencida.toFixed(2)} (${pct(todo.vencida)}).`);
  console.log('\n| agente | turnos | USD | % |\n| :- | -: | -: | -: |');
  for (const [quien, a] of Object.entries(porAgente).sort((x, y) => y[1].usd - x[1].usd)) {
    if (a.usd >= 0.01) console.log(`| ${quien} | ${a.turnos} | ${a.usd.toFixed(2)} | ${pct(a.usd)} |`);
  }
}
