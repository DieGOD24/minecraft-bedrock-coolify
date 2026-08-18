FROM alpine:3.22.5

# Cliente de MinIO, versión fijada (binario Go estático, corre en musl).
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG TARGETARCH=amd64

RUN apk add --no-cache bash tar gzip curl ca-certificates tzdata coreutils findutils \
 && curl -fsSL "https://dl.min.io/client/mc/release/linux-${TARGETARCH}/archive/mc.${MC_RELEASE}" \
      -o /usr/local/bin/mc \
 && chmod +x /usr/local/bin/mc \
 && mc --version

COPY backup.sh /usr/local/bin/backup.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh

# mc escribe su config aquí; sin HOME definido en algunos runtimes se va a /
ENV HOME=/root

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
