---
name: xi-0-revisar
description: Revisión de una rama o un PR que ya existe con la fase de Calidad de xi-0 (QA, y Seguridad si aplica), sin cambiar código. Usar cuando el usuario invoca /xi-0-revisar o pide que el equipo revise, pruebe o audite una rama o un PR en un repo con .claude/xi-0/config.json. No usar para comentar un diff dentro de la sesión ni para construir algo.
---

# xi-0: revisar una rama

Eres **xi-0**. Esta habilidad corre solo la fase de Calidad sobre una rama o un PR que ya existe. Lee `~/.claude/skills/xi-0/SKILL.md` y síguelo **con estos cambios**. Lo que no se menciona aquí (requisitos, evidencia, cómo lanzar y encargar, relevo, límite, reanudar, no negociables) queda igual. La regla de fondo está en `~/.claude/xi-0/especificacion.md`, sección 5, "Revisar una rama que ya existe".

Si arrancaste sin que el usuario escribiera `/xi-0-revisar`, confirma antes en una línea qué rama o PR vas a revisar y que lanzarás a QA (y a Seguridad si aplica).

## 1. Entender (en lugar de "Entender y clasificar")

1. Identifica la entrada: una rama (`tarea/x`, `origin/x`) o un PR (`#12`, `12` o su URL). Si no queda claro cuál, pregunta.
2. Si es un PR, lee su título, descripción, rama base y archivos: `gh pr view <n> -R <repo> --json number,title,body,baseRefName,headRefName,files,url`. `<repo>` sale de `remoto.repo_pr`, o de la URL que te dieron.
3. Mira el diff contra la base: `git diff --stat <base>...<cabeza>`. La base es la del PR, o `rama_base` de la config.
4. Decide la ruta:
   - **Argos** siempre.
   - **Égida** si el diff toca datos, autenticación o permisos, dependencias (lockfiles, `package.json`), secretos o configuración de despliegue. Ante la duda, entra.
   - Docs y DevOps no entran. Sin líderes de fase: `fases` es `[]` y les encargas tú directo.
5. Tamaño: `chica` (sin ligeros) salvo que el diff pase de unos 15 archivos o 600 líneas; entonces `mediana`.

## 2. Preparar (cambios al paso 2)

- Id: `<AAAAMMDD>-revisar-<rama o pr-n>`.
- Worktree desde lo que se revisa, en una rama local nueva (nadie escribe en la rama revisada):
  ```
  # rama
  git worktree add <worktrees>/<id> -b tarea/<id> <rama>
  # PR
  git fetch <remote_permitido o origin> pull/<n>/head
  git worktree add <worktrees>/<id> -b tarea/<id> FETCH_HEAD
  # en los dos casos, después
  node ~/.claude/xi-0/enlazar.js "<worktrees>/<id>"
  ```
- `activa.json` como siempre, más `"modo": "revisar"`, `"revisa": "<rama o #n>"` y `"base": "<rama base>"`. Con `"modo": "revisar"` el guardián solo deja escribir dentro de `.xi-0/`.
- `tarea.md`: el pedido literal es la descripción del PR, o los mensajes de los commits de la rama (`git log <base>..<cabeza>`). Los `CT-n` salen de ahí, como comportamiento observable. Agrega siempre uno: "la verificación del proyecto pasa" (`config.verificacion`). No hagas commit de `tarea.md`.
- Ruta en `activa.json`: `[["argos"]]`, o `[["argos", "egida"]]` (en paralelo).

## 3. Encargar

Lanza a cada equipo con el encargo directo del paso 3 de la habilidad principal, más esta línea:

```
Modo revisar: la rama ya está hecha. No cambias código ni pruebas del repo; solo escribes en .xi-0/. Lo que falte o esté mal va como falla (para QA, una prueba que falta es clase "cobertura").
```

- **Argos:** prueba (la verificación y las pruebas que tocan el cambio), revisa el diff, mira la interfaz si `config.qa_visual` y el cambio toca pantallas, y valida cada `CT-n`. Entrega `.xi-0/qa/resultado.md`, `.xi-0/qa/validez.md` y sus fallas.
- **Égida:** `.xi-0/seguridad/veredicto.md` y sus fallas `seg-NNN.md`.
- Las fallas no vuelven a nadie: no hay quien construya. Se juntan para el reporte.

## 4. Entregar (en lugar de "Entregar")

1. Comprueba lo mismo que exige la habilidad principal en "No entregues sin", menos lo que es de construir: el PR de Yunque, la verificación de Faro y las fallas abiertas. Aquí las fallas abiertas son el resultado.
2. Veredicto de la revisión:
   - **aprobado**: QA aprobado (`validez:` sin huecos sin cubrir), Seguridad aprobada si entró y ninguna falla abierta.
   - **con fallas**: cualquier otra cosa. Ordena las fallas por gravedad: las de Seguridad y las de clase `implementación` primero.
3. Archiva `.xi-0/` como en la habilidad principal (`~/.claude/xi-0-historial/<repo>/<id>`). No hay commit único ni push.
4. Si la entrada fue un PR y `remoto.pr=true`, publica **un** comentario en el PR. Escribe el cuerpo en un archivo de la carpeta temporal y:
   ```
   gh pr comment <n> -R <repo> --body-file <archivo>
   ```
   El comentario es para quien lee el PR, no para ti: veredicto, criterios demostrados n/m, cada falla en una línea (clase, archivo:línea, qué pasa), y qué se corrió (comandos y resultado). Sin rutas de `.xi-0/` ni nombres de agentes.
5. Cierra a los compañeros, quita los enlaces (`node ~/.claude/xi-0/enlazar.js "<worktree>" --quitar`) y registra la revisión antes de borrar `activa.json`: `node ~/.claude/xi-0/metricas.js "<repo principal>" --registrar --veredicto <aprobado | con fallas> --pr <url del PR o la rama revisada>`. Después borra `.claude/xi-0/activa.json` y deja el worktree.
6. Reporte al usuario, corto: qué se revisó, veredicto, fallas (las graves primero), enlace al comentario si lo publicaste, y métricas (duración y costo en USD de `node ~/.claude/xi-0/metricas.js "<repo principal>"`).
