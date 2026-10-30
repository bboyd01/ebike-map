# Login service: password check (scrypt) + signed session cookies. No dependencies.
FROM node:22-alpine
WORKDIR /app
COPY password.mjs server.mjs hash-password.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "server.mjs"]
