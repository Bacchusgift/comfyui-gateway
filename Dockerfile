# ========== 阶段 1：构建前端 ==========
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ========== 阶段 2：运行网关 ==========
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
# 依赖
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# 后端代码
COPY app/ ./app/
# 前端构建产物
COPY --from=frontend /app/frontend/dist ./frontend/dist
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
