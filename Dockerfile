FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/leads.sqlite

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
