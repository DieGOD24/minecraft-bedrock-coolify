#!/bin/bash
# Instala y ACTIVA los addons de /addons en el mundo.
#
# Por que no lo hace MC_PACK de la imagen (ver addons/README.md):
#  - solo reconoce los layouts behavior_packs/, data/+resources/ o addon/<sub>/;
#    graves.mcaddon usa BP/+RP/, que no matchea ninguno.
#  - y aun matcheando, solo escribe world_*_packs.json en un dir temporal que
#    unicamente llega al mundo si el pack trae su propio level.dat.
# Resultado: sin esto, el pack queda instalado pero el mundo lo ignora.
#
# La activacion surte efecto en el ARRANQUE SIGUIENTE: BDS lee world_*_packs.json
# al cargar el mundo, y este sidecar corre despues del servidor.
set -uo pipefail

log() { echo "[addons] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

: "${ADDONS_DIR:=/addons}"
: "${LEVEL_NAME:=world}"
DATA=/data
WORLD="$DATA/worlds/$LEVEL_NAME"

shopt -s nullglob
paquetes=("$ADDONS_DIR"/*.mcaddon "$ADDONS_DIR"/*.mcpack)
shopt -u nullglob
if [[ ${#paquetes[@]} -eq 0 ]]; then
  log "No hay addons en $ADDONS_DIR."
  return 0 2>/dev/null || exit 0
fi

if [[ ! -d "$WORLD" ]]; then
  log "WARNING: el mundo $WORLD todavia no existe; se omite la instalacion."
  return 0 2>/dev/null || exit 0
fi

declare -a bp_json=() rp_json=()

for pack in "${paquetes[@]}"; do
  tmp=$(mktemp -d)
  if ! unzip -q -o "$pack" -d "$tmp"; then
    log "ERROR: no pude descomprimir $(basename "$pack")"; rm -rf "$tmp"; continue
  fi

  # Un .mcaddon puede traer varios packs; se clasifica cada uno por el tipo de
  # sus modulos, no por el nombre de la carpeta (BP/RP, data/resources, etc.).
  while IFS= read -r manifest; do
    uuid=$(jq -r '.header.uuid' "$manifest" 2>/dev/null)
    ver=$(jq -c '.header.version' "$manifest" 2>/dev/null)
    kind=$(jq -r '[.modules[]?.type] as $t
                  | if ($t | any(IN("data","script"))) then "behavior_packs"
                    elif ($t | any(. == "resources")) then "resource_packs"
                    else empty end' "$manifest" 2>/dev/null)
    [[ -z "$uuid" || "$uuid" == "null" || -z "$kind" ]] && continue

    dest="$DATA/$kind/$uuid"
    rm -rf "$dest"; mkdir -p "$dest"
    cp -a "$(dirname "$manifest")/." "$dest/"
    log "instalado: $(jq -r '.header.name' "$manifest") -> $kind/$uuid v$ver"

    entrada="{\"pack_id\":\"$uuid\",\"version\":$ver}"
    if [[ "$kind" == "behavior_packs" ]]; then bp_json+=("$entrada"); else rp_json+=("$entrada"); fi
  done < <(find "$tmp" -name manifest.json)
  rm -rf "$tmp"
done

# Escribe la activacion solo si cambio, para no reescribir el mundo en cada arranque.
escribir() {
  local archivo="$1"; shift
  local nuevo
  nuevo=$(printf '%s\n' "$@" | jq -s -c '.')
  if [[ -f "$archivo" ]] && [[ "$(jq -S -c '.' "$archivo" 2>/dev/null)" == "$(printf '%s' "$nuevo" | jq -S -c '.')" ]]; then
    log "$(basename "$archivo") ya estaba al dia"
    return 1
  fi
  printf '%s' "$nuevo" > "$archivo"
  log "escrito $(basename "$archivo"): $nuevo"
  return 0
}

cambio=0
[[ ${#bp_json[@]} -gt 0 ]] && { escribir "$WORLD/world_behavior_packs.json" "${bp_json[@]}" && cambio=1; }
[[ ${#rp_json[@]} -gt 0 ]] && { escribir "$WORLD/world_resource_packs.json" "${rp_json[@]}" && cambio=1; }

if [[ $cambio -eq 1 ]]; then
  log "ACTIVACION ACTUALIZADA. Hace falta REINICIAR el servidor para que cargue los addons."
else
  log "Addons ya activos, sin cambios."
fi
