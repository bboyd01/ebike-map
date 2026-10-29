# BRouter routing server with the ebike profile. See docs/SPEC.md §2, §11.
# Built from source at a pinned release tag (same steps as upstream's Dockerfile).
FROM gradle:jdk17-jammy AS build
ARG BROUTER_TAG=v1.7.10
RUN command -v git >/dev/null || (apt-get update && apt-get install -y --no-install-recommends git)
RUN git clone --depth 1 --branch "$BROUTER_TAG" https://github.com/abrensch/brouter /src
WORKDIR /src
# Use the project's Gradle wrapper (pins the Gradle version BRouter expects).
RUN ./gradlew :brouter-server:fatJar --no-daemon -q \
 && cp brouter-server/build/libs/brouter-*-all.jar /brouter.jar

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl \
 && mkdir -p /opt/brouter/profiles2 /opt/brouter/customprofiles /segments4
COPY --from=build /brouter.jar /opt/brouter/brouter.jar
COPY --from=build /src/misc/profiles2/lookups.dat /opt/brouter/profiles2/lookups.dat
COPY ebike.brf /opt/brouter/profiles2/ebike.brf
COPY entrypoint.sh /opt/brouter/entrypoint.sh

ENV JAVA_OPTS="-Xmx384m -Xms64m -XX:+UseSerialGC" \
    SEGMENT_TILE=W90_N40 \
    MAX_THREADS=2
EXPOSE 17777
VOLUME /segments4
ENTRYPOINT ["/bin/sh", "/opt/brouter/entrypoint.sh"]
