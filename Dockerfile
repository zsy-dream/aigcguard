FROM python:3.11-slim-bookworm

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libgl1 \
    libglib2.0-0 \
    fontconfig \
    fonts-noto-cjk \
    fonts-wqy-microhei \
    fonts-wqy-zenhei \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-freefont-ttf \
    locales \
    && rm -rf /var/lib/apt/lists/*

# 刷新字体缓存，避免 PDF 中文渲染为方块
RUN fc-cache -f

# 复制依赖文件
COPY requirements.prod.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.prod.txt

# 复制项目文件
COPY . .

# 暴露端口
EXPOSE 8000

# 默认命令
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
