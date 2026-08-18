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
# Acepta .mcaddon, .mcpack y tambien DIRECTORIOS, para que los packs propios
# vivan como archivos legibles y revisables en git, sin paso de empaquetado.
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
paquetes=("$ADDONS_DIR"/*.mcaddon "$ADDONS_DIR"/*.mcpack "$ADDONS_DIR"/*/)
shopt -u nullglob
if [[ ${#paquetes[@]} -eq 0 ]]; then
  log "No hay addons en $ADDONS_DIR."
  exit 0
fi

if [[ ! -d "$WORLD" ]]; then
  log "WARNING: el mundo $WORLD todavia no existe; se omite la instalacion."
  exit 0
fi

declare -a bp_json=() rp_json=()

for pack in "${paquetes[@]}"; do
  if [[ -d "$pack" ]]; then
    # Pack en formato directorio: se lee tal cual. OJO: no se borra al final.
    if [[ -z "$(find "$pack" -name manifest.json -print -quit 2>/dev/null)" ]]; then
      log "aviso: $(basename "$pack") no tiene manifest.json, se ignora"
      continue
    fi
    src="$pack"; limpiar=0
  else
    src=$(mktemp -d); limpiar=1
    if ! unzip -q -o "$pack" -d "$src"; then
      log "ERROR: no pude descomprimir $(basename "$pack")"; rm -rf "$src"; continue
    fi
  fi

  # Un pack puede traer varios sub-packs; se clasifica cada uno por el TIPO DE SUS
  # MODULOS, no por el nombre de la carpeta (BP/RP, data/resources, etc.).
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
  done < <(find "$src" -name manifest.json)

  [[ $limpiar -eq 1 ]] && rm -rf "$src"
done

# Minecraft admite comentarios en sus JSON (de UI sobre todo); jq no. Se quitan
# los de bloque, en linea o multilinea, y los de linea.
sin_comentarios() {
  sed -e 's|/\*[^*]*\*/||g' -e '/\/\*/,/\*\//d' -e 's|^[[:space:]]*//.*$||' "$1"
}

# Fusiona ui/_ui_defs.json entre TODOS los resource packs instalados.
#
# Por que: Bedrock no fusiona los JSON de UI. Si dos packs definen _ui_defs.json
# (WAILA y Chest-UI lo hacen), gana el de mayor prioridad y el otro pierde sus
# definiciones: o se rompe el panel de WAILA, o no se dibuja el cofre.
#
# Ese archivo es solo una lista de rutas, asi que se escribe la UNION en CADA pack
# que lo defina. Gane quien gane, todos quedan registrados. Es idempotente.
fusionar_ui_defs() {
  local dir="$DATA/resource_packs"
  [[ -d "$dir" ]] || return 0

  local archivos
  mapfile -t archivos < <(find "$dir" -path "*/ui/_ui_defs.json" 2>/dev/null)
  if [[ ${#archivos[@]} -lt 2 ]]; then
    log "ui_defs: ${#archivos[@]} pack(s) lo definen, no hace falta fusionar"
    return 0
  fi

  # Union de todas las rutas.
  # OJO: Minecraft acepta comentarios en sus JSON de UI y jq NO. El _ui_defs.json
  # de WAILA lleva uno, asi que hay que quitarlos antes o la fusion falla entera.
  local union
  union=$(for a in "${archivos[@]}"; do sin_comentarios "$a"; done     | jq -s 'map(.ui_defs // []) | add | unique_by(.)' 2>/dev/null)
  if [[ -z "$union" || "$union" == "null" ]]; then
    log "WARNING: no pude fusionar los ui_defs; se dejan como estan"
    return 1
  fi

  local total
  total=$(printf '%s' "$union" | jq 'length')
  local escritos=0
  for a in "${archivos[@]}"; do
    local actual
    actual=$(sin_comentarios "$a" | jq -c '.ui_defs // [] | unique_by(.)' 2>/dev/null)
    if [[ "$actual" == "$(printf '%s' "$union" | jq -c '.')" ]]; then continue; fi
    printf '%s' "$union" | jq '{ui_defs: .}' > "$a.tmp" && mv "$a.tmp" "$a"
    escritos=$((escritos + 1))
  done
  if [[ $escritos -gt 0 ]]; then
    log "ui_defs fusionados: $total rutas escritas en $escritos de ${#archivos[@]} packs"
  else
    log "ui_defs ya estaban fusionados ($total rutas en ${#archivos[@]} packs)"
  fi
}

fusionar_ui_defs

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
