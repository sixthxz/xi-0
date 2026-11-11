#!/usr/bin/env node
// Instala xi-0 en la carpeta global de Claude Code (~/.claude) y, si se pide, lo activa en un repo.
//
//   node instalar.js                    copia xi-0 y la habilidad, y genera los 25 agentes
//   node instalar.js --activar <repo>   además deja la config y los hooks en ese repo
//
// No borra nada: sobrescribe los archivos de xi-0 que ya existan y deja lo demás como está.
// En un repo nunca sobrescribe config.json ni settings.json.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ORIGEN = __dirname;
const CLAUDE = path.join(os.homedir(), '.claude');
const DESTINO = path.join(CLAUDE, 'xi-0');
const aTexto = (p) => p.replace(/\\/g, '/');

function copiar(desde, hasta) {
  let n = 0;
  for (const e of fs.readdirSync(desde, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const a = path.join(desde, e.name);
    const b = path.join(hasta, e.name);
    if (e.isDirectory()) n += copiar(a, b);
    else { fs.mkdirSync(hasta, { recursive: true }); fs.copyFileSync(a, b); n++; }
  }
  return n;
}

// Los hooks y la barra de estado apuntan a la instalación de esta máquina.
function ajustes() {
  const txt = fs.readFileSync(path.join(ORIGEN, 'xi-0', 'settings.ejemplo.json'), 'utf8');
  return txt.split('<XI0>').join(aTexto(DESTINO));
}

const n1 = copiar(path.join(ORIGEN, 'xi-0'), DESTINO);
const n2 = copiar(path.join(ORIGEN, 'skills', 'xi-0'), path.join(CLAUDE, 'skills', 'xi-0'));
console.log(`Copiados ${n1} archivos a ${aTexto(DESTINO)} y ${n2} a ${aTexto(path.join(CLAUDE, 'skills', 'xi-0'))}.`);

execFileSync(process.execPath, [path.join(DESTINO, 'generar-agentes.js')], { stdio: 'inherit' });

const i = process.argv.indexOf('--activar');
if (i < 0) {
  console.log(`
Listo. Para usarlo en un repo:
  node instalar.js --activar <ruta del repo>
Para el QA visual (opcional): npm install dentro de ${aTexto(path.join(DESTINO, 'qa-visual'))}`);
  process.exit(0);
}

const repo = path.resolve(process.argv[i + 1] || '');
if (!process.argv[i + 1] || !fs.existsSync(path.join(repo, '.git'))) {
  console.error(`"${repo}" no es la raíz de un repo git.`);
  process.exit(1);
}
const carpeta = path.join(repo, '.claude', 'xi-0');
fs.mkdirSync(carpeta, { recursive: true });

const config = path.join(carpeta, 'config.json');
if (fs.existsSync(config)) console.log(`Ya existe ${aTexto(config)}: no se toca.`);
else {
  fs.copyFileSync(path.join(ORIGEN, 'xi-0', 'config.ejemplo.json'), config);
  console.log(`Creado ${aTexto(config)} desde la plantilla. AJÚSTALO a tu repo: carpetas, comandos, verificacion y remoto.`);
}

const settings = path.join(repo, '.claude', 'settings.json');
if (fs.existsSync(settings)) {
  const propuesta = path.join(carpeta, 'settings.propuesto.json');
  fs.writeFileSync(propuesta, ajustes());
  console.log(`Ya existe ${aTexto(settings)}: no se toca. Copia a mano "env", "statusLine" y "hooks" desde ${aTexto(propuesta)}.`);
} else {
  fs.writeFileSync(settings, ajustes());
  console.log(`Creado ${aTexto(settings)} (agent teams, barra de estado y hooks del guardián).`);
}
console.log(`
Si no quieres que .claude/ entre al historial del repo, añádelo a .git/info/exclude.
Después abre Claude Code en el repo y escribe: /xi-0 <tu orden>`);
