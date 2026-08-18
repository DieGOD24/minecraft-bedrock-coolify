#!/bin/bash
# Ejecuta un comando en la consola de BDS por SSH y DEVUELVE su salida.
#
# Por que existe, si ya hay send_console(): aquel canal escribe en el stdin del
# proceso (/proc/<pid>/fd/0) y por tanto es de una sola via. La salida de BDS va
# al stdout de SU contenedor, y la API de Coolify solo devuelve los logs del
# contenedor creado mas recientemente -- que por culpa de `pid: service:bedrock`
# siempre es el sidecar, nunca el servidor. Sin SSH no hay forma de LEER una
# respuesta como la de `list`.
#
# Uso: console-ssh.sh "list"
set -uo pipefail

: "${RCON_PASSWORD:?falta RCON_PASSWORD}"
: "${BEDROCK_SSH_HOST:=bedrock}"
: "${BEDROCK_SSH_PORT:=2222}"
: "${BEDROCK_SSH_USERS:=root minecraft bedrock console}"

CMD="${1:?falta el comando}"
TIMEOUT="${2:-12}"

ssh_try() {
  local user="$1"
  printf '%s\n' "$CMD" | timeout "$TIMEOUT" sshpass -p "$RCON_PASSWORD" \
    ssh -tt -q \
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
  out=$(ssh_try "$u")
  rc=$?
  if [[ $rc -eq 0 && -n "$out" ]]; then
    echo "### consola OK (usuario '$u')"
    echo "$out"
    exit 0
  fi
  echo "### usuario '$u' fallo (rc=$rc): $(printf '%s' "$out" | head -2 | tr '\n' ' ')" >&2
done
echo "### no se pudo abrir la consola SSH con ninguno de: $BEDROCK_SSH_USERS" >&2
exit 1
