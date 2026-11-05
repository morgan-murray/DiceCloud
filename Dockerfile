# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM ${NODE_IMAGE} AS toolchain
ARG METEOR_RELEASE=3.4.3
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git python3 make g++ bzip2 libfontconfig1 procps \
    && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /home/node
RUN curl --fail --silent --show-error --location "https://install.meteor.com/?release=${METEOR_RELEASE}" -o /tmp/install-meteor.sh \
    && sh /tmp/install-meteor.sh && rm /tmp/install-meteor.sh
ENV PATH="/home/node/.meteor:${PATH}"
WORKDIR /workspace/app

FROM toolchain AS build
ENV NODE_OPTIONS=--max-old-space-size=4096 RAYON_NUM_THREADS=4
COPY --chown=node:node app/ ./
RUN npm ci
RUN meteor build --directory /home/node/bundle --architecture os.linux.x86_64
WORKDIR /home/node/bundle/bundle/programs/server
COPY --chown=node:node deployment/bundle-package.json ./package.json
COPY --chown=node:node deployment/bundle-npm-shrinkwrap.json ./npm-shrinkwrap.json
RUN npm ci --omit=dev

FROM build AS test
WORKDIR /workspace/app
ENV TEST_CLIENT=0 MOCHA_TIMEOUT=10000
RUN npm run test:server

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
ENV NODE_ENV=production PORT=3000 BIND_IP=0.0.0.0 CONTAINER_VERSION=${SOURCE_REVISION}
WORKDIR /opt/dicecloud
COPY --from=build --chown=node:node /home/node/bundle/bundle/ ./
COPY --chown=node:node deployment/runtime-entrypoint.mjs ./deployment/
RUN mkdir -p /var/lib/dicecloud && chown node:node /var/lib/dicecloud
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deployment/runtime-entrypoint.mjs"]
