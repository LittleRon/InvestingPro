#!/usr/bin/env bash
# Offline fix for: /dashboard/allocation returning 500 on a hard reload, and the
# "立即编写今天" button staying permanently disabled ("检查登录状态…").
#
# Use this when `git pull` cannot reach GitHub from the server. It edits the two
# source files in place and is safe to re-run: already-fixed lines are skipped.
#
#   scp scripts/offline-fix-ssr.sh ubuntu@SERVER:~/InvestingPro/
#   cd ~/InvestingPro && bash offline-fix-ssr.sh
#   sudo docker compose up -d --build
#
set -euo pipefail
ROOT="${1:-.}"
A="$ROOT/modules/macro-dashboard/web/allocation.tsx"
B="$ROOT/modules/macro-dashboard/web/report-now.tsx"
for f in "$A" "$B"; do
  [ -f "$f" ] || { echo "找不到 $f —— 把项目根目录作为参数传进来：bash offline-fix-ssr.sh ~/InvestingPro"; exit 1; }
done

python3 - "$A" "$B" <<'PY'
import sys, pathlib

A, B = (pathlib.Path(p) for p in sys.argv[1:])

# (file, old, new, label). Each replacement is independent and idempotent.
EDITS = [
    (A,
     'import { useLoaderData } from "react-router";',
     'import { useLoaderData, useLocation } from "react-router";',
     "allocation.tsx: import useLocation"),
    (A,
     '  const loginLink = `/api/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;',
     '  // SSR has no window: read the current address from the router instead.\n'
     '  const { pathname, search } = useLocation();\n'
     '  const loginLink = `/api/auth/login?return=${encodeURIComponent(pathname + search)}`;',
     "allocation.tsx: login link (fixes the 500)"),
    (B,
     'import { useEffect, useState } from "react";\nimport type { CountryKey } from "../indicators.ts";',
     'import { useEffect, useState } from "react";\n'
     'import { useLocation } from "react-router";\n'
     'import type { CountryKey } from "../indicators.ts";',
     "report-now.tsx: import useLocation"),
    (B,
     '  const [message, setMessage] = useState("");',
     '  const [message, setMessage] = useState("");\n'
     '  const { pathname, search } = useLocation();\n'
     '  const loginLink = `/api/auth/login?return=${encodeURIComponent(pathname + search)}`;',
     "report-now.tsx: login link without window"),
    (B,
     'type Phase = "checking" | "not-admin" | "submitting" | "polling" | "done" | "timeout" | "error";',
     'type Phase = "checking" | "ready" | "not-admin" | "submitting" | "polling" | "done" | "timeout" | "error";',
     "report-now.tsx: add ready phase"),
    (B,
     '        const me = await res.json() as AdminMe;\n        setMessage(`以 ${me.name} 的身份提交`);',
     '        const me = await res.json() as AdminMe;\n'
     '        // Leave "checking": otherwise the button stays disabled forever.\n'
     '        setPhase("ready");\n'
     '        setMessage(`以 ${me.name} 的身份提交`);',
     "report-now.tsx: leave checking on success"),
    (B,
     '<a href={`/api/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`}',
     '<a href={loginLink}',
     "report-now.tsx: render-time window read"),
]

failed = []
for path, old, new, label in EDITS:
    text = path.read_text(encoding="utf-8")
    if new in text:
        print(f"  skip  {label} (already applied)")
        continue
    if old not in text:
        print(f"  MISS  {label} (source differs; needs a manual look)")
        failed.append(label)
        continue
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"  ok    {label}")

if failed:
    print("\n有 %d 处没匹配上：服务器上的源码版本和补丁预期不一致。" % len(failed))
    print("建议改用 git bundle 方式更新到最新提交（见说明），或把这几个文件的内容发回来。")
    sys.exit(2)
print("\n两个页面都改好了。接下来必须重建镜像：sudo docker compose up -d --build")
PY
