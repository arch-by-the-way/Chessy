FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# dependencies are cached unless package*.json is changed
COPY ../package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

#server path relative to server/
COPY server.js ./ 

USER node
EXPOSE 8080
CMD ["node", "server.js"]