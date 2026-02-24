from typing import Optional, List
from app.utils.security import verify_password, get_password_hash, create_access_token
from app.schema.user import UserCreate, User
from app.utils.supabase import get_supabase_service_client, get_supabase_client

class AuthService:
    @staticmethod
    def authenticate_user(username: str, password: str) -> Optional[User]:
        """认证用户 - 使用 Supabase Auth 验证密码"""
        # 使用 Supabase 客户端验证用户名和密码
        sb = get_supabase_client()
        if not sb:
            return None
        
        try:
            # 调用 Supabase Auth 验证登录凭据
            auth_response = sb.auth.sign_in_with_password({
                "email": username,
                "password": password
            })
            
            if not auth_response.user:
                return None
            
            # 验证成功后，从 profiles 表获取用户完整信息
            service_sb = get_supabase_service_client()
            if service_sb:
                user_res = service_sb.table("profiles").select("*").eq("id", auth_response.user.id).execute()
                if user_res.data:
                    return User(**user_res.data[0])
            
            # 如果 profiles 表没有记录，使用 auth 用户基本信息
            return User(
                id=auth_response.user.id,
                username=auth_response.user.email or username,
                role="user",
                plan="free",
                quota_used=0,
                quota_total=10
            )
        except Exception as e:
            # 登录失败（密码错误或用户不存在）
            return None

    @staticmethod
    def register_new_user(user_in: UserCreate) -> Optional[User]:
        """注册用户 - 使用 Supabase"""
        sb = get_supabase_service_client()
        if not sb:
            return None
        
        try:
            # Check if user exists
            existing = sb.table("profiles").select("id").eq("username", user_in.username).execute()
            if existing.data:
                return None
            
            # Create user in Supabase
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
            return None
        except Exception:
            return None
