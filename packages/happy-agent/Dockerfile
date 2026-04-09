# Happy Agent - Docker containerized daemon for Auto Pilot
FROM node:20-alpine

# Install yarn globally
RUN npm install -g yarn@1.22.22

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN yarn build

# Create non-root user for security
RUN addgroup -g 1001 -S happy && \
    adduser -u 1001 -S happy -G happy && \
    mkdir -p /home/happy/.happy-next && \
    chown -R happy:happy /app

USER happy

# Default to running the agent
CMD ["yarn", "start"]
