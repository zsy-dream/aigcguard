from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from jose import jwt
import os

from app.core.config import settings

router = APIRouter()

@router.get("/image/{filename}")
def get_image(
    filename: str,
    token: str = Query(...)
):
    # Auth Bridge: Support both local and Supabase tokens
    username = None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username = payload.get('sub')
    except Exception:
        try:
            from jose import jwt as jose_jwt
            unverified = jose_jwt.get_unverified_claims(token)
            username = unverified.get('email') or unverified.get('sub')
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    if not username:
        raise HTTPException(status_code=401, detail="Authentication identity missing")

    # 直接从文件系统读取文件，不再查本地数据库
    file_path = os.path.join("outputs", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_path)
