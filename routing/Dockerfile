# BRouter routing server with the ebike profile. See docs/SPEC.md §2, §11.
FROM eclipse-temurin:21-jre-alpine

ARG BROUTER_VERSION=1.7.7
RUN apk add --no-cache curl unzip \
 && curl -fsSL -o /tmp/brouter.zip \
      "https://github.com/abrensch/brouter/releases/download/v${BROUTER_VERSION}/brouter-${BROUTER_VERSION}.zip" \
 && mkdir -p /opt/brouter && unzip -q /tmp/brouter.zip -d /tmp/brouter \
 && mv /tmp/brouter/*/brouter-*-all.jar /opt/brouter/brouter.jar \
 && mv /tmp/brouter/*/profiles2 /opt/brouter/profiles2 \
 && rm -rf /tmp/brouter /tmp/brouter.zip \
 && mkdir -p /opt/brouter/customprofiles /segments4

COPY ebike.brf /opt/brouter/profiles2/ebike.brf
COPY entrypoint.sh /opt/brouter/entrypoint.sh

ENV JAVA_OPTS="-Xmx384m -Xms64m -XX:+UseSerialGC" \
    SEGMENT_TILE=W90_N40 \
    MAX_THREADS=2
EXPOSE 17777
VOLUME /segments4
ENTRYPOINT ["/bin/sh", "/opt/brouter/entrypoint.sh"]
