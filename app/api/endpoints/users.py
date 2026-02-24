from typing import Any, Annotated
from fastapi import APIRouter, Depends, HTTPException

from app.schema.user import User, UserCreate
from app.api.deps import get_current_active_user
from app.utils.supabase import get_supabase_service_client

router = APIRouter()

@router.post("/register", response_model=User)
def register_user(user_in: UserCreate):
    """用户注册 - 使用 Supabase Auth"""
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    try:
        # Check if user already exists
        existing = sb.table("profiles").select("id").eq("username", user_in.username).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail="该用户名已存在")
        
        # Create user in Supabase Auth (Note: actual auth signup should be done via frontend)
        # Here we just create the profile record
        from datetime import datetime, timezone
        result = sb.table("profiles").insert({
            "username": user_in.username,
            "display_name": user_in.display_name or user_in.username.split('@')[0],
            "role": "user",
            "plan": "free",
            "quota_total": 10,
            "quota_used": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        
        if result.data:
            return User(**result.data[0])
        else:
            raise HTTPException(status_code=500, detail="创建用户失败")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"注册失败: {str(e)}")

@router.get("/users/me", response_model=User)
def read_user_me(
    current_user: Annotated[User, Depends(get_current_active_user)]
) -> Any:
    return current_user
