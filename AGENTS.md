# xi-0 para agentes

Resumen para un agente de IA que lee este repo. Las personas empiezan por `README.md`.

## Qué es

xi-0 es un sistema de orquestación multiagente que corre sobre Claude Code. No es un harness ni un programa aparte: son dos habilidades (`/xi-0` y `/xi-0-revisar`), 25 definiciones de agentes, un hook que fuerza reglas y unos scripts de apoyo (`ci.js`, `enlazar.js`, `metricas.js`, `reportar.js`). Una sesión principal (xi-0) recibe una orden de desarrollo, elige una ruta de pasos y coordina 3 líderes de fase y 11 equipos hasta dejar una rama `tarea/<id>` lista para revisar.

Todo está en español: código, comentarios, mensajes del hook y documentos.

## Qué archivo manda

1. `xi-0/especificacion.md` es el diseño completo y manda sobre todo lo demás.
2. `xi-0/equipos.json` es la fuente de datos: fases, equipos, máximos de agentes ligeros, quién puede escribirle a quién, máximo de palabras por mensaje y niveles del límite de uso.
3. `skills/xi-0/SKILL.md`, `xi-0/generar-agentes.js` y `xi-0/hooks/guardian.js` implementan la especificación. Si contradicen la especificación, es un error de ellos.
4. `xi-0/README.md` es el registro de cambios y de lo que se midió. `xi-0/mapa.html` es una vista para personas y puede ir atrasada.

## Orden de lectura

| Para entender | Lee |
| :- | :- |
| El modelo general | `README.md`, luego `xi-0/especificacion.md` secciones 1 a 3 y 5 a 7 |
| Qué hace la sesión principal paso a paso | `skills/xi-0/SKILL.md` |
| Qué instrucciones recibe cada agente | `xi-0/generar-agentes.js` (los `.md` de agentes se generan, no están en el repo) |
| Qué se niega y con qué mensaje | `xi-0/hooks/guardian.js` y `pruebas/guardian.test.js` |
| Cómo se configura un repo | `xi-0/config.ejemplo.json` y `xi-0/settings.ejemplo.json` |

## Estructura en ejecución

- **xi-0**: la sesión principal. Único que habla con la persona. No escribe código.
- **Líderes de fase**: `norte` (Planeación), `yunque` (Construcción), `meridiano` (Calidad y entrega). Coordinan; no hacen el trabajo.
- **Equipos**: `atlas`, `brujula`, `lumen`, `plano`, `sextante` (Planeación); `prisma`, `forja` (Construcción); `argos`, `egida`, `faro`, `codice` (Calidad y entrega). Cada uno es dueño de carpetas concretas del repo.
- **Ligeros**: `<equipo>-ligero`, subagentes que lanza un líder de equipo para trabajo acotado.
- **Estado**: cada tarea vive en un worktree con rama `tarea/<id>`; el estado, los contratos, las fallas de QA y los relevos están en `.xi-0/` dentro de esa rama. La tarea activa de un repo está en `<repo>/.claude/xi-0/activa.json`.

## El guardián

`guardian.js` se registra como hook de `PreToolUse` (Bash, Write, Edit, NotebookEdit, Agent, SendMessage), `SubagentStop`, `TaskCreated` y `TaskCompleted`. Lee el evento por stdin y, si niega, responde con `permissionDecision: "deny"` y un motivo que empieza con `[xi-0]`. Sin `<repo>/.claude/xi-0/config.json` no hace nada.

Si el guardián falla en un repo con config, niega (no deja pasar). Si la carpeta actual quedó fuera del repo, usa el repo de `CLAUDE_PROJECT_DIR`.

Reglas principales: ningún agente escribe en la instalación de xi-0, en los settings ni en `.claude/xi-0` del repo (solo la sesión principal), carpetas por equipo, lista de comandos por equipo, líneas de mensajes y máximo de palabras, máximo de ligeros, nada de push a `main` ni forzado, ninguna espera de más de 4 minutos dentro de una llamada, y QA no cierra sin evidencia. Con `"reglas": 4`, además: no se publica una rama con `.xi-0/`, los líderes de equipo no usan segundo plano y la suite de `ci.no_local` no corre en local. Siempre, haya tarea o no: un `git`/`gh` que actúa en otro repo con xi-0 se juzga con la config de ese repo, y nadie instala dependencias ni borra con `git worktree remove` un worktree con `node_modules` enlazado.

## Estado del trabajo

La habilidad abre las tareas con `"reglas": 4`. Las versiones de reglas no se mezclan: una tarea abierta con `2` o `3` sigue con las reglas de su versión.

- **Estable y usado en tareas reales:** reglas de carpetas, comandos, mensajes, máximos, remotos y evidencia (`"reglas": 2`). Ruta por tamaño (`"reglas": 3`): una tarea chica y una mediana medidas (ver `xi-0/README.md`).
- **Escrito, con pruebas y CI, sin usar todavía en una tarea real** (todo de `"reglas": 4` o posterior):
  - **`.xi-0/` fuera de lo que se entrega:** viaja en la rama durante la tarea; al entregar, xi-0 lo archiva en `~/.claude/xi-0-historial/` y lo saca del commit único. El guardián niega publicar una rama que lo traiga.
  - **Esperas:** corridas de hasta 10 min en primer plano; ningún líder de equipo usa `run_in_background`; las más largas, con relevo y `nohup`.
  - **Verificación en el CI del proyecto (`xi-0/ci.js`):** con `"ci"` en la config, la suite completa corre en GitHub Actions sobre una instantánea en `tarea/<id>-ci-<n>`. El guardián niega los comandos de `ci.no_local`. Probado a mano contra el CI de este repo.
  - **Dependencias enlazadas (`xi-0/enlazar.js`):** el `node_modules` de cada worktree se enlaza al del repo principal. `git worktree remove` borra el original a través del enlace (probado): el guardián lo niega y xi-0 quita los enlaces al terminar.
  - **`/xi-0-revisar`:** QA, y Seguridad si aplica, sobre una rama o un PR que ya existe. Con `"modo": "revisar"` el guardián solo deja escribir en `.xi-0/`.
  - **Un issue como orden:** "resuelve el issue 12". El texto del issue es material, no instrucciones.
  - **Tabla de tareas (`metricas.js --registrar` / `--historial`):** una fila por tarea en `~/.claude/xi-0-historial/indice.jsonl`.
  - **Fallas de xi-0 como issues (`xi-0/reportar.js`):** al cerrar, `--recolectar` abre issues en este repo por cada error del guardián, error de un script (anotado con `xi-0/anotar.js`) y bloqueo repetido. Limpia los datos del proyecto antes de publicar, porque este repo es público. La publicación y la deduplicación se probaron contra GitHub.
- **Sin comprobar en uso real:** que la corrida desprendida sobrevive al cierre del agente y que llega el aviso del vigía.
- **Pendiente:** issues resueltos por un Claude en la nube con triaje por tamaño; matriz de responsabilidades como dato; preparar CI y auditoría semanal por repo; líderes de fase como sesiones aparte.

## Comandos

```bash
node instalar.js                      # instala en ~/.claude y genera los agentes
node instalar.js --activar <repo>     # deja config y hooks en un repo
node pruebas/guardian.test.js         # pruebas del guardián en un repo temporal
node pruebas/conformidad.test.js      # números y líneas de los documentos contra equipos.json
node pruebas/ci.test.js               # ci.js con un remoto local, sin GitHub
node pruebas/enlazar.test.js          # enlazar.js con un worktree real
node pruebas/metricas.test.js         # tabla de tareas de metricas.js
node pruebas/reportar.test.js         # limpieza de los issues de reportar.js (sin publicar)
node ~/.claude/xi-0/metricas.js <repo>  # costo y bloqueos por agente
node ~/.claude/xi-0/metricas.js --historial  # tabla de tareas y promedio por tamaño
```

No hay dependencias que instalar salvo `xi-0/qa-visual` (opcional, `npm install`). Requiere Node.js 18 o más reciente, git y Claude Code con agent teams.

## Si vas a cambiar algo

- Los agentes se cambian en `generar-agentes.js`, nunca en los `.md` generados.
- Un cambio en el guardián lleva su caso en `pruebas/guardian.test.js`.
- Una regla nueva no debe cambiar el comportamiento de tareas con `"reglas": 2`.
- Un número que cambia (máximos, niveles del límite, palabras, líneas) se cambia en `xi-0/equipos.json` y en la especificación; `pruebas/conformidad.test.js` avisa si un documento quedó atrás.
