# xi-0 para agentes

Resumen para un agente de IA que lee este repo. Las personas empiezan por `README.md`.

## Qué es

xi-0 es un sistema de orquestación multiagente que corre sobre Claude Code. No es un harness ni un programa aparte: son una habilidad (`/xi-0`), 25 definiciones de agentes y un hook que fuerza reglas. Una sesión principal (xi-0) recibe una orden de desarrollo, elige una ruta de pasos y coordina 3 líderes de fase y 11 equipos hasta dejar una rama `tarea/<id>` lista para revisar.

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

Reglas principales: ningún agente escribe en la instalación de xi-0, en los settings ni en `.claude/xi-0` del repo (solo la sesión principal), carpetas por equipo, lista de comandos por equipo, líneas de mensajes y máximo de palabras, máximo de ligeros, nada de push a `main` ni forzado, ninguna espera de más de 4 minutos dentro de una llamada, y QA no cierra sin evidencia.

## Estado del trabajo

- **Estable**: reglas de carpetas, comandos, mensajes, máximos, remotos y evidencia. Las tareas abiertas con `"reglas": 2` en `activa.json` siguen como antes.
- **Escrito y con pruebas del guardián, sin medir en una tarea real (ruta por tamaño y relevo)**: la habilidad abre las tareas con `"reglas": 3`, `tamano` (chica, mediana o grande) y `fases` (líderes de fase que participan). Con eso: mensajes directos cuando un líder de fase no participa, tarea chica sin ligeros y con un solo commit después de QA, Faro publica si Yunque no participa, y relevo escrito antes de una corrida desprendida. Está en la especificación (secciones 5, 7, 9 y 11). Falta comprobar en uso real que la corrida desprendida sobrevive al cierre del agente y que el aviso del vigía llega.

## Comandos

```bash
node instalar.js                      # instala en ~/.claude y genera los agentes
node instalar.js --activar <repo>     # deja config y hooks en un repo
node pruebas/guardian.test.js         # pruebas del guardián en un repo temporal
node pruebas/conformidad.test.js      # números y líneas de los documentos contra equipos.json
node ~/.claude/xi-0/metricas.js <repo>  # costo y bloqueos por agente
```

No hay dependencias que instalar salvo `xi-0/qa-visual` (opcional, `npm install`). Requiere Node.js 18 o más reciente, git y Claude Code con agent teams.

## Si vas a cambiar algo

- Los agentes se cambian en `generar-agentes.js`, nunca en los `.md` generados.
- Un cambio en el guardián lleva su caso en `pruebas/guardian.test.js`.
- Una regla nueva no debe cambiar el comportamiento de tareas con `"reglas": 2`.
- Un número que cambia (máximos, niveles del límite, palabras, líneas) se cambia en `xi-0/equipos.json` y en la especificación; `pruebas/conformidad.test.js` avisa si un documento quedó atrás.
