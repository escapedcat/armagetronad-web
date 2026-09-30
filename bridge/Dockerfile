# The relay as deployed. Built from bridge/ as the context:
#   fly deploy            (from bridge/, using fly.toml beside this file)
#   docker build -t aa-bridge .
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY frame.mjs policy.mjs limits.mjs relay.mjs ./
# Listen publicly INSIDE the container; the platform's proxy is what faces the
# internet and terminates TLS. relay.mjs refuses this host without a
# BRIDGE_TOKEN, which is supplied as a secret, never baked into the image.
ENV BRIDGE_HOST=0.0.0.0 PORT=8080
EXPOSE 8080
USER node
CMD ["node", "relay.mjs"]
