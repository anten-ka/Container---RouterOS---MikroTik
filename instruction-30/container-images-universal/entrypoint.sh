#!/bin/sh
set -eu

# This image intentionally accepts only the supported raw-TCP VLESS subset.
# Validate every value before interpolating environment data into JSON.
: "${REMOTE_ADDRESS:?REMOTE_ADDRESS is required}"
: "${REMOTE_PORT:?REMOTE_PORT is required}"
: "${ID:?ID is required}"
: "${SERVER_NAME:?SERVER_NAME is required}"

case "$REMOTE_ADDRESS" in
  *[!A-Za-z0-9.-]*|'') echo "invalid REMOTE_ADDRESS" >&2; exit 64 ;;
esac
case "$REMOTE_PORT" in
  *[!0-9]*|'') echo "invalid REMOTE_PORT" >&2; exit 64 ;;
esac
if [ "$REMOTE_PORT" -lt 1 ] || [ "$REMOTE_PORT" -gt 65535 ]; then
  echo "REMOTE_PORT is out of range" >&2
  exit 64
fi
case "$ID" in
  ????????-????-????-????-????????????) ;;
  *) echo "invalid VLESS UUID" >&2; exit 64 ;;
esac
case "$ID" in *[!0-9A-Fa-f-]*) echo "invalid VLESS UUID" >&2; exit 64 ;; esac
case "$SERVER_NAME" in
  *[!A-Za-z0-9.-]*|'') echo "invalid SERVER_NAME" >&2; exit 64 ;;
esac

FLOW="${FLOW:-}"
FINGER_PRINT="${FINGER_PRINT:-chrome}"
PUBLIC_KEY="${PUBLIC_KEY:-}"
SHORT_ID="${SHORT_ID:-}"
ALPN="${ALPN:-}"
LOG_LEVEL="${LOG_LEVEL:-error}"
TUN_STACK="${TUN_STACK:-system}"
AUTO_REDIRECT="${AUTO_REDIRECT:-false}"

case "$FLOW" in ''|xtls-rprx-vision) ;; *) echo "unsupported FLOW" >&2; exit 64 ;; esac
case "$FINGER_PRINT" in chrome|firefox|safari|ios|android|edge|360|qq|random|randomized) ;; *) echo "unsupported FINGER_PRINT" >&2; exit 64 ;; esac
case "$LOG_LEVEL" in trace|debug|info|warn|error|fatal|panic) ;; *) echo "unsupported LOG_LEVEL" >&2; exit 64 ;; esac
case "$TUN_STACK" in system|gvisor|mixed) ;; *) echo "unsupported TUN_STACK" >&2; exit 64 ;; esac
case "$AUTO_REDIRECT" in true|false) ;; *) echo "AUTO_REDIRECT must be true or false" >&2; exit 64 ;; esac

FLOW_JSON=""
if [ -n "$FLOW" ]; then FLOW_JSON=', "flow": "'"$FLOW"'"'; fi

REALITY_JSON=""
if [ -n "$PUBLIC_KEY" ]; then
  case "$PUBLIC_KEY" in *[!A-Za-z0-9_-]*) echo "invalid Reality public key" >&2; exit 64 ;; esac
  if [ ${#PUBLIC_KEY} -ne 43 ]; then echo "invalid Reality public key length" >&2; exit 64; fi
  case "$SHORT_ID" in *[!0-9A-Fa-f]* ) echo "invalid Reality short ID" >&2; exit 64 ;; esac
  if [ $(( ${#SHORT_ID} % 2 )) -ne 0 ] || [ ${#SHORT_ID} -gt 16 ]; then
    echo "invalid Reality short ID length" >&2
    exit 64
  fi
  REALITY_JSON=', "reality": { "enabled": true, "public_key": "'"$PUBLIC_KEY"'", "short_id": "'"$SHORT_ID"'" }'
elif [ -n "$SHORT_ID" ]; then
  echo "SHORT_ID is not allowed without PUBLIC_KEY" >&2
  exit 64
fi

ALPN_JSON=""
if [ -n "$ALPN" ]; then
  case "$ALPN" in *[!A-Za-z0-9.,/_-]*|,*|*,|*,,*) echo "invalid ALPN" >&2; exit 64 ;; esac
  ALPN_ARRAY=$(printf '%s' "$ALPN" | awk -F, '{ out=""; for (i=1;i<=NF;i++) out=out (i>1 ? "," : "") "\"" $i "\""; printf "%s", out }')
  ALPN_JSON=', "alpn": ['"$ALPN_ARRAY"']'
fi

ETH_IFACE=$(ip -o link show | awk -F': ' '/link\/ether/ { sub(/@.*/, "", $2); print $2; exit }')
if [ -z "$ETH_IFACE" ]; then echo "no Ethernet interface found" >&2; exit 69; fi
IP_ETH=$(ip -4 -o addr show dev "$ETH_IFACE" | awk '{ split($4,a,"/"); print a[1]; exit }')
if [ -z "$IP_ETH" ]; then echo "no IPv4 address on $ETH_IFACE" >&2; exit 69; fi

mkdir -p /etc/sing-box
cat > /etc/sing-box/config.json <<EOF
{
  "log": { "disabled": false, "level": "$LOG_LEVEL", "timestamp": true },
  "inbounds": [
    { "type": "tun", "tag": "tun-in", "address": "198.18.0.1/30", "stack": "$TUN_STACK", "auto_route": true, "auto_redirect": $AUTO_REDIRECT, "strict_route": true },
    { "type": "redirect", "tag": "redirect-in", "listen": "0.0.0.0", "listen_port": 4080, "tcp_fast_open": true },
    { "type": "socks", "tag": "socks-in", "listen": "0.0.0.0", "listen_port": 1080 }
  ],
  "route": {
    "rules": [{ "inbound": ["tun-in", "redirect-in", "socks-in"], "action": "route", "outbound": "vps" }],
    "default_interface": "$ETH_IFACE"
  },
  "outbounds": [{
    "type": "vless", "tag": "vps", "server": "$REMOTE_ADDRESS", "server_port": $REMOTE_PORT,
    "uuid": "$ID"$FLOW_JSON,
    "tls": {
      "enabled": true, "insecure": false, "server_name": "$SERVER_NAME",
      "utls": { "enabled": true, "fingerprint": "$FINGER_PRINT" }$ALPN_JSON$REALITY_JSON
    }
  }]
}
EOF

iptables -t nat -C PREROUTING -i "$ETH_IFACE" -p tcp -d "$IP_ETH" --dport 1080 -j ACCEPT 2>/dev/null || \
  iptables -t nat -A PREROUTING -i "$ETH_IFACE" -p tcp -d "$IP_ETH" --dport 1080 -j ACCEPT
iptables -t nat -C PREROUTING -i "$ETH_IFACE" -p tcp -j REDIRECT --to-port 4080 2>/dev/null || \
  iptables -t nat -A PREROUTING -i "$ETH_IFACE" -p tcp -j REDIRECT --to-port 4080

exec /bin/sing-box -D /etc/sing-box/ -C /etc/sing-box/ run
