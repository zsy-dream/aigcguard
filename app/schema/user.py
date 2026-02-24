from pydantic import BaseModel
from typing import Optional

class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str
    display_name: Optional[str] = None

class User(UserBase):
    id: str
    role: str
    display_name: Optional[str] = None
    plan: str = "free"
    quota_used: int = 0
    quota_total: int = 10
    quota_embed_used: Optional[int] = None
    quota_embed_total: Optional[int] = None
    quota_detect_used: Optional[int] = None
    quota_detect_total: Optional[int] = None
    subscription_status: Optional[str] = None
    subscription_period: Optional[str] = None
    subscription_started_at: Optional[str] = None
    subscription_expires_at: Optional[str] = None
    remaining_days: Optional[int] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True
