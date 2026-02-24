from datetime import datetime, timedelta
from typing import Optional, Union, Any
from jose import jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Support legacy SHA256 hash if needed, but primarily use bcrypt
    # If the hash doesn't look like bcrypt (e.g. no $2b$), we might need legacy check
    # For now, let's assume we are migrating to bcrypt.
    # Check if hashed_password is the custom SHA256 format from original code
    import hashlib
    def _legacy_hash(pwd: str) -> str:
        return hashlib.sha256(f"aigc_salt_{pwd}".encode()).hexdigest()
    
    if len(hashed_password) == 64 and "$" not in hashed_password:
        return _legacy_hash(plain_password) == hashed_password

    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)
