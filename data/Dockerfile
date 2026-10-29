# Data refresh service: runs refresh.sh at start if no data exists, then weekly (schedule.sh).
# Debian base: osmium-tool is in Debian's main repository.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl osmium-tool \
 && rm -rf /var/lib/apt/lists/*

# pmtiles CLI. Release archives have been named both Linux_x86_64 (GoReleaser v1
# replacements) and linux_amd64 (v2 defaults), so try both.
ARG PMTILES_VERSION=1.31.2
ARG TARGETARCH
RUN set -e; \
    case "${TARGETARCH:-amd64}" in arm64) a1=arm64; a2=arm64 ;; *) a1=x86_64; a2=amd64 ;; esac; \
    base="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}"; \
    for f in "go-pmtiles_${PMTILES_VERSION}_Linux_${a1}.tar.gz" "go-pmtiles_${PMTILES_VERSION}_linux_${a2}.tar.gz"; do \
      echo "trying $base/$f"; \
      if curl -fsSL -o /tmp/pmtiles.tgz "$base/$f"; then break; fi; \
    done; \
    mkdir /tmp/pm && tar -xzf /tmp/pmtiles.tgz -C /tmp/pm \
 && install -m 0755 "$(find /tmp/pm -type f -name pmtiles | head -1)" /usr/local/bin/pmtiles \
 && rm -rf /tmp/pm /tmp/pmtiles.tgz \
 && pmtiles version

WORKDIR /app
COPY areas.env refresh.sh schedule.sh build-controls.mjs controls-format.mjs ./
CMD ["/bin/sh", "/app/schedule.sh"]
