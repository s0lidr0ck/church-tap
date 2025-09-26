# Use the official Node.js 18 runtime as the base image
FROM node:18-alpine

# Install netcat for database health checks
RUN apk add --no-cache netcat-openbsd

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the CSS with timeout protection
RUN timeout 300 npm run build:css:once || echo "CSS build skipped (using pre-built)"

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Create uploads directory
RUN mkdir -p public/uploads

# Expose the port the app runs on
EXPOSE 3000

# Add a startup script that waits for database
COPY scripts/wait-for-db.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/wait-for-db.sh

# Start the application
CMD ["/usr/local/bin/wait-for-db.sh", "npm", "start"]