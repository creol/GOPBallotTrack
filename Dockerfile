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

# Copy agent files and install dependencies (served to station laptops for download)
COPY agent/package.json agent/package-lock.json* agent/
RUN cd agent && npm install --omit=dev
COPY agent/ agent/

# Copy station installer template
COPY station-install.bat station-install.bat

# Download Windows x64 node.exe (served to station laptops)
RUN wget -q -O /app/node-win.exe https://nodejs.org/dist/v20.18.1/win-x64/node.exe

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 3000 5173

# Start both server and client dev server
CMD sh -c "cd /app/server && npm run dev & cd /app/client && npm run dev & wait"
