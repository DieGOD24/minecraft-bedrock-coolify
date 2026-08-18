#!/bin/bash
# Acceso a la consola de BDS desde el sidecar.
#
# Funciona porque el servicio declara `pid: "service:bedrock"`: al compartir el PID
# namespace, este contenedor ve el proceso bedrock_server y puede escribir en su
# stdin. Es la misma tecnica que usa bin/send-command dentro de la imagen de itzg,
# y evita tener que montar /var/run/docker.sock.

# Devuelve el directorio /proc/<pid> del proceso bedrock_server, o vacio.
find_bds_proc() {
  find /proc -mindepth 2 -maxdepth 2 -name exe \
    \( -lname '/data/bedrock_server-*' -o -lname /usr/local/bin/box64 \) \
    -printf '%h' -quit 2>/dev/null
}

# Envia un comando a la consola. $1 = comando. Devuelve !=0 si no se pudo.
send_console() {
  local proc
  proc=$(find_bds_proc)
  [[ -z "$proc" ]] && return 1
  echo "$1" > "$proc/fd/0" 2>/dev/null
}

# Espera hasta que el proceso de BDS exista. $1 = intentos (default 60, cada 5s).
wait_for_bds() {
  local intentos=${1:-60}
  for _ in $(seq 1 "$intentos"); do
    [[ -n "$(find_bds_proc)" ]] && return 0
    sleep 5
  done
  return 1
}
