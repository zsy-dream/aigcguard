from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from datetime import datetime

from app.core.config import settings
from app.api.endpoints import auth, users, watermark, pay, admin
from app.service.task_queue import start_task_queue, stop_task_queue

# Ensure directories exist
os.makedirs("outputs", exist_ok=True)
os.makedirs("uploads", exist_ok=True)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    description="AIGC Content Protection Platform (Supabase Cloud Version)",
    version="1.0.0",
)

# CORS
cors_origins = [
    origin.strip()
    for origin in (settings.BACKEND_CORS_ORIGINS or "").split(",")
    if origin.strip()
]

if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Routers
app.include_router(auth.router, prefix=settings.API_V1_STR, tags=["auth"])
app.include_router(users.router, prefix=settings.API_V1_STR, tags=["users"])
app.include_router(watermark.router, prefix=settings.API_V1_STR, tags=["watermark"])
app.include_router(pay.router, prefix=settings.API_V1_STR + "/pay", tags=["pay"])
app.include_router(admin.router, prefix=settings.API_V1_STR + "/admin", tags=["admin"])

# Health Check Endpoint for UptimeRobot
@app.get("/health")
async def health_check():
    """健康检查端点，用于UptimeRobot监控"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "aigc-copyright-api"
    }

# Static Files
# app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# 启动事件：启动任务队列
@app.on_event("startup")
async def startup_event():
    await start_task_queue()
    
# 关闭事件：停止任务队列
@app.on_event("shutdown")
async def shutdown_event():
    await stop_task_queue()

# Frontend
if os.path.exists("web_app/dist"):
    app.mount("/", StaticFiles(directory="web_app/dist", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
