#!/usr/bin/env node
// Barra de estado de xi-0 (sección 10): guarda rate_limits en <repo>/.claude/limite.json
// para que xi-0 y los hooks sepan en qué nivel están, y muestra el nivel.

const fs = require('fs');
const path = require('path');
const os = require('os');

const EQ = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'xi-0', 'equipos.json'), 'utf8'));

let crudo = '';
process.stdin.on('data', (d) => (crudo += d));
process.stdin.on('end', () => {
  let e = {};
  try { e = JSON.parse(crudo); } catch { /* entrada vacía */ }
  const dir = (e.workspace && (e.workspace.project_dir || e.workspace.current_dir)) || e.cwd || process.cwd();
  const modelo = (e.model && e.model.display_name) || '';
  const ctxPct = e.context_window && e.context_window.used_percentage;
  const rl = e.rate_limits || {};
  const cinco = rl.five_hour && rl.five_hour.used_percentage;
  const siete = rl.seven_day && rl.seven_day.used_percentage;

  const pct = Math.max(cinco || 0, (siete || 0) >= EQ.limite.pausa ? siete : 0);
  const nivel = pct >= EQ.limite.pausa ? 'Pausa' : pct >= EQ.limite.guardado ? 'Guardado' : pct >= EQ.limite.ahorro ? 'Ahorro' : 'Normal';

  const dirXi = path.join(dir, '.claude', 'xi-0');
  if (fs.existsSync(path.join(dirXi, 'config.json')) && (rl.five_hour || rl.seven_day)) {
    try {
      fs.writeFileSync(path.join(dir, '.claude', 'limite.json'), JSON.stringify({
        five_hour: rl.five_hour || null,
        seven_day: rl.seven_day || null,
        nivel: nivel.toLowerCase(),
        actualizado: new Date().toISOString(),
      }, null, 2));
    } catch { /* no romper la barra */ }
  }

  const activa = fs.existsSync(path.join(dirXi, 'activa.json'));
  const partes = [];
  if (modelo) partes.push(modelo);
  partes.push(path.basename(dir));
  if (ctxPct != null) partes.push(`ctx ${Math.round(ctxPct)}%`);
  if (cinco != null) partes.push(`5h ${Math.round(cinco)}%`);
  if (siete != null) partes.push(`7d ${Math.round(siete)}%`);
  if (activa || cinco != null) partes.push(`xi-0 ${activa ? '▶ ' : ''}${nivel}`);
  process.stdout.write(partes.join(' · '));
});
