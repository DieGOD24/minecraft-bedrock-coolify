#!/bin/bash
# Snapshot consistente del mundo de Bedrock y subida a MinIO.
#
# Secuencia: save hold -> esperar flush -> tar -> save resume -> mc cp -> retencion.
# "save hold" hace que BDS deje de escribir en el LevelDB del mundo, que es lo que
# evita que el tar capture un estado a medias.
set -uo pipefail
source /usr/local/bin/lib-console.sh

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

: "${MINIO_ENDPOINT:?falta MINIO_ENDPOINT}"
: "${MINIO_ACCESS_KEY:?falta MINIO_ACCESS_KEY}"
: "${MINIO_SECRET_KEY:?falta MINIO_SECRET_KEY}"
: "${MINIO_BUCKET:=minecraft-backups}"
: "${RETENTION_DAYS:=14}"
: "${SAVE_HOLD_WAIT:=20}"

DATA_DIR=/data
TS=$(date -u '+%Y%m%dT%H%M%SZ')
ARCHIVE="/tmp/bedrock-${TS}.tar.gz"

QUIESCED=0
if send_console "save hold"; then
  QUIESCED=1
  log "save hold enviado a BDS. Esperando ${SAVE_HOLD_WAIT}s al flush..."
  sleep "$SAVE_HOLD_WAIT"
else
  log "WARNING: no se alcanzó la consola de BDS."
  log "WARNING: el backup se hará EN CALIENTE, sin garantía de consistencia del LevelDB."
  log "WARNING: revisar 'pid: service:bedrock' en docker-compose.yml y el PidMode del contenedor."
fi

cd "$DATA_DIR" || { log "ERROR: no existe $DATA_DIR"; exit 1; }

TARGETS=()
for f in worlds server.properties permissions.json allowlist.json; do
  [[ -e "$f" ]] && TARGETS+=("$f")
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  log "ERROR: no hay nada que respaldar en $DATA_DIR (¿el server todavía no arrancó?)"
  [[ $QUIESCED -eq 1 ]] && send_console "save resume"
  exit 1
fi

log "Empaquetando: ${TARGETS[*]}"
tar -czf "$ARCHIVE" "${TARGETS[@]}"
TAR_RC=$?

# Reanudar la escritura del server cuanto antes, pase lo que pase con el tar.
if [[ $QUIESCED -eq 1 ]]; then
  send_console "save resume" && log "save resume enviado."
fi

if [[ $TAR_RC -ne 0 ]]; then
  log "ERROR: tar falló (rc=${TAR_RC})"
  rm -f "$ARCHIVE"
  exit 1
fi
log "Archivo local: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

if ! mc --quiet alias set backup "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"; then
  log "ERROR: mc alias set falló (¿endpoint o credenciales mal?)"
  rm -f "$ARCHIVE"
  exit 1
fi

mc --quiet mb --ignore-existing "backup/${MINIO_BUCKET}"

if ! mc --quiet cp "$ARCHIVE" "backup/${MINIO_BUCKET}/bedrock/"; then
  log "ERROR: la subida a MinIO falló. Se conserva $ARCHIVE para el próximo intento."
  exit 1
fi
log "Subido: ${MINIO_BUCKET}/bedrock/$(basename "$ARCHIVE")"
rm -f "$ARCHIVE"

log "Aplicando retención de ${RETENTION_DAYS} días..."
mc --quiet rm --recursive --force --older-than "${RETENTION_DAYS}d" \
  "backup/${MINIO_BUCKET}/bedrock/" || log "WARNING: la limpieza por retención falló"

log "Backup completado."
