FROM node:20-alpine

WORKDIR /app

# Copy everything
COPY . .

# Install root dependencies and build React frontend
RUN npm ci
RUN npm run build

# Install server dependencies
WORKDIR /app/server
RUN npm install

# Copy public folder to server
RUN cp -r ../public .

WORKDIR /app

# Start the server
CMD ["node", "server/index.js"]
