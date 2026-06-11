"""鉴权依赖：从 Cookie 解析当前用户。"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import AUTH_COOKIE_NAME, SECRET_KEY
from .core.security import verify_token
from .db import get_session
from .models import User


def get_current_user(request: Request, db: Session = Depends(get_session)) -> User:
    token = request.cookies.get(AUTH_COOKIE_NAME)
    user_id = verify_token(token, SECRET_KEY)
    if user_id is None:
        raise HTTPException(401, "未登录或会话已过期")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "账号不存在或已禁用")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


def is_admin(user: User) -> bool:
    return user.role == "admin"


def ensure_owner(user: User, owner_id: int | None) -> None:
    """非管理员只能访问自己的数据。"""
    if user.role != "admin" and owner_id != user.id:
        raise HTTPException(403, "无权访问该数据")
