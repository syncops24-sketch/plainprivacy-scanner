FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
# Network isolation, CPU/memory limits and metadata/private-network egress blocking
# MUST be enforced by the deployment platform. See README.md.
CMD ["npm", "start"]
