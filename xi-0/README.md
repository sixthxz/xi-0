# xi-0 — implementación

Implementación de `especificacion.md` (manda sobre `mapa.html`).

## Archivos

| Dónde | Qué |
| :- | :- |
| `~/.claude/skills/xi-0/SKILL.md` | xi-0 (líder). Solo se invoca con `/xi-0`. |
| `~/.claude/agents/xi-0/*.md` | 3 líderes de fase, 11 líderes de equipo, 11 agentes ligeros (`<equipo>-ligero`). Generados. |
| `~/.claude/xi-0/generar-agentes.js` | Regenera los agentes (modelos, textos, tablas de ligeros). |
| `~/.claude/xi-0/equipos.json` | Datos fijos: fases, máximos, líneas del mapa, umbrales del límite. |
| `~/.claude/xi-0/hooks/guardian.js` | Todos los hooks de la sección 11. |
| `~/.claude/xi-0/statusline.js` | Escribe `<repo>/.claude/limite.json` y muestra el nivel. |
| `~/.claude/xi-0/metricas.js` | Resumen de lanzamientos y bloqueos de una tarea. |
| `~/.claude/xi-0/config.ejemplo.json` | Plantilla de config por proyecto. |
| `<repo>/.claude/settings.json` | Activa agent teams, statusline y hooks **solo en ese repo**. |
| `<repo>/.claude/xi-0/config.json` | Carpetas por equipo, comandos, remotos, verificación, archivos que no se leen. |

Activar en otro repo: copiar `config.ejemplo.json` a `<repo>/.claude/xi-0/config.json` y ajustarlo; copiar `<repo>/.claude/settings.json`; añadir `.claude/` a `.git/info/exclude` si el repo no es tuyo.

## Adaptaciones respecto a la especificación

- **Agentes ligeros**: un archivo por equipo (`<equipo>-ligero`) con el rol en el prompt, en lugar de uno por rol. Así heredan herramientas y carpetas del equipo (punto abierto 4 resuelto por diseño) y el guardián puede contarlos.
- **Carpetas**: las de la especificación (`/web`, `/api`, `/db`…) se mapean por proyecto en `config.json`. Los documentos de planeación, QA, seguridad y estado viven en `.xi-0/` de la rama `tarea/<id>`.
- **Equipos de documentos** (Atlas, Brújula, Lumen, Plano, Códice no tienen Bash) escriben directo en el worktree de la tarea y su líder de fase hace el commit. Solo los equipos de código tienen worktree propio.
- **Yunque** tiene `Write/Edit` restringido a `.xi-0/PR.md` (el PR local).
- **Remotos**: `config.remoto` bloquea push, `gh pr create` y `gh pr merge` en el proyecto, haya tarea activa o no (también protege de otras sesiones).
- **Líneas del mapa**: se permiten en ambos sentidos (quien recibe puede responder).
- **Modelos**: líderes `inherit` (el de la sesión), ligeros `sonnet` con esfuerzo `low`.
- **Ramas de equipo**: `tarea/<id>-<equipo>`, no `tarea/<id>/<equipo>` (git no deja tener `tarea/<id>` y `tarea/<id>/<equipo>` a la vez; las tareas reales ya lo hacían así).

## Añadidos sobre la especificación (traídos de un orquestador anterior)

- **Revisor de código**: rol ligero de Argos (1–2 por tarea con código). Revisa el diff completo; lo que hay que corregir va como falla `tipo: revisión`.
- **QA visual**: `qa-visual/recorrido.js` (playwright-core con el Chrome/Edge instalado) captura escritorio y móvil, texto visible, errores de consola y peticiones fallidas, contra la web publicada (`--url`) o un build local (`--dist`).
  - Lumen añade el rol *Capturador del estado actual* y diseña sobre capturas reales (`.xi-0/plan/diseno/estado-actual/`). Su Bash solo puede correr el recorrido.
  - Argos añade el rol *QA visual* y compara contra esas capturas (`.xi-0/qa/visual/`).
- **QA no cierra sin las líneas** `pruebas:`, `revision:` y `visual:` en `.xi-0/qa/resultado.md` (guardián); en tareas con reglas de evidencia, también `validez:` (ver abajo).
- **xi-0 verifica el diff** él mismo antes de entregar.
- Máximo de Argos subido de 6 a 8 por los dos roles nuevos (ya está así en la especificación, secciones 3 y 4).
- `config.comandos` acepta regex con prefijo `re:`.

## Reglas de evidencia (2026-11-02)

Principio de la sección 2 de la especificación: una decisión vale por la evidencia que la respalda.

- **Criterios con id**: `CT-n` en `tarea.md` (xi-0) y `CA-n` en requisitos (Brújula), como comportamiento observable.
- **Atlas** separa hechos (con fuente) de hipótesis. **Plano** justifica cada decisión con alternativas y evidencia y escribe la sección *Contrato y libre*, que dice qué puede probar QA.
- **Argos** comprueba la validez de las pruebas, clasifica cada falla (`clase: implementación | prueba | requisito | cobertura`, con `requisito:`) y entrega `.xi-0/qa/validez.md`. Las de `clase: requisito` suben a xi-0 por Meridiano. Prisma y Forja pueden impugnar una falla con evidencia.
- **Líderes de fase**: revisan la evidencia de su fase (requisitos / implementación / validación) y su resumen lleva una sexta línea, `evidencia:`.
- **Formato de falla** (estado, clase, requisito, origen, para, dónde, reproducir, esperado, obtenido, gravedad, commit, vuelta) ahora está en los archivos de Argos y Égida. Antes solo estaba en la especificación y los agentes inventaban el suyo: en un proyecto real ninguna de las 14 fallas tenía `estado:` legible y el guardián no veía fallas abiertas ni vueltas.
- **Guardián**:
  - Siempre: lee `estado:` y `vuelta:` aunque vengan como `- estado:` o `**Estado:**`, y si se repiten manda el último.
  - Solo en tareas con `"reglas": 2` en `activa.json` (las abiertas antes siguen como estaban):
    - Niega escribir una falla `qa-*` sin `estado`, `clase`, `requisito` o `vuelta`.
    - Frena el cierre de Argos sin `validez:`, sin `validez.md`, con un `CT-n`/`CA-n` que no aparece en `validez.md`, con fallas de QA sin clasificar, o con pruebas de la rama base cambiadas o borradas que no están en "Pruebas existentes que cambiaron".
    - Niega un resumen de fase (`estado:`) a xi-0 sin `evidencia:`.
- Probado con 30 eventos de hook en un repo temporal (incluidas 14 fallas reales de un proyecto). `mapa.html` no se actualizó: ya venía atrasado y manda la especificación.

## Reglas de espera y costo (2026-11-03)

Origen: el post mortem de una tarea real de unas 21 horas, recalculado en USD a precio de API por modelo y por TTL de caché.

Medido en esa tarea (~$66):

- Ligeros esperando corridas dentro de una llamada (`time.sleep(299)`, bucles con `timeout` de 5 a 10 min): $16.90, el 25%. En 104 de 147 esperas la caché ya había vencido (dura 5 min) y el turno siguiente reescribió todo el contexto, de hasta 200k tokens.
- xi-0 al despertar tras más de 1 h sin actividad: $7.06, el 41% de su costo.
- Avisos de inactividad: 118 KB, contra 14 KB de mensajes reales.
- 71 bloqueos del guardián, sobre todo `sed -n` (25), `cut`, `date` y `time`.

Cambios:

- **Guardián**:
  - Niega las esperas de más de 240 s, o con `timeout` de más de 270 s, fuera de segundo plano, a todos menos xi-0.
  - `sleep` de hasta 240 s vale siempre.
  - `time`, `nohup` y `timeout N` se quitan antes de revisar el comando. Antes, `time git push` se saltaba la regla de remotos.
  - Cada fila de `registro.jsonl` lleva `sesion`.
- **Generador**:
  - Ligeros con Bash: regla de esperas y cómo esperar (`sleep 230` con `timeout: 250000`).
  - Líderes con Bash: sección *Corridas largas*: prueba de humo, nada de cómputo sin encargo, segundo plano y un ligero nuevo que espera.
  - Encargos a ligeros con `Tope:`.
  - Todos los compañeros: el texto final del turno es de una línea.
  - Líderes de fase: encargos con tope, y rutas solo dentro de `carpetas.<equipo>`.
- **SKILL.md**:
  - Topes de alcance y tiempo en `tarea.md` para los pasos con cómputo.
  - Las decisiones se comunican citando el commit.
  - El resumen de fase es de "seis líneas" (decía cinco).
- **Configs** (plantilla): `re:^sed\s+-n\s+(''|""|\d+(,\d+)?p)(\s+[^\s-]\S*)*$`, `cut` y `date` en las listas que ya tenían `cat`. La regex solo deja pasar rangos de líneas; `sed -i` sigue bloqueado.
- **metricas.js**: costo por agente a partir de los transcripts de la sesión.

Pruebas:

- 23 eventos sintéticos.
- Los 589 Bash reales de compañeros y ligeros de esa sesión, pasados por el guardián viejo y por el nuevo: 417 iguales, 130 esperas ahora negadas, 37 lecturas que antes se bloqueaban ahora pasan, y 5 cambian de motivo.

Respecto al informe:

- **Tomado**: cómputo en segundo plano y un ligero nuevo de contexto chico; topes en los encargos; prueba de cordura antes de una corrida cara; ajuste de comandos; Norte consulta `carpetas`; decisiones en `tarea.md`; métricas por agente.
- **Cambiado**:
  - No se depende del aviso de `run_in_background`, porque no llega de forma fiable a subagentes ni a compañeros.
  - No hay entrega parcial a mitad de plazo, porque sería un avance.
  - Los comandos van en `config.json`, no en `guardian.js`.
  - `sed -n` solo por rangos de líneas.
  - Meridiano sigue solo con `git`.
- **No se hizo**:
  - Fichas en archivo: el problema era el aviso de inactividad.
  - Modelo más barato para ligeros: ya son Sonnet, y Haiku ahorraría menos del 4% del mes con una ventana de 200K que forja-ligero superó.
  - `paso n` en cada mensaje.
  - `costo.md` exigido por el guardián, que no puede saber cuánto va a tardar un comando.
  - RTK: ahorraría unos $15–22 al mes, y su hook global junto al guardián tiene un comportamiento no documentado.

## Endurecimiento del guardián (2026-11-10)

Salió de una revisión del código con eventos sintéticos. Cada hueco se reprodujo primero como caso en `pruebas/guardian.test.js` (fallaba con el guardián anterior) y después se cerró. Aplica a todas las tareas, también con `"reglas": 2`: son correcciones de reglas que ya existían, no reglas nuevas.

- **Push.** La regla de remotos ya no depende de cómo esté escrito el comando. Parte el comando en palabras como lo hace el shell (función `piezas`) y reconoce `git` con opciones delante (`-C`, `-c`), dentro de `$( )`, comillas invertidas, paréntesis, tras `&`, con `env` o dentro de `bash -c`. El remoto es el primer argumento; el destino se lee del refspec (`HEAD:refs/heads/main`, `:main`); `-uf` y `+rama` cuentan como forzado. El push tiene que nombrar la rama: sin rama, o con `--all`, `--mirror` o `--repo`, se niega. `rama_base` queda protegida igual que `main` y `master`.
- **Falla cerrada.** Una excepción del guardián (regex `re:` inválida, `config.json` o `activa.json` dañados, `equipos.json` ilegible) antes salía con código 1 y Claude Code dejaba pasar la llamada. Ahora niega con el motivo. Sin config en el repo sigue sin hacer nada. En `SubagentStop` solo registra el error, para no dejar a un agente sin poder terminar.
- **xi-0 no se cambia desde un agente.** Cualquier llamada con `agent_type` tiene negado escribir en `~/.claude/xi-0`, `~/.claude/skills/xi-0`, `~/.claude/agents/xi-0`, `settings*.json` (de la persona y del repo) y `<repo>/.claude/xi-0`. En Write y Edit es exacto, por ruta. En Bash es por texto: un comando que nombra esas rutas solo pasa si es de lectura (`cat`, `head`, `grep`, `ls`, `node <script>`).
- **Carpeta actual fuera del repo.** Si un agente se sale con `cd`, el guardián usa el repo de `CLAUDE_PROJECT_DIR`.

Sin cerrar: la lista de comandos por equipo sigue usando `segmentos`, que no separa `&` sola ni `$( )`; un push dentro de un alias de git o de un script no se ve; Bash puede escribir en carpetas de otro equipo con comandos permitidos (redirecciones, `node -e`); un script escrito en la carpeta temporal y ejecutado después tampoco se ve. Cerrar eso del todo pide aislamiento del sistema operativo, no un hook.

## Ruta por tamaño, commit único y relevo (2026-11-10)

La habilidad abre las tareas con `"reglas": 3`, que suma `tamano` y `fases` a `activa.json`. Las tareas con `"reglas": 2` no cambian. La especificación lo describe en las secciones 5 (Tamaño), 6 (no negociables 10, 14 y 15), 7, 9 y 11.

- **Tamaño.** Chica: quien construye y QA, más DevOps solo si se publica; sin líderes de fase, sin ligeros, en Sonnet. Mediana: un líder de fase solo si su fase tiene dos o más equipos en la ruta. Grande: proyecto completo o tres fases con dos o más equipos. En la duda, el menor; se puede subir, no bajar.
- **Un commit por tarea.** En chica nadie hace commit hasta el visto bueno de QA; QA prueba sobre los cambios sin commit y después quien construyó hace el commit único. El guardián le niega `git commit` a quien construye mientras `qa/resultado.md` no esté completo o haya fallas abiertas (pasa un `wip:` en Guardado o Pausa). En mediana y grande los equipos hacen commits por unidad y xi-0 deja la rama en uno al entregar. Se eligió que el commit de chica lo haga quien construyó y no xi-0, porque xi-0 no escribe en el código y el agente ya tiene el contexto del cambio.
- **Pruebas existentes.** El cierre de QA compara también la copia de la tarea contra la rama base, porque en una chica los cambios a pruebas que ya existían están sin commit.
- **Worktrees.** Todos trabajan en la copia de la tarea. Front end y Back end crean rama propia solo si coinciden en el mismo paso. Antes cada equipo creaba la suya y los líderes de fase las unían: eran merges y worktrees que no evitaban ningún choque, porque las carpetas ya separan a los equipos.
- **Publicar.** Al final, después del commit único. Yunque si participa; si no, Faro.
- **Relevo.** Quien lanza una corrida larga escribe `.xi-0/relevo/<equipo>.md`, la lanza desprendida con una marca de fin (`nohup <comando> > <salida> 2>&1 && echo ok > <resultado> || echo falla > <resultado> &`) y avisa. xi-0 cierra al agente y deja un vigía en segundo plano que espera el archivo de resultado o el tope; después lanza a un agente nuevo que retoma. Se eligió un archivo de marca y no el aviso de segundo plano del agente porque ese aviso se pierde cuando el agente se cierra.
- **Mensajes directos.** Un equipo cuya fase no tiene líder en la tarea le entrega a xi-0 una ficha de hasta 250 palabras (`palabras_max.directo` en `equipos.json`).

Sin verificar en una tarea real: que la corrida desprendida siga viva cuando se cierra el agente que la lanzó (en Windows depende de cómo Claude Code termine el árbol de procesos), que el aviso del vigía despierte a xi-0, y cuánto baja el costo de una chica frente a la ruta completa. La habilidad ya le dice a xi-0 que mire el archivo de resultado si el aviso no llega.

## Una sola fuente para los números (2026-11-10)

`equipos.json` es la fuente de máximos, líneas, niveles del límite, máximos de palabras y vueltas; el guardián y el generador lo leen. La especificación, la habilidad y el README son texto fijo y repiten algunos de esos números, así que `pruebas/conformidad.test.js` comprueba que digan lo mismo: niveles del límite en los tres, vueltas, palabras de la ficha directa, equipos y líderes, fase y máximo de agentes por equipo (tabla de la sección 3), las líneas de comunicación de la sección 7 y que la habilidad tenga los mismos no negociables que la especificación.

La primera corrida encontró una diferencia real: la especificación todavía decía 6 como máximo de QA y no tenía los roles Revisor de código y QA visual. Se corrigió la especificación.

Se eligió una prueba y no generar los documentos desde `equipos.json` porque la especificación es el documento que manda y se escribe a mano; generarla pondría el diseño detrás de un script.

## Instalación y plantillas (2026-11-11)

- **`instalar.js --revisar <repo>`** revisa la config sin cambiar nada: JSON inválido, claves que faltan, `<nombre>` sin cambiar, rama base o remoto que no existen, carpetas de código que no existen (casi siempre la plantilla sin ajustar), `re:` inválidas y `remoto` incoherente. También corre al final de `--activar`. Sale con código 1 si hay avisos. Existe porque el guardián ahora niega todo con una config dañada, y eso conviene verlo antes de abrir una tarea.
- **`--plantilla node`**: `config.node.json`, para un paquete de Node (código en `src/`, pruebas en `test/` o junto al código, sin Front end). La plantilla de ejemplo sigue siendo la que se usa por defecto.
- **`qa_visual`** estaba en las instrucciones de Lumen y Argos pero no en la plantilla ni en el README. Ahora está en los dos, como opcional.
- El instalador dice que hay que reiniciar Claude Code, que la lista para copiar a mano incluye `permissions`, y avisa del costo. El README ya no dice "No borra nada" sin aclarar que sobrescribe lo suyo.
- El README dice qué límite se mide (5 horas; 7 días solo en Pausa) y cuándo no hay dato.

Sin hacer: `no_leer` sigue sin que nadie lo aplique (el guardián no intercepta `Read`); la plantilla mínima no se ha usado en una tarea real.

## Mapa con el flujo de una tarea (2026-11-11)

- `mapa.html` muestra el flujo de una tarea por tamaño (chica, mediana, grande), el commit único y el relevo de corridas largas, según las secciones 5, 7 y 9 de la especificación.
- Se quitaron las animaciones decorativas; las que quedan responden a un paso o a una interacción, y respetan `prefers-reduced-motion`.
- Se corrigieron textos que ya no cuadraban con la especificación: el selector de tipo ya no se presenta como tamaño, no negociables 10, 14 y 15, ramas y commits, y qué pasa con los commits `wip:` al reiniciarse el límite (se quedan y desaparecen en el commit único).
- El mapa sigue siendo una vista para personas: si contradice la especificación, manda la especificación.

## Primera tarea medida con ruta por tamaño (2026-11-11)

Una tarea mediana sobre este mismo repo (el mapa), con la sesión principal en Opus y `"reglas": 3`.

- **Costo:** 21.10 USD a precio de API en 488 turnos. Sesión principal 31 %, Argos 19 %, Prisma 15 %, Meridiano 9 %, Lumen 7 %, Égida 6 %; Faro, Norte, Brújula, Códice y un ligero suman el 14 % restante.
- **Caché vencida:** 3.24 USD (15 %) en turnos que volvieron a escribir el contexto.
- **Ruta:** 9 compañeros y 1 ligero para un cambio de un archivo HTML y una prueba. Se clasificó mediana, y no chica, porque tocaba una pantalla que ya existía (entra Diseño).
- **Guardián:** 15 bloqueos. Varios venían de un permitido mal escrito en la config (`node pruebas/`, que nunca coincide); `instalar.js --revisar` ahora lo avisa.
- **Compactación:** la sesión principal compactó una vez, al final, y después hizo el commit único y cerró a los compañeros sin problema.
- **Límite de uso:** con el límite de 5 horas en 86 % la habilidad no abrió la tarea, como debe.

Sin medir todavía: una tarea chica, la misma tarea en una sesión sola (no hay con qué comparar los 21 USD), y el relevo, que no se ejercitó porque no hubo corridas largas. Sin revisar: algunos bloqueos negaron trozos de un comando que iban entre comillas, lo que apunta a que el guardián parte los comandos por `|` y `;` sin mirar las comillas. Nadie, ni la sesión principal, puede corregir la config con una tarea abierta: un error ahí termina en un comando a mano de la persona.

## PR desde la sesión principal sin tarea abierta (2026-11-11)

- Sin `activa.json`, la sesión principal puede correr `gh pr create` (con `remoto.pr=true` y `-R` al repo configurado). Sirve para mantener un repo por rama y PR sin abrir una tarea completa.
- Con una tarea abierta no cambia nada: abre el PR Yunque, o Faro si Yunque no participa. Las tareas con `"reglas": 2` siguen igual.
- Subir a `main` y unir el PR siguen negados a la sesión principal.

## Bloqueos falsos de comandos (2026-11-11)

En la primera tarea medida el guardián negó comandos que sí estaban permitidos. Tres causas, las tres en cómo parte un comando antes de compararlo con la lista:

- **Comillas mezcladas.** Un apóstrofo dentro de comillas dobles (`grep "don't" a.md | grep 'x|y'`) se tomaba por el comienzo de otra cadena, y una `|` que iba entre comillas partía el comando. Ahora se recorre de izquierda a derecha y manda la comilla que abre primero.
- **Asignación sola.** `F="ruta"` en su propia línea se trataba como un comando llamado `F=""`. Ya no se revisa, salvo que lleve `$( )` o comillas invertidas.
- **Redirecciones.** `2>&1` y `> /dev/null` hacían que una expresión terminada en `$` no coincidiera nunca. Se quitan antes de comparar; una redirección a un archivo se deja.

Además, en las dos plantillas los líderes de fase pueden usar `head`, `tail`, `grep` y `wc`: solo tenían `git` y no podían ni acortar la salida de `git log`.

Sin tocar, y conviene saberlo: la lista de comandos no mira lo que va dentro de `$( )` ni de comillas invertidas, y un comando permitido puede redirigir su salida a cualquier archivo (`cat x > y`). Las reglas de push, PR y merge sí miran dentro. Cerrarlo puede negar usos que hoy pasan (por ejemplo `git commit -m "$(cat <<EOF ...)"` en quien solo tiene `git`), así que va aparte y con medición.

## Tarea chica que toca una pantalla que ya existe (2026-11-11)

Hasta ahora, tocar una pantalla que ya existía metía a Diseño en la ruta, y con Diseño la tarea dejaba de ser chica: ningún cambio de interfaz podía ir por la ruta barata. Ahora, si la orden ya dice qué debe verse (estados, textos y dónde va cada cosa), Diseño no entra y la tarea puede ser chica. Argos captura el antes (guardando los cambios con `git stash`) y el después, y compara. Si hay que decidir flujos, estados o composición, sigue entrando Diseño y la tarea es mediana.

`qa_visual.propio` (opcional, texto): para un proyecto que ya tiene su propio recorrido con navegador, por ejemplo una aplicación que necesita servidor y base de datos de pruebas y no se puede servir desde una carpeta compilada. Argos sigue lo que diga ahí en vez de `recorrido.js`.

Sin medir todavía en una tarea real.

## El guardián se apagaba si git no reconocía el repo (2026-11-11)

El guardián ubica el repo con `git rev-parse`. En una carpeta donde git se niega a trabajar ("dubious ownership": la carpeta es de otro dueño de Windows y no está en `safe.directory`), esa llamada fallaba, el guardián no encontraba la config y dejaba pasar todo sin avisar. Ahora, si git falla, busca la raíz leyendo `.git` (carpeta, o archivo `gitdir:` en un worktree). Dos casos en `pruebas/guardian.test.js`.

Aparte, en un repo así los agentes tampoco pueden usar git. Se arregla sin tocar la config global, con tres variables en `env` de los settings del repo: `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=safe.directory`, `GIT_CONFIG_VALUE_0=<ruta del repo o *>`.

## Lo que no se pudo implementar tal cual

1. **Esfuerzo por tarea** (negociable): el esfuerzo viene fijo en el archivo de cada agente; la herramienta Agent no lo recibe al lanzar. xi-0 solo puede sugerir "esfuerzo bajo" en el prompt.
2. **Probador de Sextante en entorno aislado**: no hay sandbox real; Sextante solo consulta paquetes (`npm view`, `dotnet list`) y no instala.
3. **Escrituras vía Bash** (`echo > archivo`, `sed -i`) no las ve la regla de carpetas; solo `Write/Edit/NotebookEdit`.
4. **"Ahorro: salvo para cerrar algo ya empezado"**: el guardián no sabe si un ligero nuevo cierra algo; en Ahorro bloquea todos.
5. **Panel visual del límite (mod)**: solo la statusline.
6. **Agent teams en la nube / `-p`**: no crean compañeros (limitación de la plataforma).

## Puntos abiertos (sección 13) verificados en la documentación

- Hooks reciben `agent_type` → un solo script aplica reglas por equipo. ✔
- `PreToolUse` intercepta `SendMessage` (matcher por nombre de herramienta). ✔ El campo del destinatario se lee como `to`/`recipient`; confirmar con el primer `registro.jsonl` real.
- Subagentes de un compañero: en primer plano, con las `tools` de su propio archivo. ✔
