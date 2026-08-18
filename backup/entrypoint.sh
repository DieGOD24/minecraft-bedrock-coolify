#!/bin/bash
# Bucle de respaldo. Se usa un loop en vez de cron a propósito: así todo el
# output cae directo en el stdout del contenedor y se ve en los logs de Coolify,
# sin depender de la semántica de mail/log de busybox crond.
set -uo pipefail

: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BACKUP_INITIAL_DELAY_SECONDS:=300}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

log "Iniciado. Intervalo: ${BACKUP_INTERVAL_SECONDS}s. Primer backup en ${BACKUP_INITIAL_DELAY_SECONDS}s."
log "Para disparar uno a mano: docker exec <contenedor-backup> /usr/local/bin/backup.sh"
sleep "$BACKUP_INITIAL_DELAY_SECONDS"

while true; do
  if /usr/local/bin/backup.sh; then
    log "Ciclo OK. Próximo backup en ${BACKUP_INTERVAL_SECONDS}s."
  else
    log "ERROR: el backup falló (rc=$?). Se reintenta en el próximo ciclo."
  fi
  sleep "$BACKUP_INTERVAL_SECONDS"
done
