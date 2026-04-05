FROM node:20-alpine

WORKDIR /app

# Install poppler-utils for PDF to image conversion (test ballot generation)
RUN apk add --no-cache poppler-utils

# Install server dependencies
COPY server/package.json server/package-lock.json* server/
RUN cd server && npm install

# Install client dependencies
COPY client/package.json client/package-lock.json* client/
RUN cd client && npm install

# Copy source (volumes override in dev)
COPY server/ server/
COPY client/ client/
COPY agent/ agent/

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3000 5173

# Start both server and client dev server
CMD sh -c "cd /app/server && npm run dev & cd /app/client && npm run dev & wait"
