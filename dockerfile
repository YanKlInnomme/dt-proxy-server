# Image Node légère
FROM node:18-alpine

# Dossier de travail
WORKDIR /app

# Copier package.json
COPY package*.json ./

# Installer dépendances
RUN npm install --omit=dev

# Copier le reste
COPY . .

# Port utilisé par ton proxy
EXPOSE 3001

# Lancer le serveur
CMD ["node", "server.js"]