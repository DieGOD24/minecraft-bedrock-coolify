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

# Sube la version de un resource pack propio cuando cambia su CONTENIDO.
#
# POR QUE: el cliente de Bedrock cachea los resource packs de servidor por
# UUID + VERSION. Si el contenido cambia y la version no, el cliente se queda
# con la copia vieja para siempre y el servidor no tiene forma de avisarle.
#
# Nos costo varios despliegues: Chest-UI se anadio al RP de mochilas dejando la
# version en 1.0.0, asi que los clientes siguieron con el pack sin carpeta ui/ y
# la mochila salia como lista de texto. El servidor se veia perfecto: los
# archivos estaban ahi, byte a byte iguales al upstream. El sintoma es mudo.
#
# El contador vive en /data, que es un volumen, asi que solo sube: nunca baja ni
# se repite aunque el contenido vuelva a un estado anterior.
#
# Solo se aplica a packs PROPIOS: los de terceros declaran dependencies con
# version exacta, y reescribirsela romperia esa resolucion.
version_por_contenido() {
  local dest="$1" uuid="$2" ver="$3"
  local hash marca previo patch

  if ! command -v sha256sum >/dev/null 2>&1; then
    log "  aviso: no hay sha256sum; no puedo versionar por contenido. Sube la version a mano." >&2
    printf '%s' "$ver"; return
  fi

  # Se excluye manifest.json porque es justo lo que vamos a reescribir.
  hash=$(find "$dest" -type f ! -name manifest.json -print0 \
         | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -c1-16)
  marca="$DATA/.pack-versions/$uuid"
  mkdir -p "$(dirname "$marca")"

  previo=""; patch=0
  if [[ -f "$marca" ]]; then
    previo=$(cut -d' ' -f1 "$marca"); patch=$(cut -d' ' -f2 "$marca")
  fi

  if [[ "$previo" != "$hash" ]]; then
    patch=$((patch + 1))
    echo "$hash $patch" > "$marca"
    log "  contenido cambiado -> version .$patch; los clientes lo redescargaran" >&2
  fi

  # La version del manifest y la de world_*_packs.json DEBEN coincidir: si
  # difieren, BDS no casa el pack y no lo sirve.
  ver=$(jq -c --argjson p "$patch" '.[0:2] + [$p]' <<<"$ver")
  # El temporal NO puede vivir dentro del pack: si jq falla, el redirect ya lo
  # creo, se quedaria dentro, se serviria al cliente y ademas entraria en el
  # hash, que pasaria a cambiar en cada arranque.
  local tmp; tmp=$(mktemp)
  if jq --argjson v "$ver" '.header.version = $v
                            | .modules = [.modules[] | .version = $v]'        "$dest/manifest.json" > "$tmp" && [[ -s "$tmp" ]]; then
    cp "$tmp" "$dest/manifest.json"
  else
    log "  ERROR: no pude reescribir la version en $dest/manifest.json" >&2
  fi
  rm -f "$tmp"

  printf '%s' "$ver"
}

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
    src="$pack"; limpiar=0; propio=1
  else
    src=$(mktemp -d); limpiar=1; propio=0
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

    # Solo los resource packs los descarga el cliente, asi que solo ellos
    # necesitan que la version cambie para invalidarle la cache.
    if [[ $propio -eq 1 && "$kind" == "resource_packs" ]]; then
      ver=$(version_por_contenido "$dest" "$uuid" "$ver")
    fi

    log "instalado: $(jq -r '.header.name' "$manifest") -> $kind/$uuid v$ver"

    entrada="{\"pack_id\":\"$uuid\",\"version\":$ver}"
    if [[ "$kind" == "behavior_packs" ]]; then bp_json+=("$entrada"); else rp_json+=("$entrada"); fi
  done < <(find "$src" -name manifest.json)

  [[ $limpiar -eq 1 ]] && rm -rf "$src"
done

# NO fusionar ui/_ui_defs.json entre packs.
#
# Hubo aqui una funcion que escribia la union de rutas en cada resource pack,
# creyendo que Chest-UI y WAILA se pisaban ese archivo. Estaba MAL en las dos
# puntas y rompio la vista de cofre:
#
#   1. Bedrock YA fusiona los JSON de UI entre packs; no habia conflicto.
#   2. Cada pack debe listar SOLO archivos propios. La union metia rutas que no
#      existen dentro del pack, y con rutas colgantes Bedrock descarta las
#      definiciones: el reskin de cofre nunca se registraba.
#
# Los packs se recopian desde /addons en cada arranque, asi que basta con no
# tocarlos.

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
