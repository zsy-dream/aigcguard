# AIGC 数字内容指纹嵌入与侵权全网监测平台 V2.0

## 🚀 项目概述

打造"生成即确权，发布即监测"的全链路保护系统。本项目包含基于 FastAPI 的高性能后端与现代化的 React 前端界面。

## 🛠️ 技术架构

### 后端 (Backend)
- **框架**: FastAPI (高性能异步)
- **数据库**: SQLite (轻量级)
- **核心算法**: DCT/DWT 数字水印, pHash 图像指纹
- **架构模式**: 分层架构 (API, Service, Repository)

### 前端 (Frontend)
- **框架**: React + TypeScript + Vite
- **UI 设计**: Modern Glassmorphism (毛玻璃特效) + Neon Aesthetics (赛博朋克风)
- **动画**: Framer Motion

## 📂 项目结构

```
root/
├── app/                    # 后端应用
│   ├── api/               # API 路由
│   ├── core/              # 核心配置
│   ├── services/          # 业务逻辑
│   ├── repository/        # 数据访问
│   └── main.py            # 入口文件
├── web_app/               # 前端应用
│   ├── src/               # 源代码
│   └── public/            # 静态资源
├── start.bat              # 后端启动脚本
└── requirements.txt       # Python 依赖
```

## ⚡ 快速启动

### 方式 1: 自动启动 (推荐)
运行根目录下的 `start.bat` 启动后端，并手动进入 `web_app` 启动前端。

### 方式 2: 手动启动

**后端 Server** (Port: 8000)
```bash
# Windows
start.bat

# Linux/Mac
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**前端 Client** (Port: 5173)
```bash
cd web_app
npm install
npm run dev
```

## 🔗 访问地址

- **前端页面**: http://localhost:5173
- **后端 API**: http://localhost:8000/docs
- **知识库预览**: http://localhost:8000/outputs

## ✨ 核心功能

1.  **态势感知 Dashboard**: 实时监控全网数据指纹状态。
2.  **数字指纹嵌入**: 强鲁棒性水印嵌入，支持作者署名。
3.  **全网侵权监测**: 模拟全网搜索，识别盗版与侵权行为。
4.  **区块链证据固化**: 存证记录不可篡改 (模拟实现)。

## 📝 开发日志

- **2026-02-20**: 重构后端为 FastAPI 分层架构，升级前端为 React + Glassmorphism UI。

---
**Powered by PIONEER工作室**
