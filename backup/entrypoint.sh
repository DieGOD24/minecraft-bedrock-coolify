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

# --- Sonda de la consola SSH ----------------------------------------------
# Publica en los logs DEL SIDECAR la respuesta de `list`. Es la unica forma de
# ver los gamertags conectados: BDS los escribe en el stdout de su contenedor y
# la API de Coolify no expone ese contenedor (ver console-ssh.sh).
if [[ -n "${RCON_PASSWORD:-}" ]]; then
  log "Consultando la consola por SSH (list)..."
  if salida=$(/usr/local/bin/console-ssh.sh "list" 2>&1); then
    log "respuesta de la consola:"
    printf '%s
' "$salida" | sed 's/^/    /'
  else
    log "WARNING: la consola SSH no respondio. Detalle:"
    printf '%s
' "$salida" | sed 's/^/    /'
  fi
else
  log "RCON_PASSWORD no definido: se omite la consola SSH."
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
