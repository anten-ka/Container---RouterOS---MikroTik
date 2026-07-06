# ============================================================
#  MikroTik + VLESS (контейнер sing-box, wiktorbgu) — автонастройка
#  Покрывает шаги 16-25 инструкции №30 + фиксы из доки автора.
#
#  КАК ЗАПУСТИТЬ:
#   1) Заполните блок "ПЕРЕМЕННЫЕ" ниже данными из своего vless:// ключа
#   2) Залейте файл на роутер (Winbox -> Files) и в терминале:
#        /import vless-mikrotik-autosetup.rsc verbose=yes
#      (либо просто вставьте ВЕСЬ текст файла в терминал целиком)
#
#  ЧТО СКРИПТ НЕ МОЖЕТ (нужно сделать руками ДО запуска, это физика):
#   - установить пакет container-<версия>-<arch>.npk (Files + reboot)
#   - /system/device-mode/update container=yes + ОТКЛЮЧЕНИЕ ПИТАНИЯ
#  Скрипт сам проверит оба пункта и скажет, если они не выполнены.
#
#  ПОСЛЕ скрипта останется только загрузить маршруты (DomainMapper,
#  шлюз 172.18.20.6).
# ============================================================

{
# ---------------- ПЕРЕМЕННЫЕ (заполнить!) ----------------
# vless://ID@АДРЕС:ПОРТ?...pbk=PUBLICKEY&fp=FINGERPRINT&sni=SERVERNAME&sid=SHORTID&flow=FLOW
:local remoteAddress "xxx.xxx.xxx.xxx"
:local remotePort    "443"
:local vlessId       "d6cf31aa-0000-0000-0000-40eba0baf68c"
:local flow          "xtls-rprx-vision"
:local fingerPrint   "chrome"
:local serverName    "yahoo.com"
:local publicKey     "PublicKey"
:local shortId       "aaaaaaaa"

# Логин/пароль Docker Hub (необязательно; спасает от ошибки 429 Too Many Requests)
:local dhubUser ""
:local dhubPass ""

# ---------------- служебные (можно не трогать) ----------------
:local vethName "VLESS-TUN-SBOX"
:local image    "wiktorbgu/vless-sing-box-tunnel-mikrotik"
:local rootDir  "/docker/vless-tun-sing-box"

# ================= 0. ПРОВЕРКИ =================
:put "=== [0/8] Проверки ==="
:local arch [/system/resource/get architecture-name]
:local ver  [/system/resource/get version]
:put ("RouterOS $ver, архитектура: $arch")
:local freeSpace [/system/resource/get free-hdd-space]
:if ($freeSpace < 41943040) do={
  :put "ВНИМАНИЕ: свободно меньше 40 МБ на встроенной памяти - распаковка образа может не пройти. Почистите /file."
}
:if ([:len [/system/package/find name="container"]] = 0) do={
  :put "ОШИБКА: пакет container НЕ установлен."
  :put ("Скачайте Extra packages ровно вашей версии ($ver) для $arch,")
  :put "закиньте container-*.npk в Files, перезагрузите роутер и запустите скрипт снова."
  :error "container package missing"
}
:local dmode false
:local dmv ""
:do { :set dmv [:tostr [/system/device-mode/get container]] } on-error={ :set dmv "" }
:if (($dmv = "true") or ($dmv = "yes")) do={ :set dmode true }
:if (!$dmode) do={
  :put "ОШИБКА: режим контейнеров не активирован (device-mode)."
  :put "Выполните: /system/device-mode/update container=yes"
  :put "и в течение 5 минут ВЫКЛЮЧИТЕ РОУТЕР ИЗ РОЗЕТКИ и включите обратно"
  :put "(программный reboot НЕ подходит). Потом запустите скрипт снова."
  :error "device-mode container=no"
}
:put "Пакет container установлен, device-mode активен. OK"

# ================= 1. СЕРТИФИКАТЫ / ВРЕМЯ =================
:put "=== [1/8] Сертификаты и время ==="
:local certOk false
# ВАЖНО: через :parse - иначе на ROS без этого параметра ошибка ПАРСИНГА (не runtime), :do..on-error её не ловит, скрипт падает.
:do { :local cf [:parse "/certificate/settings/set builtin-trust-store=fetch"] ; $cf ; :set certOk true ; :put "Доверенные CA включены (builtin-trust-store, ROS 7.21+)" } on-error={}
:if (!$certOk) do={ :do { :local cf [:parse "/certificate/settings/set builtin-trust-anchors=trusted"] ; $cf ; :set certOk true ; :put "Доверенные CA включены (builtin-trust-anchors, ROS 7.19-7.20)" } on-error={} }
:if (!$certOk) do={ :put "Настройка доверенных CA недоступна (ROS < 7.19). Если будет ошибка сертификата при загрузке - обновите RouterOS." }
:do { /system/ntp/client/set enabled=yes servers=time.cloudflare.com,pool.ntp.org } on-error={}

# ================= 2. СЕТЬ КОНТЕЙНЕРА =================
:put "=== [2/8] veth-интерфейс ==="
:if ([:len [/interface/veth/find name=$vethName]] = 0) do={
  :do {
    /interface/veth/add name=$vethName address=172.18.20.6/30 gateway=172.18.20.5 gateway6=""
  } on-error={
    /interface/veth/add name=$vethName address=172.18.20.6/30 gateway=172.18.20.5
  }
  :put "veth создан"
} else={ :put "veth уже существует - пропускаю" }
:if ([:len [/ip/address/find interface=$vethName]] = 0) do={
  /ip/address/add interface=$vethName address=172.18.20.5/30
}

# ================= 3. FIREWALL =================
:put "=== [3/8] Firewall (MSS + NAT) ==="
# В инструкции опечатка tcp-mss=1453-6553; правильный клампинг: 1361-65535 -> new-mss=1360 (режем всё, что больше 1360)
:if ([:len [/ip/firewall/mangle/find comment="vless-sbox-mss"]] = 0) do={
  /ip/firewall/mangle/add action=change-mss chain=forward new-mss=1360 out-interface=$vethName passthrough=yes protocol=tcp tcp-flags=syn tcp-mss=1361-65535 comment="vless-sbox-mss"
}
:if ([:len [/ip/firewall/nat/find comment="vless-sbox-nat"]] = 0) do={
  /ip/firewall/nat/add action=masquerade chain=srcnat out-interface=$vethName comment="vless-sbox-nat"
}
:put "OK"

# ================= 4. TMPDIR / REGISTRY =================
:put "=== [4/8] Registry и временный диск ==="
:local tmpOk false
:do { :if ([:len [/disk/find slot="ramstorage"]] > 0) do={ :set tmpOk true } } on-error={}
:if (!$tmpOk) do={
  :do {
    /disk/add slot=ramstorage type=tmpfs tmpfs-max-size=150M
    :set tmpOk true
    :put "Создан tmpfs-диск ramstorage (150M в RAM)"
  } on-error={ :put "tmpfs недоступен (старый ROS) - распаковка пойдёт на встроенную память" }
}
:if ($tmpOk) do={
  /container/config/set registry-url=https://registry-1.docker.io tmpdir=ramstorage
} else={
  /container/config/set registry-url=https://registry-1.docker.io tmpdir=""
}
:if ([:len $dhubUser] > 0) do={
  :do { /container/config/set username=$dhubUser password=$dhubPass ; :put "Авторизация Docker Hub включена" } on-error={}
}

# ================= 5. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ =================
:put "=== [5/8] Env-переменные (envlist=vless) ==="
# ВАЖНО: параметр списка env на разных ROS называется по-разному (list= на новых, name= на 7.18 и старее).
# Неизвестный параметр = ОШИБКА ПАРСИНГА (не runtime), обычный :do..on-error её НЕ ловит. Определяем через :parse.
:local ep ""
:do { :local f [:parse "/container/envs/add list=__vprobe key=P value=1"] ; $f ; :set ep "list" } on-error={}
:if ($ep = "") do={ :do { :local f [:parse "/container/envs/add name=__vprobe key=P value=1"] ; $f ; :set ep "name" } on-error={} }
:do { /container/envs/remove [/container/envs/find where key="P"] } on-error={}
:if ($ep = "") do={ :put "ОШИБКА: /container/envs/add не принимает ни list= ни name=." ; :error "envs param" }
:put ("Синтаксис переменных: " . $ep . "=vless")
:do { :local f [:parse ("/container/envs/remove [/container/envs/find where " . $ep . "=vless]")] ; $f } on-error={}
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=REMOTE_ADDRESS value=\"" . $remoteAddress . "\"")] ; $f } on-error={ :put "env fail: REMOTE_ADDRESS" }
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=REMOTE_PORT value=\"" . $remotePort . "\"")] ; $f } on-error={ :put "env fail: REMOTE_PORT" }
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=ID value=\"" . $vlessId . "\"")] ; $f } on-error={ :put "env fail: ID" }
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=FLOW value=\"" . $flow . "\"")] ; $f } on-error={ :put "env fail: FLOW" }
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=FINGER_PRINT value=\"" . $fingerPrint . "\"")] ; $f } on-error={ :put "env fail: FINGER_PRINT" }
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=SERVER_NAME value=\"" . $serverName . "\"")] ; $f } on-error={ :put "env fail: SERVER_NAME" }
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=PUBLIC_KEY value=\"" . $publicKey . "\"")] ; $f } on-error={ :put "env fail: PUBLIC_KEY" }
:do { :local f [:parse ("/container/envs/add " . $ep . "=vless key=SHORT_ID value=\"" . $shortId . "\"")] ; $f } on-error={ :put "env fail: SHORT_ID" }
:put "8 переменных добавлены"

# ================= 6. КОНТЕЙНЕР =================
:put "=== [6/8] Загрузка контейнера (несколько минут)... ==="
:do {
  :foreach i in=[/container/find where root-dir=$rootDir] do={
    :do { /container/stop $i ; :delay 3s } on-error={}
    /container/remove $i
    :put "Старый контейнер удалён"
  }
} on-error={}
:do {
  /container/add remote-image=$image interface=$vethName envlist="vless" root-dir=$rootDir start-on-boot=yes logging=yes dns=1.1.1.1,8.8.8.8
} on-error={
  /container/add remote-image=$image interface=$vethName envlist="vless" root-dir=$rootDir start-on-boot=yes logging=yes
}

# ================= 7. ЖДЁМ РАСПАКОВКУ =================
:put "=== [7/8] Ожидание загрузки/распаковки (до 15 мин) ==="
:local waited 0
:local st ""
:while ($waited < 900) do={
  :delay 15s
  :set waited ($waited + 15)
  :set st ""
  :do { :set st [/container/get [/container/find where root-dir=$rootDir] status] } on-error={}
  :put ("  статус: $st ($waited сек)")
  :if ($st = "stopped") do={ :set waited 900 }
  :if ($st = "error")   do={ :set waited 900 }
}

# ================= 8. ЗАПУСК =================
:put "=== [8/8] Запуск ==="
:if ($st = "stopped") do={
  /container/start [/container/find where root-dir=$rootDir]
  :delay 10s
  :do { :set st [/container/get [/container/find where root-dir=$rootDir] status] } on-error={}
  :put ("Статус контейнера: $st")
  :if ($st = "running") do={
    :put "ГОТОВО! Контейнер работает."
    :put "Осталось: загрузить маршруты (DomainMapper), шлюз 172.18.20.6."
  } else={
    :put "Контейнер не удержался в running. Смотрите: /log/print"
    :put "Чаще всего - неверные значения из vless:// ключа (PUBLIC_KEY=pbk, SHORT_ID=sid, SERVER_NAME=sni, REMOTE_PORT=порт инбаунда)."
  }
} else={
  :put ("Образ не докачался (статус: $st).")
  :put "Частые причины: registry-1.docker.io недоступен из вашей сети, лимит Docker Hub (429), нет места."
  :put "Обход: скачать образ на ПК (podman pull --arch=arm64 ...), сохранить в .tar, залить на роутер и /container/add file=..."
  :put "Подробности в памятке mikrotik-vless-container-troubleshooting.md"
}
}
