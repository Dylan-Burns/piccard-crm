FROM node:22-alpine AS web
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html ./
COPY src ./src
RUN npm run build
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY --from=web /app/dist ./dist
ENV PORT=8000
CMD ["sh","-c","uvicorn server.main:app --host 0.0.0.0 --port ${PORT}"]
