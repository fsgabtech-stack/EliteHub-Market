FROM node:24-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencias AS compilacao
COPY tsconfig.json eslint.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS execucao
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=compilacao /app/dist ./dist
COPY --from=compilacao /app/src/db/migrations ./dist/db/migrations
COPY static ./static
EXPOSE 8000
USER node
CMD ["node", "dist/server.js"]
