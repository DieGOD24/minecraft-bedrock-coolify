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

# --- Addons ---------------------------------------------------------------
# Se corre antes que nada: si cambia la activacion, hay que reiniciar y conviene
# que quede avisado arriba del todo en los logs.
/usr/local/bin/install-addons.sh

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

# --- Vigilancia de jugadores ----------------------------------------------
# Consulta `list` cada rato y lo registra SOLO cuando la lista cambia. Es la
# unica forma de saber quien esta conectado: BDS escribe eso en el stdout de su
# contenedor y la API de Coolify no expone ese contenedor (ver console-ssh.sh).
# Registrar solo los cambios evita inundar los logs y deja un historial de
# entradas y salidas. Ademas permite consultarlo sin redesplegar, que es lo que
# antes obligaba a echar a todos.
: "${PLAYER_POLL_SECONDS:=300}"

vigilar_jugadores() {
  local previo="" actual
  while true; do
    if actual=$(/usr/local/bin/console-ssh.sh "list" 2>/dev/null | grep -iE 'players online|^[[:space:]]*[A-Za-z0-9]' | grep -v '^###' | tr -s ' 
' ' ' | paste -sd'|' -); then
      if [[ -n "$actual" && "$actual" != "$previo" ]]; then
        log "JUGADORES: $actual"
        previo="$actual"
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
