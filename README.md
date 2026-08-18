# Minecraft Bedrock en Coolify — versión fijada

Servidor **Minecraft Bedrock Dedicated Server** desplegado en Coolify, corriendo la
versión oficial de Mojang pero **fijada en este repo**, no auto-actualizada.

Este repo es la única fuente de verdad del servidor: versión, configuración y backups.

| | |
|---|---|
| **Conectar** | `31.97.218.221` puerto `19132` |
| **Versión fijada** | ver `VERSION` en [`docker-compose.yml`](docker-compose.yml) |
| **Backups** | diarios a MinIO, bucket `minecraft-backups`, retención 14 días |

---

## Por qué está fijada la versión

`VERSION=LATEST` hace que el contenedor baje la última versión **en cada reinicio**.
Un reinicio cualquiera podría meterte una actualización que rompa el mundo, los addons
o la compatibilidad con los clientes de tus jugadores, sin que nadie lo decidiera.

Peor: **actualizar Bedrock migra el formato del mundo y no se puede revertir**.
Bajar la versión después de que el mundo migró no funciona; hay que restaurar un backup.

Por eso el pin. La actualización es un commit que revisas y mergeas.

## Cómo se mantiene sincronizada con la versión real

La GitHub Action [`check-bedrock-version`](.github/workflows/check-bedrock-version.yml)
corre a diario y consulta el endpoint oficial de Mojang:

```
https://net.web.minecraft-services.net/api/v1.0/download/links
```

(el mismo que usa internamente la imagen de `itzg`). Si la versión oficial difiere del
pin, abre un **PR** que sube el pin. No mergea sola.

**Antes de mergear un PR de versión:**

1. Backup manual — no es opcional, la migración del mundo es irreversible:
   ```
   docker exec $(docker ps -qf name=backup) /usr/local/bin/backup.sh
   ```
2. Confirmar que tus jugadores ya tienen el cliente actualizado. Un server más nuevo
   que el cliente **rechaza la conexión**.

Al mergear a `main`, el workflow `deploy` redespliega en Coolify (si los secrets están puestos).

---

## Estructura

```
docker-compose.yml                        el pin + toda la config del server
backup/
  Dockerfile                              alpine + cliente mc (versión fijada)
  entrypoint.sh                           bucle de respaldo
  backup.sh                               save hold -> tar -> save resume -> MinIO
.github/workflows/
  check-bedrock-version.yml               chequeo diario contra Mojang -> PR
  deploy.yml                              push a main -> deploy en Coolify
```

## Configuración del server

Todo se controla con variables de entorno en `docker-compose.yml`; la imagen genera
`server.properties` a partir de ellas. No edites `server.properties` a mano dentro del
contenedor: se sobreescribe en cada arranque y el cambio no queda versionado.

### Poner admins

```yaml
OPS: "TuGamertag,OtroGamertag"
```
La imagen resuelve los gamertags a XUID sola y genera `permissions.json`.

### Allowlist

**BDS trae `allow-list=true` por defecto.** Por eso `docker-compose.yml` lleva
`ALLOW_LIST: "false"` explícito. Si se quita esa línea, el servidor arranca con la
allowlist activa y vacía y rechaza a todo el mundo con *"no estás invitado a jugar en
este servidor"* — aunque nunca hayas configurado una allowlist. Dejar `ALLOW_LIST_USERS`
comentado **no** basta: la imagen solo apaga la allowlist si esa variable existe.

Hoy el servidor está **abierto**: cualquiera con la IP y el puerto entra. Una IP pública
con Bedrock la encuentran los escáneres en cuestión de horas. Para cerrarlo:

```yaml
ALLOW_LIST_USERS: "Gamertag1,Gamertag2"
```

Con eso la imagen genera `allowlist.json` y pone `allow-list=true` sola, ignorando el
`ALLOW_LIST: "false"`. Commit + deploy.

### Verificar la config efectiva sin entrar al servidor

`server.properties` viaja dentro de cada backup, así que se puede auditar desde MinIO
sin tocar el contenedor — útil porque la API de Coolify no expone los logs del
contenedor `bedrock`, solo los del sidecar:

```python
import boto3, botocore, tarfile, io
s3 = boto3.client("s3", endpoint_url=MINIO_ENDPOINT,
                  aws_access_key_id=KEY, aws_secret_access_key=SECRET,
                  config=botocore.config.Config(signature_version="s3v4"))
o = sorted(s3.list_objects_v2(Bucket="minecraft-backups", Prefix="bedrock/")["Contents"],
           key=lambda x: x["LastModified"])[-1]
tf = tarfile.open(fileobj=io.BytesIO(s3.get_object(Bucket="minecraft-backups", Key=o["Key"])["Body"].read()))
print(tf.extractfile("server.properties").read().decode())
```

---

## Backups

El sidecar `backup` comparte el volumen y el **PID namespace** del servidor. Eso le
permite mandar `save hold` / `save resume` a la consola de BDS para sacar un snapshot
consistente del LevelDB **sin parar el servidor** y **sin montar `/var/run/docker.sock`**
(que le daría control total del host a un contenedor de un stack expuesto a internet).

Ciclo: `save hold` → esperar flush → `tar` de `worlds/` + configs → `save resume` →
subir a MinIO → borrar lo más viejo que `RETENTION_DAYS`.

Si el sidecar no logra alcanzar la consola, **igual hace el backup** pero deja un
`WARNING` explícito en los logs. Una degradación silenciosa sería peor que ninguna.

### Variables (se setean en Coolify, no en este repo)

| Variable | Default | |
|---|---|---|
| `MINIO_ENDPOINT` | — | URL S3 de MinIO |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | — | credenciales |
| `MINIO_BUCKET` | `minecraft-backups` | |
| `RETENTION_DAYS` | `14` | |
| `BACKUP_INTERVAL_SECONDS` | `86400` | cada cuánto respalda |
| `BACKUP_INITIAL_DELAY_SECONDS` | `300` | espera inicial al arrancar |

### Backup manual

```
docker exec $(docker ps -qf name=backup) /usr/local/bin/backup.sh
```

### Restaurar

```bash
# 1. bajar el snapshot desde MinIO
mc cp minio/minecraft-backups/bedrock/bedrock-<TIMESTAMP>.tar.gz .

# 2. parar el server desde Coolify (importante: BDS no debe estar escribiendo)

# 3. restaurar dentro del volumen
docker run --rm -v <stack>_bedrock-data:/data -v "$PWD":/restore alpine \
  sh -c 'cd /data && rm -rf worlds && tar -xzf /restore/bedrock-<TIMESTAMP>.tar.gz'

# 4. arrancar el server desde Coolify
```

---

## Despliegue en Coolify

Aplicación tipo **Docker Compose** apuntando a este repo.

Dos cosas que no son obvias y rompen el server si se cambian:

- **Sin dominio.** Bedrock es UDP y Traefik no enruta UDP. La app va con
  `autogenerate_domain: false`; Coolify respeta el `ports:` del compose y publica
  19132/udp directo en el host, saltándose el proxy.
- **`pid: "service:bedrock"`** en el sidecar de backup. Si Coolify lo descarta al
  parsear el compose, los backups pasan a modo "en caliente" (con warning en los logs).
  El fallback es activar *Raw Compose Deployment* en la app y redesplegar.

---

## Referencias

- Imagen: [itzg/docker-minecraft-bedrock-server](https://github.com/itzg/docker-minecraft-bedrock-server)
- Descargas oficiales: `https://net.web.minecraft-services.net/api/v1.0/download/links`
