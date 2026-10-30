# BRouter routing server with the ebike profile. See docs/SPEC.md §2, §11.
#
# The engine comes prebuilt from upstream's published image (ghcr.io/abrensch/brouter),
# pinned by digest: compiling it with Gradle is too heavy for a small VPS. Upstream's
# release-tag images stop at v1.7.8, which predates lookup table v11, so this pins a
# `master` build. routing/lookups.dat (v11.2, from BRouter v1.7.10) is vendored so the
# profile and lookup table always match.
FROM ghcr.io/abrensch/brouter@sha256:dd4987e5b949160a3e7a4b9dae9e56d6751454ad7fbaab6b629027ea48422078 AS upstream

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl \
 && mkdir -p /opt/brouter/profiles2 /opt/brouter/customprofiles /segments4
COPY --from=upstream /app/brouter.jar /opt/brouter/brouter.jar
COPY lookups.dat ebike.brf /opt/brouter/profiles2/
COPY entrypoint.sh /opt/brouter/entrypoint.sh

ENV JAVA_OPTS="-Xmx384m -Xms64m -XX:+UseSerialGC" \
    SEGMENT_TILE=W90_N40 \
    MAX_THREADS=2
EXPOSE 17777
VOLUME /segments4
ENTRYPOINT ["/bin/sh", "/opt/brouter/entrypoint.sh"]
