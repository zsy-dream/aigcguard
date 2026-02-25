from datetime import timedelta
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from starlette.responses import RedirectResponse
import httpx

from app.core.config import settings
from app.schema.token import Token
from app.service.auth import AuthService
from app.utils.security import create_access_token

router = APIRouter()


@router.get("/verify")
async def proxy_supabase_verify(request: Request):
    """Proxy Supabase email verification to avoid users directly visiting *.supabase.co in restrictive networks.

    Expected query params (same as Supabase): token, type, redirect_to.
    """
    if not settings.SUPABASE_URL:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured")

    verify_url = settings.SUPABASE_URL.rstrip("/") + "/auth/v1/verify"

    params = dict(request.query_params)

    headers = {}
    if settings.SUPABASE_KEY:
        headers = {
            "apikey": settings.SUPABASE_KEY,
            "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        }

    async with httpx.AsyncClient(follow_redirects=False, timeout=20.0) as client:
        resp = await client.get(verify_url, params=params, headers=headers)

    location = resp.headers.get("location") or resp.headers.get("Location")
    if location:
        return RedirectResponse(url=location, status_code=302)

    # If Supabase doesn't redirect, pass through a meaningful error.
    raise HTTPException(status_code=resp.status_code, detail=resp.text or "Verification failed")


@router.get("/auth/verify")
async def proxy_supabase_verify_alias(request: Request):
    return await proxy_supabase_verify(request)

@router.post("/token", response_model=Token)
async def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    user = AuthService.authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        subject=user.username, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}
