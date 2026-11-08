# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM python:3.13.18-slim-bookworm@sha256:a5a7017efc5969e00ae2b91c8eb0631049a569652aa4ffc4501769049ae45c72 AS aurora-python
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
ENV TEST_CLIENT=0 MOCHA_TIMEOUT=30000 AURORA_PYTHON=/usr/bin/python3 AURORA_IMPORTER_PATH=/workspace/importer/worker.py
COPY --chown=node:node importer/ /workspace/importer/
RUN cd /workspace/importer && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
RUN npm run test:server

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=${SOURCE_REVISION}
ENV NODE_ENV=production PORT=3000 BIND_IP=0.0.0.0 CONTAINER_VERSION=${SOURCE_REVISION}
WORKDIR /opt/dicecloud
COPY --from=aurora-python /usr/local/ /usr/local/
RUN ldconfig
COPY --chown=node:node importer/ ./importer/
COPY --from=build --chown=node:node /home/node/bundle/bundle/ ./
COPY --chown=node:node deployment/runtime-entrypoint.mjs deployment/healthcheck.mjs ./deployment/
COPY --chown=node:node app/imports/api/utility/urlPaths.mjs ./deployment/
RUN node -e 'const sharp = require("./programs/server/npm/node_modules/sharp"); if (!sharp.versions.vips) throw new Error("Native image decoder missing")'
RUN mkdir -p /var/lib/dicecloud && chown node:node /var/lib/dicecloud
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD node deployment/healthcheck.mjs
CMD ["node", "deployment/runtime-entrypoint.mjs"]
