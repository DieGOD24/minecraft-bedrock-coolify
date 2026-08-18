#!/bin/bash
# Sanea /data/permissions.json descartando entradas con xuid invalido.
#
# Por que hace falta: la imagen de itzg resuelve los gamertags de OPS a XUID
# contra mcprofile.io, y resolveXuid() termina en `echo "${xuid:-$value}"`. Si esa
# API falla -- hoy devuelve HTTP 523 -- escribe el GAMERTAG CRUDO en el campo xuid,
# en silencio y sin error. El resultado es un permissions.json como:
#
#   [{"permission":"operator","xuid":"sebas GT1858"}]
#
# que no le corresponde a ningun jugador y puede hacer que BDS descarte el archivo
# entero, dejando a todos sin permisos.
#
# Un XUID real es un entero de 15+ digitos, asi que ese es el filtro.
set -uo pipefail

log() { echo "[perms] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

ARCHIVO="${PERMISSIONS_FILE:-/data/permissions.json}"

if [[ ! -f "$ARCHIVO" ]]; then
  log "No existe $ARCHIVO, nada que sanear."
  exit 0
fi

if ! jq empty "$ARCHIVO" 2>/dev/null; then
  log "WARNING: $ARCHIVO no es JSON valido. Se reemplaza por una lista vacia."
  log "WARNING: contenido descartado -> $(head -c 300 "$ARCHIVO")"
  echo '[]' > "$ARCHIVO"
  exit 0
fi

# Un xuid valido: string de solo digitos, 15 o mas.
FILTRO='map(select((.xuid | type == "string") and (.xuid | test("^[0-9]{15,}$"))))'

invalidas=$(jq -c 'map(select((.xuid | type != "string") or (.xuid | test("^[0-9]{15,}$") | not)))' "$ARCHIVO" 2>/dev/null)
validas=$(jq -c "$FILTRO" "$ARCHIVO" 2>/dev/null)

if [[ -z "$validas" ]]; then
  log "WARNING: no pude procesar $ARCHIVO con jq. Se deja como estaba."
  exit 1
fi

if [[ "$invalidas" == "[]" ]]; then
  log "permissions.json esta limpio ($(jq 'length' "$ARCHIVO") entradas)."
  exit 0
fi

log "Descartando entradas con xuid invalido (gamertags sin resolver):"
printf '%s' "$invalidas" | jq -r '.[] | "    \(.permission // "?") <- \(.xuid | tostring)"'
log "Causa habitual: la API de resolucion de XUID caida. Ver AUTO_OP_PLAYERS."

printf '%s' "$validas" | jq '.' > "${ARCHIVO}.tmp" && mv "${ARCHIVO}.tmp" "$ARCHIVO"
log "permissions.json saneado: quedan $(jq 'length' "$ARCHIVO") entradas validas."
