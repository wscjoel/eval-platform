#!/usr/bin/env python3
"""极简本机转发代理：让浏览器（含 GitHub Pages 上的页面）能调用内网 LLM 网关。

为什么需要它
------------
浏览器无法直接调用内网 HTTP 网关，原因有二：
  1) Mixed Content：在线网站是 HTTPS，浏览器禁止它请求 http:// 的内网网关；
  2) CORS：内网网关一般不返回跨域响应头，浏览器会拦掉响应。
本代理跑在你本机 127.0.0.1，浏览器对 localhost 有 Mixed Content 豁免，
代理再把请求转发给内网网关，并补上 CORS 响应头，于是三道坎一次性解决。
代理只做无状态转发，不保存任何数据。

用法
----
直接运行（需要 Python 3，系统自带或公司装好即可，无需安装任何第三方库）：

    python proxy.py

默认监听 127.0.0.1:8787，转发到 http://llm-gw.jd.local。
如需修改，编辑下方 TARGET / PORT，或用环境变量：

    TARGET=http://你的网关地址  PORT=8787  python proxy.py

启动后在网站「设置」里把网关地址填成：

    http://127.0.0.1:8787/v1/chat/completions

保持窗口开着即可，关闭窗口或 Ctrl+C 即停止。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET = os.environ.get("TARGET", "http://llm-gw.jd.local").rstrip("/")
PORT = int(os.environ.get("PORT", "8787"))
TIMEOUT = float(os.environ.get("TIMEOUT", "120"))

# 仅透传这些请求头给网关，避免把浏览器的杂项头带过去污染请求
_FORWARD_REQ_HEADERS = ("authorization", "content-type", "accept")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self) -> None:  # noqa: N802 (CORS 预检)
        self.send_response(204)
        self._send_cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _write(self, status: int, data: bytes, content_type: str) -> None:
        self.send_response(status)
        self._send_cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _proxy(self) -> None:
        url = TARGET + self.path
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None

        req = urllib.request.Request(url, data=body, method=self.command)
        for key, val in self.headers.items():
            if key.lower() in _FORWARD_REQ_HEADERS:
                req.add_header(key, val)

        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "application/json")
                self._write(resp.status, data, ctype)
        except urllib.error.HTTPError as e:
            data = e.read() or str(e).encode("utf-8")
            ctype = e.headers.get("Content-Type", "application/json") if e.headers else "application/json"
            self._write(e.code, data, ctype)
        except Exception as e:  # noqa: BLE001  网络不通/超时等
            payload = json.dumps(
                {"error": f"转发到 {url} 失败: {e}", "hint": "请确认本机在内网、网关地址正确"},
                ensure_ascii=False,
            ).encode("utf-8")
            self._write(502, payload, "application/json")

    def do_GET(self) -> None:  # noqa: N802
        self._proxy()

    def do_POST(self) -> None:  # noqa: N802
        self._proxy()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[proxy] " + (fmt % args) + "\n")


def main() -> None:
    print("=" * 60)
    print(f"  转发代理已启动： http://127.0.0.1:{PORT}  →  {TARGET}")
    print("")
    print("  在网站「设置」里把网关地址填成：")
    print(f"      http://127.0.0.1:{PORT}/v1/chat/completions")
    print("")
    print("  保持本窗口开着即可。按 Ctrl+C 退出。")
    print("=" * 60)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
