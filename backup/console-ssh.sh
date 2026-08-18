#!/bin/bash
# Ejecuta un comando en la consola de BDS por SSH y DEVUELVE su salida.
#
# Por que existe, si ya hay send_console(): aquel canal escribe en el stdin del
# proceso (/proc/<pid>/fd/0) y por tanto es de una sola via. La salida de BDS va
# al stdout de SU contenedor, y la API de Coolify solo devuelve los logs del
# contenedor creado mas recientemente -- que por `pid: service:bedrock` siempre
# es el sidecar, nunca el servidor. Sin SSH no hay forma de LEER la respuesta de
# un comando como `list`.
#
# Uso: console-ssh.sh "list" [segundos_de_espera]
set -uo pipefail

: "${RCON_PASSWORD:?falta RCON_PASSWORD}"
: "${BEDROCK_SSH_HOST:=bedrock}"
: "${BEDROCK_SSH_PORT:=2222}"
: "${BEDROCK_SSH_USERS:=root minecraft bedrock console}"

CMD="${1:?falta el comando}"
READ_WAIT="${2:-4}"
TIMEOUT=$(( READ_WAIT + 16 ))

ssh_try() {
  local user="$1"
  # El sleep mantiene stdin abierto tras mandar el comando: sin el, la sesion se
  # cierra antes de que BDS escriba la respuesta y solo se captura el eco.
  { printf '%s\n' "$CMD"; sleep "$READ_WAIT"; } |
    timeout "$TIMEOUT" sshpass -p "$RCON_PASSWORD" ssh -tt -q \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      -o LogLevel=ERROR \
      -p "$BEDROCK_SSH_PORT" "${user}@${BEDROCK_SSH_HOST}" 2>&1
}

# El usuario que acepta mc-server-runner no esta documentado, asi que se prueban
# varios y se reporta cual funciono en vez de asumir uno.
for u in $BEDROCK_SSH_USERS; do
  out=$(ssh_try "$u"); rc=$?
  if [[ $rc -eq 0 && -n "$out" ]]; then
    echo "### consola OK (usuario '$u')"
    printf '%s\n' "$out"
    exit 0
  fi
done
echo "### no se pudo abrir la consola SSH con ninguno de: $BEDROCK_SSH_USERS" >&2
exit 1
