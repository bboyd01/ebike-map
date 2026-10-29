# Data refresh service: runs refresh.sh weekly via crond, and once at start if no data exists.
FROM node:22-alpine
ARG PMTILES_VERSION=1.31.2
ARG TARGETARCH
RUN apk add --no-cache curl osmium-tool coreutils \
 && arch=$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x86_64) \
 && curl -fsSL "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${arch}.tar.gz" \
    | tar -xz -C /usr/local/bin pmtiles
WORKDIR /app
COPY areas.env refresh.sh build-controls.mjs controls-format.mjs ./
# Mondays 09:17 UTC (off-peak for Chicago riders).
RUN echo '17 9 * * 1 /bin/sh /app/refresh.sh >> /proc/1/fd/1 2>&1' > /etc/crontabs/root
CMD ["/bin/sh", "-c", "[ -s /srv/data/manifest.json ] || /bin/sh /app/refresh.sh; exec crond -f -l 6"]
