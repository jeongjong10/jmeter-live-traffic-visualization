# 화면 빌드 단계: src/web → dist
FROM node:22-alpine AS web
WORKDIR /web
COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci
COPY src/web/ ./
RUN npm run build

# 실행 단계: collector(표준 라이브러리만 사용) + 빌드된 화면
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY --from=web /web/dist /app/web
COPY src/collector/ /app/collector/
EXPOSE 8765
CMD ["python3", "/app/collector/server.py"]
