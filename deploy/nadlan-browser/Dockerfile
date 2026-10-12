FROM node:24-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PORT=8000
WORKDIR /app/deploy/nadlan-browser
COPY deploy/nadlan-browser/package*.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
COPY --chown=node:node deploy/nadlan-browser/*.mjs ./
USER node
EXPOSE 8000
CMD ["node", "server.mjs"]
