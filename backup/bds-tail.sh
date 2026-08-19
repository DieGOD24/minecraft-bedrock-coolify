#!/bin/bash
# Copia la salida de la consola de BDS al stdout del sidecar, con prefijo [bds].
#
# POR QUE EXISTE
# La API de Coolify solo devuelve los logs del contenedor creado mas
# recientemente, que por `pid: service:bedrock` es SIEMPRE el sidecar y nunca el
# servidor. Todo lo que BDS escribe -- errores del motor de scripts, los
# console.log de los addons, avisos de carga de packs -- caia en un contenedor
# que no se puede leer.
#
# Esa ceguera costo varias rondas de diagnostico: sin ver si un pack de script
# carga o revienta, no queda mas que adivinar, y adivinar ya salio caro.
#
# La consola SSH de mc-server-runner es bidireccional, asi que basta con abrir
# una sesion y no cerrarla: lo que BDS escriba a partir de ese momento sale por
# aqui. `sleep infinity` mantiene stdin abierto; sin eso la sesion se cierra en
# cuanto termina la entrada.
#
# LIMITE IMPORTANTE: solo se ve lo que ocurre DESPUES de conectar. Los errores de
# carga de scripts pasan al cargar el mundo, antes de que este sidecar arranque.
# Para verlos hay que forzar una recarga con `reload` una vez conectado; de eso
# se encarga CONSOLE_CHECKS.
set -uo pipefail

: "${RCON_PASSWORD:?falta RCON_PASSWORD}"
: "${BEDROCK_SSH_HOST:=bedrock}"
: "${BEDROCK_SSH_PORT:=2222}"
: "${BEDROCK_SSH_USERS:=root minecraft bedrock console}"
: "${BDS_TAIL_RETRY_SECONDS:=15}"

log() { echo "[bds-tail] $(date '+%Y-%m-%d %H:%M:%S %Z') $*"; }

conectar() {
  local user="$1"
  sleep infinity |
    sshpass -p "$RCON_PASSWORD" ssh -tt -q       -o StrictHostKeyChecking=no       -o UserKnownHostsFile=/dev/null       -o PreferredAuthentications=password       -o PubkeyAuthentication=no       -o LogLevel=ERROR       -o ServerAliveInterval=30       -p "$BEDROCK_SSH_PORT" "${user}@${BEDROCK_SSH_HOST}" 2>&1
}

# Se reconecta sola: si BDS se reinicia, la sesion muere y sin esto el volcado se
# perderia en silencio, que es justo el fallo que este script viene a evitar.
#
# El usuario que acepta mc-server-runner no esta documentado. Se prueban varios y
# en cuanto uno aguanta una sesion se RECUERDA: rotar en cada reconexion llenaria
# los logs de intentos fallidos.
usuario_ok=""
while true; do
  for u in ${usuario_ok:-$BEDROCK_SSH_USERS}; do
    log "conectando como '$u'..."
    inicio=$SECONDS
    # El pseudo-tty mete retornos de carro que parten las lineas en los logs; se
    # quitan con tr por su codigo octal.
    #
    # OJO con la opcion -u de sed: en Alpine sed es BusyBox y no la acepta. El
    # volcado moria al instante con "unrecognized option: u" y parecia que no
    # habia salida. awk con fflush() no bufferiza y ademas es portable.
    conectar "$u" | tr -d '\015' | awk '{ print "[bds] " $0; fflush() }'
    duro=$(( SECONDS - inicio ))
    # Una sesion que aguanto un rato prueba que el usuario es el bueno; una que
    # cae al instante es un rechazo de autenticacion.
    if [[ $duro -ge 10 ]]; then
      [[ -z "$usuario_ok" ]] && log "usuario '$u' aceptado; me quedo con el"
      usuario_ok="$u"
      log "sesion caida tras ${duro}s; reconecto en ${BDS_TAIL_RETRY_SECONDS}s"
      sleep "$BDS_TAIL_RETRY_SECONDS"
    fi
  done
  [[ -z "$usuario_ok" ]] && {
    log "ningun usuario acepto la consola ($BEDROCK_SSH_USERS); reintento en ${BDS_TAIL_RETRY_SECONDS}s"
    sleep "$BDS_TAIL_RETRY_SECONDS"
  }
done
