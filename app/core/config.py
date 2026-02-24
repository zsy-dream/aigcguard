from pydantic_settings import BaseSettings, SettingsConfigDict
import os
import secrets
from typing import List

from dotenv import load_dotenv

# 强制从项目根目录加载 .env（确保无论从哪里启动都能读到配置）
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
env_path = os.path.join(PROJECT_ROOT, ".env")
load_dotenv(dotenv_path=env_path)

class Settings(BaseSettings):
    PROJECT_NAME: str = "AIGC 数字内容指纹嵌入与侵权全网监测平台"
    API_V1_STR: str = "/api"
    model_config = SettingsConfigDict(case_sensitive=True, env_parse_delimiter=",")
    
    # SECURITY: SECRET_KEY 必须从环境变量读取，无默认值
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days
    ALGORITHM: str = "HS256"
    
    # AI Config
    DEEPSEEK_API_KEY: str = os.environ.get("DEEPSEEK_API_KEY", "")
    
    # Supabase Config
    SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    
    # CORS - 从环境变量读取，逗号分隔多个域名（在 app/main.py 中 split 解析，避免 pydantic 解析 List 时在某些平台报错）
    BACKEND_CORS_ORIGINS: str = os.environ.get(
        "BACKEND_CORS_ORIGINS",
        "http://localhost,http://localhost:5173,http://127.0.0.1:5173,http://localhost:8888",
    )

settings = Settings()

# 启动时校验 SECRET_KEY
if not settings.SECRET_KEY:
    debug_flag = os.environ.get("DEBUG", "").strip().lower()
    env_flag = os.environ.get("ENVIRONMENT", "").strip().lower()
    is_debug = debug_flag in {"1", "true", "yes", "y", "on"}
    is_production = env_flag in {"prod", "production"}

    # 本地/测试环境：允许自动生成临时 SECRET_KEY（仅当前进程有效）
    if is_debug or not is_production:
        settings.SECRET_KEY = f"dev-{secrets.token_hex(32)}"
        os.environ["SECRET_KEY"] = settings.SECRET_KEY
    else:
        raise ValueError("SECRET_KEY 环境变量必须设置！请执行: export SECRET_KEY=$(openssl rand -hex 32)")
