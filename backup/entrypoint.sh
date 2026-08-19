#!/bin/bash
# Sidecar: aplica los comandos de arranque y luego respalda en bucle.
# Se usa un loop en vez de cron a proposito: asi todo el output cae directo en el
# stdout del contenedor y se ve en los logs de Coolify.
set -uo pipefail
source /usr/local/bin/lib-console.sh

: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BACKUP_INITIAL_DELAY_SECONDS:=300}"
: "${STARTUP_COMMANDS:=}"
: "${STARTUP_COMMANDS_DELAY_SECONDS:=90}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

log "Iniciado. Intervalo de backup: ${BACKUP_INTERVAL_SECONDS}s."
log "Para disparar un backup a mano: docker exec <contenedor-backup> /usr/local/bin/backup.sh"

# --- Permisos ---------------------------------------------------------------
# Antes que nada: la imagen escribe gamertags crudos en el campo xuid cuando la
# API de resolucion falla, y ese permissions.json corrupto puede dejar a todos
# sin permisos. Ver backup/fix-permissions.sh.
/usr/local/bin/fix-permissions.sh

# --- Addons ---------------------------------------------------------------
# Se corre antes que nada: si cambia la activacion, hay que reiniciar y conviene
# que quede avisado arriba del todo en los logs.
/usr/local/bin/install-addons.sh

# --- Volcado de la consola de BDS -------------------------------------------
# Copia lo que escribe el servidor a ESTOS logs, que son los unicos que Coolify
# devuelve. Sin esto no se ven los errores del motor de scripts ni los
# console.log de los addons, y diagnosticar es adivinar. Ver bds-tail.sh.
if [[ -n "${RCON_PASSWORD:-}" ]]; then
  /usr/local/bin/bds-tail.sh &
  log "Volcado de la consola de BDS iniciado (prefijo [bds])."
  # Un margen para que la sesion este abierta antes de mandar nada: lo que se
  # escriba antes de conectar no se ve.
  sleep 5
fi

# --- Volcado del Content Log (la salida de console.log de los scripts) ------
# HALLAZGO, y explica por que instrumentar con console.warn no sirvio de nada:
# BDS NO manda la salida de console.log/warn de los scripts a su stdout. Se
# comprobo con un `reload`: la linea "[mochilas] cargado", que esta al nivel
# superior del modulo, no aparecio en ningun log, aunque el latido demuestra que
# el script SI corre. Esa salida va al Content Log, apagado por defecto.
#
# Con CONTENT_LOG_FILE_ENABLED=true BDS lo escribe en un archivo dentro de /data,
# que este sidecar comparte. Aqui se busca y se vuelca con prefijo [log]. Se
# anuncia el archivo encontrado para saber en la proxima ronda si funciono; si
# no aparece ninguno, el bucle no molesta a nadie.
(
  vistos=""
  while :; do
    while IFS= read -r f; do
      case " $vistos " in *" $f "*) continue ;; esac
      vistos="$vistos $f"
      log "Content Log encontrado: $f"
      tail -n 0 -F "$f" 2>/dev/null | awk '{ print "[log] " $0; fflush() }' &
    done < <(find /data -maxdepth 2 \( -iname 'contentlog*' -o -iname '*.log' \) -type f 2>/dev/null)
    sleep 30
  done
) &
log "Buscando el Content Log de BDS en /data (prefijo [log])."

# --- Comandos de arranque -------------------------------------------------
# Los gamerules viven en level.dat, asi que basta con aplicarlos una vez; pero
# reenviarlos en cada arranque es idempotente y mantiene el mundo alineado con
# lo que dice el repo, que es el punto de tener esto versionado.
if [[ -n "${STARTUP_COMMANDS//[[:space:]]/}" ]]; then
  log "Esperando ${STARTUP_COMMANDS_DELAY_SECONDS}s antes de los comandos de arranque..."
  sleep "$STARTUP_COMMANDS_DELAY_SECONDS"

  if wait_for_bds; then
    while IFS= read -r cmd; do
      cmd="$(printf '%s' "$cmd" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      [[ -z "$cmd" || "$cmd" == \#* ]] && continue
      if send_console "$cmd"; then
        log "consola <- $cmd"
      else
        log "WARNING: no pude enviar a la consola: $cmd"
      fi
      sleep 1
    done <<< "$STARTUP_COMMANDS"
    log "Comandos de arranque aplicados."
  else
    log "WARNING: BDS no apareció; se omiten los comandos de arranque."
    log "WARNING: revisar 'pid: service:bedrock' en docker-compose.yml."
  fi

  restante=$(( BACKUP_INITIAL_DELAY_SECONDS - STARTUP_COMMANDS_DELAY_SECONDS ))
  [[ $restante -gt 0 ]] && { log "Primer backup en ${restante}s."; sleep "$restante"; }
else
  log "Sin comandos de arranque. Primer backup en ${BACKUP_INITIAL_DELAY_SECONDS}s."
  sleep "$BACKUP_INITIAL_DELAY_SECONDS"
fi

# --- Comprobaciones por consola ---------------------------------------------
# Ejecuta comandos sueltos y VUELCA SU RESPUESTA en estos logs. Sirve para probar
# sintaxis contra el BDS real sin tener que entrar al juego: los console.log de un
# script y los errores de comando salen por el stdout del contenedor bedrock, que
# la API de Coolify no expone.
: "${CONSOLE_CHECKS:=}"

comprobar_consola() {
  [[ -z "${CONSOLE_CHECKS//[[:space:]]/}" ]] && return 0
  local cmd salida
  while IFS= read -r cmd; do
    cmd="$(printf '%s' "$cmd" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -z "$cmd" || "$cmd" == \#* ]] && continue
    salida=$(/usr/local/bin/console-ssh.sh "$cmd" 2>&1 | grep -v '^###' | tr -d '
' | tr -s ' 
' ' ')
    log "consola? [$cmd] -> ${salida:-sin respuesta}"
  done <<< "$CONSOLE_CHECKS"
}

if [[ -n "${RCON_PASSWORD:-}" ]]; then
  comprobar_consola
fi

# --- Latido de los scripts --------------------------------------------------
# Comprueba que cada pack de script esta VIVO AHORA, no que lo estuvo alguna vez.
# La sonda anterior era un objetivo de scoreboard, que es persistente: sobrevive
# al script y sigue ahi aunque el pack este muerto. Dio falsa tranquilidad.
# Aqui se lee el contador dos veces separadas: si SUBE, el script corre.
: "${SCRIPT_HEARTBEATS:=}"

leer_latido() {   # $1 = participante -> imprime el numero, o vacio
  # ORDEN IMPORTANTE: primero se quita la linea '###' de console-ssh.sh y DESPUES
  # los retornos de carro. Al reves, un tr que borre saltos de linea deja toda la
  # respuesta en una sola linea que empieza por '###', y el grep la elimina entera:
  # asi es como el latido salia siempre vacio.
  #
  # El CR se borra por su codigo octal (\015) y no como \r, para que ninguna
  # herramienta de edicion lo convierta en un byte CR de verdad dentro del script.
  local cruda
  cruda=$(/usr/local/bin/console-ssh.sh "scoreboard players list $1" 2>&1 | grep -v '^###' | tr -d '\015')
  # A STDERR sin falta: esta funcion DEVUELVE su valor por stdout y el log se
  # colaba dentro, reportando 'VIVO' siempre porque dos logs con timestamps
  # distintos nunca son iguales. Mismo fallo que ya cometi en version_por_contenido.
  [[ -n "${LATIDO_DEBUG:-}" ]] && log "  latido crudo [$1]: $(printf '%s' "$cruda" | tr -s '[:space:]' ' ')" >&2
  # No vale con 'el ultimo numero': BDS antepone timestamps llenos de digitos.
  printf '%s' "$cruda" |
    grep -oiE "salud[^0-9-]{0,4}(-?[0-9]+)|(-?[0-9]+)[[:space:]]*\(salud" |
    grep -oE '(-?[0-9]+)' | head -1
}

verificar_latidos() {
  [[ -z "${SCRIPT_HEARTBEATS//[[:space:]]/}" ]] && return 0
  local p a b
  declare -A antes
  for p in $SCRIPT_HEARTBEATS; do antes[$p]=$(leer_latido "$p"); done
  sleep 8
  for p in $SCRIPT_HEARTBEATS; do
    a="${antes[$p]}"; b=$(leer_latido "$p")
    if [[ -z "$a" && -z "$b" ]]; then
      log "LATIDO '$p': SIN SEÑAL -> el script no llego a correr nunca en este mundo"
    elif [[ -n "$b" && -n "$a" && "$b" != "$a" ]]; then
      log "LATIDO '$p': VIVO ($a -> $b)"
    else
      log "LATIDO '$p': MUERTO (se quedo en '${b:-$a}') -> el pack cargo alguna vez pero ya no corre"
    fi
  done
}

if [[ -n "${RCON_PASSWORD:-}" ]]; then
  verificar_latidos
fi

# --- Verificacion de addons -----------------------------------------------
# Comprueba que BDS realmente CARGO el addon, no solo que los archivos estan.
# `testfor` con un tipo de entidad no crea ni destruye nada: si el addon cargo,
# responde "No targets matched selector" (tipo valido, cero instancias); si no,
# da un error de tipo desconocido. Un `summon`+`kill` seria destructivo, porque
# el kill alcanzaria las lapidas reales de los jugadores.
: "${ADDON_CHECK_ENTITIES:=}"

verificar_addons() {
  local ent salida
  for ent in $ADDON_CHECK_ENTITIES; do
    salida=$(/usr/local/bin/console-ssh.sh "testfor @e[type=$ent]" 2>&1 | tr -d '
')
    # BDS responde de dos formas cuando el tipo es valido: "No targets matched
    # selector" si no hay ninguna instancia, o "Found entity.<id>.name" si las
    # hay. Solo un tipo desconocido da error de sintaxis.
    if printf '%s' "$salida" | grep -qiE "no targets matched|matched [0-9]+ target|found entity\.$ent\.name|^found "; then
      log "ADDON OK: la entidad '$ent' existe -> el pack esta cargado"
    else
      log "ADDON WARNING: '$ent' no reconocida. Respuesta:"
      printf '%s
' "$salida" | grep -v '^###' | sed 's/^/    /' | head -5
    fi
  done
}

if [[ -n "${RCON_PASSWORD:-}" && -n "$ADDON_CHECK_ENTITIES" ]]; then
  verificar_addons
fi

# --- Vigilancia de jugadores ----------------------------------------------
# Consulta `list` cada rato y lo registra SOLO cuando la lista cambia. Es la
# unica forma de saber quien esta conectado: BDS escribe eso en el stdout de su
# contenedor y la API de Coolify no expone ese contenedor (ver console-ssh.sh).
# Registrar solo los cambios evita inundar los logs y deja un historial de
# entradas y salidas. Ademas permite consultarlo sin redesplegar, que es lo que
# antes obligaba a echar a todos.
: "${PLAYER_POLL_SECONDS:=300}"

# Da operador por consola a los jugadores de AUTO_OP_PLAYERS que esten online.
#
# Se usa `op <nombre>` y no la variable OPS de la imagen a proposito: OPS resuelve
# los gamertags contra mcprofile.io, que hoy devuelve HTTP 523, y ante el fallo
# escribe el gamertag crudo en el campo xuid sin avisar. BDS, en cambio, resuelve
# el XUID por su cuenta a partir del jugador conectado. Es idempotente.
: "${AUTO_OP_PLAYERS:=}"

auto_op() {
  [[ -z "${AUTO_OP_PLAYERS//[[:space:]]/}" ]] && return 0
  local lista_online="$1" nombre salida
  local IFS=','
  for nombre in $AUTO_OP_PLAYERS; do
    nombre="$(printf '%s' "$nombre" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -z "$nombre" ]] && continue
    # Solo si BDS lo reporta conectado: necesita al jugador presente para resolver el XUID.
    printf '%s' "$lista_online" | grep -qF "$nombre" || continue
    # El nombre va ENTRECOMILLADO: un gamertag con espacio ("sebas GT1858")
    # rompe el parser de BDS -> Syntax error: Unexpected "GT1858".
    salida=$(/usr/local/bin/console-ssh.sh "op \"$nombre\"" 2>&1 | grep -v '^###' | tr -d '
' | tr -s ' 
' ' ')
    log "op '$nombre' -> ${salida:-sin respuesta}"
  done
}

vigilar_jugadores() {
  local previo="" actual
  while true; do
    if actual=$(/usr/local/bin/console-ssh.sh "list" 2>/dev/null | grep -iE 'players online|^[[:space:]]*[A-Za-z0-9]' | grep -v '^###' | tr -s ' 
' ' ' | paste -sd'|' -); then
      if [[ -n "$actual" && "$actual" != "$previo" ]]; then
        log "JUGADORES: $actual"
        previo="$actual"
        auto_op "$actual"
      fi
    fi
    sleep "$PLAYER_POLL_SECONDS"
  done
}

if [[ -n "${RCON_PASSWORD:-}" ]]; then
  log "Consola SSH activa. Vigilando jugadores cada ${PLAYER_POLL_SECONDS}s."
  vigilar_jugadores &
else
  log "RCON_PASSWORD no definido: sin consola SSH ni vigilancia de jugadores."
fi

# --- Bucle de respaldo ----------------------------------------------------
while true; do
  if /usr/local/bin/backup.sh; then
    log "Ciclo OK. Próximo backup en ${BACKUP_INTERVAL_SECONDS}s."
  else
    log "ERROR: el backup falló (rc=$?). Se reintenta en el próximo ciclo."
  fi
  sleep "$BACKUP_INTERVAL_SECONDS"
done
