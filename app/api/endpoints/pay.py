from fastapi import APIRouter, Depends, HTTPException, Request, Form, Header
from typing import Optional, Dict, Any
from app.api.deps import get_current_user
from alipay import AliPay
import os
import uuid
from dotenv import load_dotenv
import httpx
from jose import jwt as jose_jwt

router = APIRouter()


def _get_frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def _get_backend_url() -> str:
    return os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/")


def _get_alipay_gateway() -> str:
    return os.environ.get(
        "ALIPAY_GATEWAY",
        "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
    ).rstrip("?").rstrip("/")


def _get_alipay_debug() -> bool:
    v = os.environ.get("ALIPAY_DEBUG", "").strip().lower()
    if v in {"1", "true", "yes", "y", "on"}:
        return True
    if v in {"0", "false", "no", "n", "off"}:
        return False
    # Backwards-compatible default: current project is configured for sandbox.
    return True


def _apply_subscription_upgrade(
    *,
    sb,
    username: str,
    plan: str,
    period: str,
) -> None:
    from datetime import datetime, timedelta, timezone

    user_res = sb.table("profiles").select(
        "id, quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total, subscription_status, subscription_expires_at"
    ).eq("username", username).limit(1).execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")

    user_row = user_res.data[0]
    user_id = user_row.get("id")
    if not user_id:
        raise HTTPException(status_code=500, detail="Invalid user profile")

    embed_quota_map = {"free": 50, "personal": 500, "pro": 2000, "enterprise": 9999999}
    detect_quota_map = {"free": 20, "personal": 200, "pro": 1000, "enterprise": 9999999}
    quota_map = {"free": 10, "personal": 500, "pro": 2000, "enterprise": 9999999}
    if plan not in quota_map:
        raise HTTPException(status_code=400, detail="Invalid plan")

    now = datetime.now(timezone.utc)
    prev_expires = _parse_iso_datetime(user_row.get("subscription_expires_at"))
    prev_status = user_row.get("subscription_status")
    base_time = now
    if prev_expires and prev_status == "active" and prev_expires > now:
        base_time = prev_expires

    effective_period = period if period in ["month", "year"] else "month"
    new_expires = base_time + (timedelta(days=30) if effective_period == "month" else timedelta(days=365))

    update_data = {
        "plan": plan,
        "quota_total": int(quota_map.get(plan) or 10),
        "quota_used": int(user_row.get("quota_used") or 0),
        "quota_embed_total": int(embed_quota_map.get(plan) or 50),
        "quota_embed_used": int(user_row.get("quota_embed_used") or 0),
        "quota_detect_total": int(detect_quota_map.get(plan) or 20),
        "quota_detect_used": int(user_row.get("quota_detect_used") or 0),
        "subscription_period": effective_period,
        "subscription_status": "active",
        "subscription_started_at": now.isoformat(),
        "subscription_expires_at": new_expires.isoformat(),
    }

    sb.table("profiles").update(update_data).eq("id", user_id).execute()


def _parse_iso_datetime(val: Optional[str]):
    if not val:
        return None
    try:
        from datetime import datetime, timezone

        s = str(val).strip()
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


async def _get_verified_user_id_from_authorization(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization[len("Bearer ") :].strip()
    if not token:
        return None

    # 1) Try local JWT (platform issued)
    try:
        from app.core.config import settings

        payload = jose_jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        sub = payload.get("sub")
        if sub:
            return str(sub)
    except Exception:
        pass

    # 2) Try Supabase: validate token server-side via /auth/v1/user
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not supabase_url:
        return None

    # Prefer anon key; service role would also work but should not be required.
    api_key = os.environ.get("SUPABASE_KEY", "") or os.environ.get("SUPABASE_ANON_KEY", "")
    if not api_key:
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                f"{supabase_url}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": api_key,
                },
            )
            if res.status_code != 200:
                return None
            data = res.json()
            uid = data.get("id")
            if uid:
                return str(uid)
    except Exception:
        return None

    return None


def get_alipay() -> AliPay:
    # 强制动态加载 .env 环境变量（避免因启动顺序导致变量没吃进去）
    load_dotenv()
    
    ALIPAY_APP_ID = os.environ.get("ALIPAY_APP_ID", "")
    ALIPAY_PRIVATE_KEY = os.environ.get("ALIPAY_PRIVATE_KEY", "").replace("\\n", "\n")
    ALIPAY_PUBLIC_KEY = os.environ.get("ALIPAY_PUBLIC_KEY", "").replace("\\n", "\n")
    if not ALIPAY_PUBLIC_KEY:
        ALIPAY_PUBLIC_KEY = os.environ.get("ALIPAY_PUBLIC_KEY", "").replace("\\n", "\n")

    # 支付初始化：如果密钥为空，抛出提示让开发者配置
    if not ALIPAY_APP_ID or not ALIPAY_PRIVATE_KEY or not ALIPAY_PUBLIC_KEY:
        raise ValueError(
            f"请先配置支付宝环境参数(已检: APPID={ALIPAY_APP_ID != ''}, 私钥={ALIPAY_PRIVATE_KEY != ''}, 公钥={ALIPAY_PUBLIC_KEY != ''})"
        )

    # 包装私钥格式
    full_private_key = ALIPAY_PRIVATE_KEY
    if "-----BEGIN RSA PRIVATE KEY-----" not in full_private_key:
        full_private_key = f"-----BEGIN RSA PRIVATE KEY-----\n{full_private_key}\n-----END RSA PRIVATE KEY-----"
    
    full_public_key = ALIPAY_PUBLIC_KEY
    if "-----BEGIN PUBLIC KEY-----" not in full_public_key:
        full_public_key = f"-----BEGIN PUBLIC KEY-----\n{full_public_key}\n-----END PUBLIC KEY-----"

    return AliPay(
        appid=ALIPAY_APP_ID,
        app_notify_url=None,  # 默认回调 URL
        app_private_key_string=full_private_key,
        alipay_public_key_string=full_public_key,
        sign_type="RSA2",
        debug=_get_alipay_debug(),
    )

@router.post("/alipay-create")
async def create_alipay_order(
    plan: str = Form(...),
    period: str = Form(...),  # 'month' 或 'year'
    username: str = Form(...)
):
    """
    创建支付宝沙箱支付订单，支持月付/年付，生成跳转链接
    """
    # 月付价格
    monthly_prices = {
        "personal": 19.00,
        "pro": 99.00,
        "enterprise": 299.00
    }
    # 年付折扣价（约85折）
    yearly_prices = {
        "personal": 199.00,      # 原价 19*12=228，折扣后 199
        "pro": 999.00,           # 原价 99*12=1188，折扣后 999
        "enterprise": 2999.00    # 原价 299*12=3588，折扣后 2999
    }
    
    if plan not in monthly_prices:
        raise HTTPException(status_code=400, detail="未知的订阅套餐")
    
    if period not in ['month', 'year']:
        raise HTTPException(status_code=400, detail="订阅周期必须是 'month'(月付) 或 'year'(年付)")
    
    # 计算价格
    total_amount = monthly_prices[plan] if period == 'month' else yearly_prices[plan]

    try:
        alipay = get_alipay()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    out_trade_no = f"{username}_{plan}_{period}_{uuid.uuid4().hex[:8]}"
    period_text = "月付" if period == 'month' else "年付"

    # 调用支付宝接口生成支付链接
    backend_url = _get_backend_url()
    order_string = alipay.api_alipay_trade_page_pay(
        out_trade_no=out_trade_no,
        total_amount=total_amount,
        subject=f"AIGC Guard - {plan.upper()} 计划 ({period_text})",
        return_url=f"{backend_url}/api/pay/alipay-return",
        notify_url=f"{backend_url}/api/pay/alipay-notify",
    )

    gateway = _get_alipay_gateway()
    payment_url = f"{gateway}?" + order_string
    
    return {
        "payment_url": payment_url,
        "out_trade_no": out_trade_no,
        "plan": plan,
        "period": period,
        "total_amount": total_amount
    }


@router.get("/alipay-return")
async def alipay_return(request: Request):
    """支付宝同步回跳：验签成功后给用户发货（写 Supabase profiles）。

    说明：
    - 沙箱的 page pay 回跳会带 sign/sign_type/out_trade_no 等参数。
    - 这里必须验签，否则前端拼个 URL 就能“假成功”。
    - 验签成功后，再按 out_trade_no 解析 username/plan/period，更新订阅（顺延、不清零用量）。
    """
    from fastapi.responses import RedirectResponse
    frontend_url = _get_frontend_url()

    params = dict(request.query_params)
    sign = params.pop("sign", None)
    params.pop("sign_type", None)
    out_trade_no = params.get("out_trade_no")

    if not sign or not out_trade_no:
        # 缺关键字段，直接回前端失败
        return RedirectResponse(url=f"{frontend_url}/pricing?pay=fail&reason=missing_params")

    try:
        alipay = get_alipay()
        ok = alipay.verify(params, sign)
        if not ok:
            return RedirectResponse(url=f"{frontend_url}/pricing?pay=fail&reason=bad_sign")

        # out_trade_no 格式: {username}_{plan}_{period}_{rand}
        # 注意：username 可能包含 '_'，因此必须从右侧拆分
        parts = out_trade_no.rsplit("_", 3)
        if len(parts) != 4:
            return RedirectResponse(url=f"{frontend_url}/pricing?pay=fail&reason=bad_out_trade_no")

        username = parts[0]
        plan = parts[1]
        period = parts[2]
        if period not in ["month", "year"]:
            period = "month"

        from app.utils.supabase import get_supabase_service_client

        sb = get_supabase_service_client()
        if not sb:
            return RedirectResponse(url=f"{frontend_url}/pricing?pay=fail&reason=no_supabase")

        _apply_subscription_upgrade(sb=sb, username=username, plan=plan, period=period)
        return RedirectResponse(url=f"{frontend_url}/pricing?pay=success&plan={plan}&period={period}&out_trade_no={out_trade_no}")
    except Exception:
        return RedirectResponse(url=f"{frontend_url}/pricing?pay=fail&reason=exception")


@router.post("/renew")
async def renew_subscription(
    period: str = Form(...),
    x_sync_secret: Optional[str] = Header(None, alias="X-Sync-Secret"),
    authorization: Optional[str] = Header(None),
):
    """用户自助续费（月/年），严格以 Supabase profiles 为准。

    - 仅允许：内部密钥续费，或登录用户给自己续费。
    - 不重置 quota_used / quota_embed_used / quota_detect_used。
    - 若当前订阅未到期，则在原到期时间基础上顺延；否则从现在开始。
    """
    if period not in ['month', 'year']:
        raise HTTPException(status_code=400, detail="period must be 'month' or 'year'")

    configured_secret = os.environ.get("SYNC_QUOTA_SECRET", "")
    secret_ok = bool(configured_secret) and x_sync_secret == configured_secret

    authed_uid: Optional[str] = None
    if not secret_ok:
        authed_uid = await _get_verified_user_id_from_authorization(authorization)
        if not authed_uid:
            raise HTTPException(status_code=403, detail="renew is protected. Login required.")

    try:
        from app.utils.supabase import get_supabase_service_client
        from datetime import datetime, timedelta, timezone

        sb = get_supabase_service_client()
        if not sb:
            raise HTTPException(status_code=500, detail="Supabase service client not configured")

        user_id = authed_uid
        if secret_ok and not user_id:
            raise HTTPException(status_code=400, detail="Missing user identity")

        # 读取当前订阅信息
        prof_res = sb.table("profiles").select(
            "id, plan, subscription_status, subscription_period, subscription_expires_at, quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total"
        ).eq("id", user_id).limit(1).execute()
        if not prof_res.data:
            raise HTTPException(status_code=404, detail="User profile not found")

        row = prof_res.data[0]
        plan = (row.get('plan') or 'free')
        if plan == 'free':
            raise HTTPException(status_code=400, detail="Free plan cannot renew. Please upgrade first.")

        now = datetime.now(timezone.utc)
        prev_expires = _parse_iso_datetime(row.get('subscription_expires_at'))
        prev_status = row.get('subscription_status')

        base_time = now
        if prev_expires and prev_status == 'active' and prev_expires > now:
            base_time = prev_expires

        new_expires = base_time + (timedelta(days=30) if period == 'month' else timedelta(days=365))

        update_data = {
            "subscription_status": "active",
            "subscription_period": period,
            "subscription_started_at": now.isoformat(),
            "subscription_expires_at": new_expires.isoformat(),
            # 保持额度用量不变（以 Supabase 为准）
            "quota_used": int(row.get('quota_used') or 0),
            "quota_embed_used": int(row.get('quota_embed_used') or 0),
            "quota_detect_used": int(row.get('quota_detect_used') or 0),
        }

        res = sb.table("profiles").update(update_data).eq("id", user_id).execute()
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to renew subscription")

        return {"success": True, "user": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/alipay-notify")
async def alipay_notify(request: Request):
    try:
        data = dict(await request.form())
        sign = data.pop("sign", None)
        data.pop("sign_type", None)
        out_trade_no = data.get("out_trade_no")
        trade_status = data.get("trade_status")

        if not sign or not out_trade_no:
            return "fail"

        alipay = get_alipay()
        ok = alipay.verify(data, sign)
        if not ok:
            return "fail"

        if trade_status not in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
            return "success"

        # out_trade_no 格式: {username}_{plan}_{period}_{rand}
        # 注意：username 可能包含 '_'，因此必须从右侧拆分
        parts = out_trade_no.rsplit("_", 3)
        if len(parts) != 4:
            return "success"

        username = parts[0]
        plan = parts[1]
        period = parts[2]

        from app.utils.supabase import get_supabase_service_client

        sb = get_supabase_service_client()
        if not sb:
            return "fail"

        _apply_subscription_upgrade(sb=sb, username=username, plan=plan, period=period)
        return "success"
    except Exception:
        return "fail"

@router.post("/sync-quota")
async def sync_quota(
    username: str = Form(...),
    plan: str = Form(...),
    subscription_period: Optional[str] = Form(None),  # 'month' 或 'year'
    x_sync_secret: Optional[str] = Header(None, alias="X-Sync-Secret"),
    authorization: Optional[str] = Header(None),
):
    """
    同步接口：支付成功后，直接更新 Supabase 用户额度和订阅信息。
    仅支持4类权限：free/personal/pro/enterprise
    """
    # --- 安全保护：必须满足 (1) 内部密钥 或 (2) 已登录且只能给自己发货 ---
    configured_secret = os.environ.get("SYNC_QUOTA_SECRET", "")
    secret_ok = bool(configured_secret) and x_sync_secret == configured_secret

    authed_uid: Optional[str] = None
    if not secret_ok:
        # 允许已登录用户自助发货：只能给自己账号升级，禁止给他人发货
        authed_uid = await _get_verified_user_id_from_authorization(authorization)
        if not authed_uid:
            raise HTTPException(status_code=403, detail="sync-quota is protected. Provide X-Sync-Secret or login to upgrade yourself.")

    # 校验权限类型（仅4类）
    valid_plans = {"free": 10, "personal": 500, "pro": 2000, "enterprise": 9999999}
    if plan not in valid_plans:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {plan}. Must be one of: {list(valid_plans.keys())}")
    
    # 自动映射配额
    quota_total = valid_plans[plan]
    
    try:
        from app.utils.supabase import get_supabase_service_client
        sb = get_supabase_service_client()
        if not sb:
            raise HTTPException(status_code=500, detail="Supabase service client not configured")
        
        # 确定发货目标用户：
        # - 内部密钥：允许按 username 发货
        # - 已登录：只能给自己 uid 发货，并校验 uid 对应 profiles.username == username
        if secret_ok:
            user_res = sb.table("profiles").select("id").eq("username", username).execute()
            if not user_res.data:
                raise HTTPException(status_code=404, detail="User not found in Supabase")
            user_id = user_res.data[0]["id"]
        else:
            user_id = authed_uid
            profile_res = sb.table("profiles").select("username").eq("id", user_id).limit(1).execute()
            if not profile_res.data:
                raise HTTPException(status_code=404, detail="User profile not found")
            profile_username = profile_res.data[0].get("username")
            if profile_username != username:
                raise HTTPException(status_code=403, detail="Forbidden: cannot upgrade other user")
        
        # 计算订阅到期时间
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        embed_quota_map = {"free": 50, "personal": 500, "pro": 2000, "enterprise": 9999999}
        detect_quota_map = {"free": 20, "personal": 200, "pro": 1000, "enterprise": 9999999}

        # 读取现有用量，避免 sync 覆盖导致 used 清零
        existing_res = sb.table("profiles").select(
            "quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total, subscription_status, subscription_expires_at"
        ).eq("id", user_id).limit(1).execute()
        existing_row = existing_res.data[0] if existing_res and existing_res.data else {}

        existing_quota_used = int(existing_row.get("quota_used") or 0)
        existing_quota_embed_used = int(existing_row.get("quota_embed_used") or 0)
        existing_quota_detect_used = int(existing_row.get("quota_detect_used") or 0)

        update_data = {
            "plan": plan,
            # 兼容旧字段
            "quota_total": quota_total,
            "quota_used": existing_quota_used,
            # 新字段：分开限制嵌入/检测
            "quota_embed_total": embed_quota_map.get(plan, 50),
            "quota_embed_used": existing_quota_embed_used,
            "quota_detect_total": detect_quota_map.get(plan, 20),
            "quota_detect_used": existing_quota_detect_used,
        }
        
        effective_period = subscription_period
        if plan != 'free' and effective_period not in ['month', 'year']:
            effective_period = 'month'

        # 如果有订阅周期，设置订阅信息（支付发货：从当前有效到期时间基础上顺延，避免覆盖剩余天数）
        if effective_period in ['month', 'year'] and plan != 'free':
            base_time = now
            prev_expires = _parse_iso_datetime(existing_row.get('subscription_expires_at'))
            prev_status = existing_row.get('subscription_status')
            if prev_expires and prev_status == 'active' and prev_expires > now:
                base_time = prev_expires
            update_data["subscription_period"] = effective_period
            update_data["subscription_status"] = 'active'
            update_data["subscription_started_at"] = now.isoformat()
            if effective_period == 'month':
                update_data["subscription_expires_at"] = (base_time + timedelta(days=30)).isoformat()
            else:  # year
                update_data["subscription_expires_at"] = (base_time + timedelta(days=365)).isoformat()
        elif plan == 'free':
            update_data["subscription_period"] = None
            update_data["subscription_status"] = 'inactive'
            update_data["subscription_started_at"] = None
            update_data["subscription_expires_at"] = None
        
        # 更新用户套餐和额度
        res = sb.table("profiles").update(update_data).eq("id", user_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to update user plan")
        
        return {
            "success": True, 
            "message": f"User upgraded to {plan} ({subscription_period or 'one-time'})",
            "user": res.data[0]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
