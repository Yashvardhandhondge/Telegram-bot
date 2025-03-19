FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache python3 make g++ tzdata

# Set timezone
ENV TZ=UTC

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies
RUN npm ci

# Bundle app source
COPY . .

# Create necessary directories
RUN mkdir -p tmp/sessions/user tmp/sessions/pnl_bot src/config

# Make sure pnl-mapping.json exists
RUN if [ ! -f "./src/config/pnl-mapping.json" ]; then \
    echo '{"signalSources":{"-1002404846297/5":"-1002404846297/178"}}' > ./src/config/pnl-mapping.json; \
    fi

# Set proper permissions
RUN chmod -R 755 /app

EXPOSE 3000

CMD [ "npm", "run", "run:listener" ]