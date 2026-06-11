"""登录 / 登出 / 当前用户 / 修改密码。"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import AUTH_COOKIE_NAME, AUTH_TOKEN_TTL_S, SECRET_KEY
from ..core.security import create_token, hash_password, verify_password
from ..db import get_session
from ..deps import get_current_user
from ..models import LoginRecord, User
from ..schemas import ChangePasswordRequest, LoginRequest, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


@router.post("/login", response_model=UserOut)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_session),
):
    username = payload.username.strip()
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()

    ok = bool(user) and user.is_active and verify_password(payload.password, user.password_hash)
    db.add(
        LoginRecord(
            user_id=user.id if user else None,
            username=username,
            success=ok,
            ip=_client_ip(request),
            user_agent=(request.headers.get("user-agent") or "")[:512],
        )
    )
    if not ok:
        db.commit()
        if user and not user.is_active:
            raise HTTPException(403, "账号已被禁用，请联系管理员")
        raise HTTPException(401, "用户名或密码错误")

    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    token = create_token(user.id, SECRET_KEY, AUTH_TOKEN_TTL_S)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=AUTH_TOKEN_TTL_S,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return UserOut.model_validate(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
):
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(400, "原密码不正确")
    user.password_hash = hash_password(payload.new_password)
    db.add(user)
    db.commit()
    return {"ok": True}
