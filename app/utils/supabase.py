from supabase import create_client, Client
from app.core.config import settings
import logging

logger = logging.getLogger("app")

# ---- 单例缓存：避免每次调用都重新创建 Supabase 客户端 ----
_cached_client: Client = None
_cached_service_client: Client = None


def get_supabase_client() -> Client:
    """Initialize and return Supabase client (singleton)"""
    global _cached_client
    if _cached_client is not None:
        return _cached_client

    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        logger.warning("Supabase credentials missing in environment variables.")
        return None
    try:
        _cached_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        return _cached_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")
        return None


def get_supabase_service_client() -> Client:
    """Initialize and return Supabase service client (singleton, bypass RLS).
    If service role key is missing, fall back to default key.
    """
    global _cached_service_client
    if _cached_service_client is not None:
        return _cached_service_client

    url = settings.SUPABASE_URL
    key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
    
    if not url or not key:
        logger.warning("Supabase credentials missing in environment variables.")
        return None
        
    try:
        if not settings.SUPABASE_SERVICE_ROLE_KEY:
            logger.warning("SUPABASE_SERVICE_ROLE_KEY missing, falling back to SUPABASE_KEY.")
        _cached_service_client = create_client(url, key)
        return _cached_service_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase service client: {e}")
        return None
