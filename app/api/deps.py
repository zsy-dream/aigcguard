from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from pydantic import ValidationError
from datetime import datetime, timezone

from app.core.config import settings
from app.schema.user import User
from app.schema.token import TokenData
from app.utils.supabase import get_supabase_service_client

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/login")


def _parse_iso_datetime(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    try:
        s = str(val).strip()
        # Support both 'Z' and '+00:00'
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _compute_remaining_days(expires_at: Optional[str]) -> Optional[int]:
    dt = _parse_iso_datetime(expires_at)
    if not dt:
        return None
    now = datetime.now(timezone.utc)
    delta_seconds = (dt - now).total_seconds()
    # ceil to days, but clamp at 0
    days = int((delta_seconds + 86400 - 1) // 86400)
    return max(days, 0)

async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    username = None
    email = None
    
    # 解析 Token 获取用户信息
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username = payload.get("sub")
    except (JWTError, ValidationError):
        # 尝试 Supabase Token 解析
        try:
            from jose import jwt as jose_jwt
            unverified = jose_jwt.get_unverified_claims(token)
            username = unverified.get('sub')
            email = unverified.get('email')
        except Exception as e:
            print(f"[Auth Error] Token parse failed: {e}")
            raise credentials_exception

    if not username:
        raise credentials_exception
    
    # 从 Supabase 获取用户完整信息 - 使用 id (UUID) 查询
    try:
        sb = get_supabase_service_client()
        if sb:
            # 使用 id (UUID) 查询 profiles 表
            res = sb.table("profiles").select("*").eq("id", username).execute()
            if res.data:
                user_data = res.data[0]

                def _safe_int(val, default: int = 0) -> int:
                    try:
                        if val is None:
                            return default
                        return int(val)
                    except Exception:
                        return default

                subscription_status = user_data.get("subscription_status")
                subscription_period = user_data.get("subscription_period")
                subscription_started_at = user_data.get("subscription_started_at")
                subscription_expires_at = user_data.get("subscription_expires_at")
                remaining_days = _compute_remaining_days(subscription_expires_at) if subscription_status == 'active' else None

                # Quota source of truth: prefer embed quota fields if present (new schema)
                quota_used = user_data.get("quota_used")
                quota_total = user_data.get("quota_total")
                if "quota_embed_used" in user_data or "quota_embed_total" in user_data:
                    quota_used = user_data.get("quota_embed_used", quota_used)
                    quota_total = user_data.get("quota_embed_total", quota_total)

                quota_used = _safe_int(quota_used, 0)
                quota_total = _safe_int(quota_total, 10)

                # Backfill: keep new quota fields aligned with legacy fields for migrated users.
                # Many older rows only updated quota_used/quota_total.
                try:
                    legacy_used = _safe_int(user_data.get("quota_used"), 0)
                    legacy_total = _safe_int(user_data.get("quota_total"), 10)
                    embed_used = _safe_int(user_data.get("quota_embed_used"), legacy_used)
                    embed_total = _safe_int(user_data.get("quota_embed_total"), legacy_total)
                    detect_used = _safe_int(user_data.get("quota_detect_used"), 0)
                    detect_total = _safe_int(user_data.get("quota_detect_total"), 20)

                    # If embed quota fields exist but are behind legacy, sync them forward.
                    if embed_used < legacy_used or embed_total != legacy_total:
                        sb.table("profiles").update({
                            "quota_embed_used": max(embed_used, legacy_used),
                            "quota_embed_total": embed_total,
                        }).eq("id", username).execute()

                    # If embed_used looks suspiciously low but assets exist, optionally backfill from assets count.
                    # This is a safe monotonic fix (never decreases used).
                    try:
                        assets_res = sb.table("watermarked_assets").select("id", count="exact").eq("user_id", username).execute()
                        assets_count = int(getattr(assets_res, "count", None) or 0)
                        if assets_count and max(embed_used, legacy_used) < assets_count:
                            sb.table("profiles").update({
                                "quota_embed_used": assets_count,
                                "quota_used": assets_count,
                            }).eq("id", username).execute()
                            embed_used = assets_count
                            legacy_used = assets_count
                    except Exception:
                        pass

                    quota_used = max(quota_used, legacy_used, embed_used)

                    # Ensure detect quota fields exist (for older rows) - do not overwrite non-null values.
                    if user_data.get("quota_detect_used") is None or user_data.get("quota_detect_total") is None:
                        sb.table("profiles").update({
                            "quota_detect_used": _safe_int(user_data.get("quota_detect_used"), 0),
                            "quota_detect_total": _safe_int(user_data.get("quota_detect_total"), 20),
                        }).eq("id", username).execute()
                        detect_used = _safe_int(user_data.get("quota_detect_used"), 0)
                        detect_total = _safe_int(user_data.get("quota_detect_total"), 20)
                except Exception:
                    pass

                # Auto-expire & downgrade
                if subscription_status == 'active' and remaining_days == 0 and subscription_expires_at:
                    try:
                        sb.table("profiles").update({
                            "plan": "free",
                            "subscription_status": "expired",
                        }).eq("id", username).execute()
                        user_data["plan"] = "free"
                        subscription_status = 'expired'
                    except Exception as e:
                        print(f"[Subscription] downgrade failed: {e}")

                return User(
                    id=user_data.get("id"),
                    username=user_data.get("username", email),
                    display_name=user_data.get("display_name"),
                    role=user_data.get("role", "user"),
                    plan=user_data.get("plan", "free"),
                    quota_used=quota_used,
                    quota_total=quota_total,
                    quota_embed_used=_safe_int(user_data.get("quota_embed_used"), None) if user_data.get("quota_embed_used") is not None else None,
                    quota_embed_total=_safe_int(user_data.get("quota_embed_total"), None) if user_data.get("quota_embed_total") is not None else None,
                    quota_detect_used=_safe_int(user_data.get("quota_detect_used"), 0),
                    quota_detect_total=_safe_int(user_data.get("quota_detect_total"), 20),
                    subscription_status=subscription_status,
                    subscription_period=subscription_period,
                    subscription_started_at=subscription_started_at,
                    subscription_expires_at=subscription_expires_at,
                    remaining_days=remaining_days,
                    created_at=user_data.get("created_at"),
                )
            else:
                # 记录不存在，自动创建
                # Role default to "user", but if it's admin@... give admin for testing if admin doesn't exist!
                role = "admin" if email and "admin" in email else "user"
                new_profile = {
                    "id": username,
                    "username": email or username,
                    "display_name": (email.split('@')[0] if email else username)[:20],
                    "role": role,
                    "plan": "free",
                    "quota_total": 50 if role == "admin" else 10,
                    "quota_used": 0,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                sb.table("profiles").insert(new_profile).execute()
                print(f"[Auth Auto-Create] Auto created profile for {email or username}")
                return User(**new_profile)
    except Exception as e:
        print(f"[Auth Error] Failed to fetch or create user from Supabase: {e}")
    
    # Fallback: 从 Token 元数据构建基础用户
    try:
        from jose import jwt as jose_jwt
        unverified = jose_jwt.get_unverified_claims(token)
        user_metadata = unverified.get('user_metadata', {})
        return User(
            id=unverified.get('sub'),
            username=email or username,
            display_name=user_metadata.get('display_name') or (email.split('@')[0] if email else 'User'),
            role='admin' if email and 'admin' in email else 'user',
            plan=user_metadata.get('plan', 'free'),
            quota_used=0,
            quota_total=10
        )
    except Exception:
        raise credentials_exception

async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user
