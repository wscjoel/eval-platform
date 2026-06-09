"""调用京东 LLM 网关（OpenAI Chat Completions 协议）。"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from ..config import LLM_GW_URL, LLM_MIN_INTERVAL_S


class LLMError(RuntimeError):
    def __init__(self, message: str, no_retry: bool = False):
        super().__init__(message)
        self.no_retry = no_retry


# 全局节流：保证任意两次网关请求的发起间隔 >= LLM_MIN_INTERVAL_S（平台限制 1s 1 次）。
# 每个任务由独立 asyncio.run 驱动（事件循环不同），故 Lock 按当前运行循环惰性重建，
# 避免 "Future attached to a different loop"；_last_dispatch 为纯时间戳，跨循环持久。
_rate_lock: asyncio.Lock | None = None
_rate_lock_loop: Any = None
_last_dispatch = 0.0


def _get_rate_lock() -> asyncio.Lock:
    global _rate_lock, _rate_lock_loop
    loop = asyncio.get_event_loop()
    if _rate_lock is None or _rate_lock_loop is not loop:
        _rate_lock = asyncio.Lock()
        _rate_lock_loop = loop
    return _rate_lock


async def _throttle(min_interval: float) -> None:
    global _last_dispatch
    async with _get_rate_lock():
        wait = _last_dispatch + min_interval - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_dispatch = time.monotonic()


def _build_payload(model: str, system_prompt: str, user_prompt: str, temperature: float) -> dict[str, Any]:
    """OpenAI Chat Completions 结构：messages = [system?, user]。
    
    部分模型（如 GPT-5.5-joybuilder）不支持自定义 temperature，只接受默认值 1。
    统一不在 payload 中发送 temperature 字段，让网关使用各模型默认值，避免 400 报错。
    """
    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})
    return {
        "model": model,
        "messages": messages,
        "stream": False,
    }


def _extract_text(data: Any) -> str:
    """解析 OpenAI Chat Completions 结构：choices[0].message.content。"""
    if isinstance(data, str):
        return data
    if not isinstance(data, dict):
        return str(data)

    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        ch = choices[0]
        if isinstance(ch, dict):
            msg = ch.get("message") or {}
            content = msg.get("content")
            if isinstance(content, str) and content.strip():
                return content

    return ""


async def call_llm(
    *,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.2,
    timeout: float = 60.0,
    max_retries: int = 2,
) -> tuple[str, int]:
    """返回 (文本输出, 耗时毫秒)。失败会自动重试，最终失败抛 LLMError。"""
    if not api_key:
        raise LLMError("Missing API key (set LLM_GW_API_KEY or pass api_key from UI)")

    payload = _build_payload(model, system_prompt, user_prompt, temperature)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    last_err: Exception | None = None
    for attempt in range(max_retries + 1):
        await _throttle(LLM_MIN_INTERVAL_S)
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(LLM_GW_URL, headers=headers, json=payload)
            elapsed_ms = int((time.perf_counter() - t0) * 1000)

            if resp.status_code >= 500:
                raise LLMError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            if 400 <= resp.status_code < 500:
                # 4xx 为客户端错误（参数非法、敏感词等），重试无意义，直接抛出不进重试循环
                raise LLMError(f"HTTP {resp.status_code}: {resp.text[:300]}", no_retry=True)
            if resp.status_code != 200:
                raise LLMError(f"HTTP {resp.status_code}: {resp.text[:300]}")

            try:
                data = resp.json()
            except Exception:
                return resp.text, elapsed_ms

            text = _extract_text(data)
            if not text:
                text = resp.text
            return text, elapsed_ms

        except (httpx.HTTPError, LLMError) as e:
            last_err = e
            # 4xx 不可重试，立即终止
            if isinstance(e, LLMError) and e.no_retry:
                break
            if attempt >= max_retries:
                break
            await asyncio.sleep(1.0 * (3 ** attempt))  # 1s, 3s

    raise LLMError(f"LLM call failed after retries: {last_err}")
