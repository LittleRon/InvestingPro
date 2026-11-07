#!/usr/bin/env bash
# Read-only diagnosis for "git pull only works right after a reboot".
#
#   bash diagnose-git-network.sh > /tmp/net-now.txt 2>&1
#
# Run it TWICE and compare: once while git pull is failing, once immediately
# after a reboot (when it works). The difference is the cause.
#   diff -u /tmp/net-good.txt /tmp/net-bad.txt
#
# Nothing here changes system state. sudo is optional (only for dmesg).
set -u
say() { printf '\n===== %s =====\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
show() { # label, command...
  local label="$1"; shift
  printf '\n-- %s\n' "$label"
  if have "$1"; then "$@" 2>&1 | head -25 || true
  else echo "(command not available: $1)"; fi
}

say "0. WHEN (is this really a reboot effect?)"
date -Is
have uptime && uptime
printf 'boot time: '; uptime -s 2>/dev/null || cat /proc/stat | grep btime
printf '\nHow long since boot matters: if pull fails only after hours of uptime,\n'
printf 'it is state accumulation (conntrack / sockets / DNS cache), not GitHub itself.\n'

say "1. DNS: what IP does github.com resolve to?"
show "getent ahosts (all)" getent ahosts github.com
show "getent ahostsv4" getent ahostsv4 github.com
show "getent ahostsv6" getent ahostsv6 github.com
if have dig; then show "dig A" dig +short A github.com; show "dig AAAA" dig +short AAAA github.com; fi
if have nslookup; then show "nslookup" nslookup github.com; fi
if [ -f /etc/resolv.conf ]; then show "/etc/resolv.conf" cat /etc/resolv.conf; else echo "(no /etc/resolv.conf)"; fi
if have resolvectl; then show "resolvectl status" resolvectl status; fi
printf '\nIf only AAAA is reachable-ish, or the IPv4 differs between the two runs,\n'
printf 'a stale/poisoned DNS cache is the cause. Flush: sudo resolvectl flush-caches\n'

say "2. Can we actually connect on 443? (IPv4 vs IPv6 vs default)"
if have curl; then
  for flag in -4 -6 ""; do
    printf '\n-- curl %s https://github.com (connect-timeout 8s)\n' "${flag:-default}"
    # shellcheck disable=SC2086
    curl $flag -sS -o /dev/null --connect-timeout 8 --max-time 12 \
      -w 'http=%{http_code} connect=%{time_connect}s total=%{time_total}s ip=%{remote_ip}\n' \
      https://github.com 2>&1 || true
  done
else
  echo "curl not installed"
fi
printf '\nIf -6 hangs but -4 works: IPv6 blackhole. Fix with /etc/gai.conf preferring IPv4,\n'
printf 'or sysctl -w net.ipv6.conf.all.disable_ipv6=1 (test first).\n'

say "3. conntrack table (this app makes MANY outbound connections)"
for f in /proc/sys/net/netfilter/nf_conntrack_count /proc/sys/net/netfilter/nf_conntrack_max; do
  if [ -f "$f" ]; then printf '%s = ' "$f"; cat "$f"; fi
done
have sysctl && show "conntrack sysctl" sysctl net.netfilter.nf_conntrack_count net.netfilter.nf_conntrack_max
show "conntrack full messages in kernel log" bash -c "dmesg -T 2>/dev/null | grep -iE 'conntrack.*(full|dropp)|nf_conntrack: table full' | tail -15"
printf '\nIf count is near max, or the kernel log says "table full, dropping packet":\n'
printf 'this is the cause. Reboot clears the table, which is why pull works afterwards.\n'

say "4. Socket / ephemeral port exhaustion"
have ss && show "ss -s" ss -s
have ss && show "TIME_WAIT count" bash -c "ss -tan state time-wait | wc -l"
have sysctl && show "ephemeral port range" sysctl net.ipv4.ip_local_port_range
have sysctl && show "tw_reuse" sysctl net.ipv4.tcp_tw_reuse

say "5. Proxy settings (a dead local proxy causes a long timeout, not a rejection)"
printf '\n-- proxy env vars\n'; env | grep -iE '^(http|https|all|no)_proxy=' || echo "(none)"
printf '\n-- git proxy config\n'; git config --show-origin --get-regexp 'http\..*proxy|url\..*insteadOf' 2>/dev/null || echo "(none)"
printf '\n-- EGRESS_PROXY_URL in .env\n'; grep -E '^EGRESS_PROXY_URL=' .env 2>/dev/null || echo "(not set / no .env here)"
printf '\n-- local proxy ports listening\n'
have ss && ss -lntp 2>/dev/null | grep -E ':(7890|1080|10809|8080|1087|20171)\b' || echo "(no common proxy port listening)"
printf '\nIf a proxy is configured but nothing listens on that port, git waits ~130s then\n'
printf 'fails exactly like: Failed to connect ... after 133993 ms.\n'

say "6. Other state that a reboot clears"
show "OOM / killed processes" bash -c "dmesg -T 2>/dev/null | grep -iE 'out of memory|killed process|oom' | tail -10"
show "route" bash -c "ip route 2>/dev/null || route -n"
show "remote" git remote -v
show "load / memory" free -m

say "WHAT TO COMPARE"
printf 'good (right after reboot) vs bad (when pull hangs):\n'
printf '  - different github.com IP      -> DNS cache / pollution\n'
printf '  - -6 fails, -4 succeeds       -> IPv6 blackhole\n'
printf '  - conntrack count near max    -> table full; the crawler filled it\n'
printf '  - proxy set but port closed   -> dead proxy\n'
printf '  - everything identical        -> GitHub reachability is simply intermittent\n'
printf '\nRegardless of the cause: this server does NOT need GitHub at runtime.\n'
printf 'Use the offline bundle / offline-fix-all.sh instead of ssh+git pull.\n'
