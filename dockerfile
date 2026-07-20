# Lightweight Node image
FROM node:18-alpine

# Working directory
WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy the remaining files
COPY . .

# Port used by the proxy
ENV HOST=0.0.0.0 \
    DT_PROXY_CONFIG=/data/config.json
VOLUME ["/data"]
EXPOSE 3001

# Start the server
CMD ["node", "server.js"]
