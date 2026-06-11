# 本机转发小工具（让网站能调用内网模型）

在线网站 <https://wscjoel.github.io/eval-platform/> 是公网 HTTPS 页面，**浏览器出于安全限制无法直接调用内网的 HTTP 模型网关**（Mixed Content + 跨域 CORS）。这个小工具跑在你自己电脑上做一次转发，就能让网站正常评测。它只是无状态转发，**不保存任何数据**，你的数据集和结果依旧只存在你的浏览器本地。

## 怎么用（一次配置，长期有效）

### 前提
- 电脑在京东内网（能访问内网网关）
- 装了 Python 3（命令行输入 `python --version` 或 `python3 --version` 能显示版本即可；没有的话装一个）

### 步骤

1. 启动转发：
   - **Windows**：双击 `启动转发-Windows.bat`
   - **Mac**：双击 `启动转发-Mac.command`（首次若被拦，去「系统设置 → 隐私与安全性」点允许）
   - 或命令行：`python proxy.py`
2. 看到 “转发代理已启动” 即成功，**保持这个黑窗口开着**。
3. 打开网站 → 顶部「设置」→ 点「填入本地代理地址」按钮（或手动填）：
   ```
   http://127.0.0.1:8787/v1/chat/completions
   ```
4. 填好 API Key，正常用即可。用完关掉窗口就停。

## 网关地址不是默认的怎么办？

代理默认转发到 `http://llm-gw.jd.local`。如果你的真实网关不是这个地址，启动时指定：

```bash
# Mac / Linux
TARGET=http://真实网关地址 python3 proxy.py

# Windows（命令行）
set TARGET=http://真实网关地址 && python proxy.py
```

或直接编辑 `proxy.py` 顶部的 `TARGET`。端口也可用 `PORT` 改（同时记得改网站里填的端口）。

## 常见问题

- **网站里报“网络请求失败”**：八成是代理没启动，或窗口被关了。先确认黑窗口开着。
- **代理窗口报 502 转发失败**：你的电脑没连上内网网关，确认在内网、网关地址对。
- **Safari 仍被拦**：Safari 对 localhost 的豁免较严，建议用 Chrome / Edge。
