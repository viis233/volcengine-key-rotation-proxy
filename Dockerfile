FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["npm", "start"]
