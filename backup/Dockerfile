# OJO: el contexto de build es la RAIZ del repo (ver docker-compose.yml), para
# poder copiar addons/ ademas de los scripts.
FROM alpine:3.22.5

# Cliente de MinIO, version fijada (binario Go estatico, corre en musl).
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG TARGETARCH=amd64

RUN apk add --no-cache \
      bash tar gzip curl ca-certificates tzdata coreutils findutils \
      openssh-client sshpass unzip jq \
 && curl -fsSL "https://dl.min.io/client/mc/release/linux-${TARGETARCH}/archive/mc.${MC_RELEASE}" \
      -o /usr/local/bin/mc \
 && chmod +x /usr/local/bin/mc \
 && mc --version

COPY backup/lib-console.sh \
     backup/backup.sh \
     backup/entrypoint.sh \
     backup/console-ssh.sh \
     backup/install-addons.sh \
     backup/fix-permissions.sh \
     /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh \
             /usr/local/bin/entrypoint.sh \
             /usr/local/bin/console-ssh.sh \
             /usr/local/bin/install-addons.sh \
             /usr/local/bin/fix-permissions.sh

COPY addons/ /addons/

# mc escribe su config aqui; sin HOME definido en algunos runtimes se va a /
ENV HOME=/root

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
