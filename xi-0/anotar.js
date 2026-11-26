// Anota en el registro del guardián del repo (.claude/xi-0/registro.jsonl) el error interno de un script de xi-0.
// reportar.js --recolectar lo convierte en issue al cerrar la tarea, sin que nadie tenga que notarlo.
// Uso, al principio de un script: require('./anotar.js').alFallar('ci.js', <carpeta del repo o del worktree>);

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function anotar(script, carpeta, err) {
  try {
    const comun = execFileSync('git', ['-c', 'safe.directory=*', '-C', carpeta, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dir = path.join(path.dirname(comun), '.claude', 'xi-0');
    if (!fs.existsSync(dir)) return;
    const motivo = String((err && (err.stderr || err.message)) || err).trim().split('\n').slice(0, 3).join(' ').slice(0, 300);
    fs.appendFileSync(path.join(dir, 'registro.jsonl'), JSON.stringify({ t: new Date().toISOString(), evento: 'script', script, decision: 'error-script', motivo }) + '\n');
  } catch { /* anotar nunca debe tapar el error original */ }
}

// Si el script revienta, anota el error y sale con 1 mostrando el mensaje de siempre.
function alFallar(script, carpeta) {
  process.on('uncaughtException', (err) => {
    if (carpeta) anotar(script, carpeta, err);
    console.error(`${script} falló: ${(err && (err.stderr || err.message)) || err}`);
    process.exit(1);
  });
}

module.exports = { anotar, alFallar };
