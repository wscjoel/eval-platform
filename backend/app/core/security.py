"""密码哈希与会话 token（无额外依赖：pbkdf2 + HMAC 签名）。"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

_PBKDF2_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    """返回格式：pbkdf2$<iterations>$<salt_hex>$<hash_hex>"""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iter_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iter_s)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


def create_token(user_id: int, secret: str, ttl_s: int) -> str:
    """token 格式：<user_id>.<expires_ts>.<hmac_sha256_hex>"""
    expires = int(time.time()) + ttl_s
    payload = f"{user_id}.{expires}"
    sig = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_token(token: str | None, secret: str) -> int | None:
    """校验 token，返回 user_id；无效/过期返回 None。"""
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    user_id_s, expires_s, sig = parts
    payload = f"{user_id_s}.{expires_s}"
    expected = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        if int(expires_s) < time.time():
            return None
        return int(user_id_s)
    except ValueError:
        return None
