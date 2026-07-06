# Диагностика: контейнер VLESS (sing-box) на MikroTik — почему не ставится и не работает

По инструкции «№30 Mikrotik + VLESS» и доке автора контейнера
(https://hub.docker.com/r/wiktorbgu/vless-sing-box-tunnel-mikrotik) + официальной документации MikroTik.

Образ мультиархитектурный (arm/v7, arm64, amd64) и живой — проблема почти никогда не в самом образе.

---

## 0. Быстрая таблица «симптом → причина → фикс»

| Симптом / текст ошибки | Причина | Фикс |
|---|---|---|
| `bad command name container` — меню /container нет | Пакет container не установлен | Установить npk **точно** под свою версию ROS и архитектуру (см. 1.1) |
| `not allowed by device-mode` | container=yes не применился | Power-cycle (питанием!) в течение 5 мин после команды (см. 1.2) |
| `could not resolve dns name` | У роутера нет DNS | `/ip/dns/set servers=1.1.1.1,8.8.8.8` и проверить `/ping registry-1.docker.io` |
| `certificate verification failed` / SSL ошибка | Нет доверенных CA или кривое время | ROS 7.19–7.20: `builtin-trust-anchors=trusted`; ROS 7.21+: `builtin-trust-store=fetch` (+ NTP, см. 1.3) |
| Висит `extracting` / ошибка распаковки | tmpdir=ramstorage не существует | Создать tmpfs или убрать tmpdir (см. 1.4) |
| `429 Too Many Requests` / `unauthorized` | Лимит анонимных pull Docker Hub на IP | Бесплатный аккаунт Docker Hub + username/password в /container/config (см. 1.5) |
| Timeout / connection refused при add | registry-1.docker.io недоступен из сети (РФ) | Импорт образа через tar — универсальный обход (см. 1.7) |
| `no space left` / обрыв распаковки | Кончилась флешка (на hAP ax² всего 128 МБ) | Проверить `/system/resource/print` free-hdd-space, почистить файлы |
| Контейнер есть, но status ≠ running | Кривые envs или их нет | См. раздел 2 |
| running, но интернет не идёт | Маршрутизация/NAT/ключ | См. раздел 3 |

---

## 1. «Не скачивается» — самый частый случай, по порядку проверки

### 1.1 Пакет container вообще установлен?
- npk должен совпадать с версией RouterOS **точно** (container-7.19.3 не встанет на 7.16.x) и по архитектуре.
- **hAP ax² — это arm64**, а не arm! На скрине инструкции `container-7.19.3-arm.npk` — на ax² такой файл молча не установится.
- Проверка:
  ```
  /system/resource/print        # architecture-name → arm64/arm, version
  /system/package/print         # container должен быть в списке
  ```
- Фикс: скачать Extra packages ровно своей версии ROS для своей архитектуры → закинуть npk в корень Files → reboot.

### 1.2 device-mode реально включён?
- После `/system/device-mode/update container=yes` подтверждение — **только отключение питания** (или кнопка reset) в течение ~5 минут. Программный `/system reboot` не считается, и настройка тихо не применяется.
- Проверка: `/system/device-mode/print` → должно быть `container: yes`. Нет — повторить и дёрнуть питание.

### 1.3 DNS и время на роутере
- Роутер сам резолвит registry: `/ip/dns/print` (должны быть серверы), `/ping registry-1.docker.io`.
- После сброса к заводским часы могут быть в 1970 → TLS к registry падает «ошибкой сертификата».
  ```
  /system/clock/print
  /system/ntp/client/set enabled=yes servers=time.cloudflare.com,pool.ntp.org
  ```
- Ошибка сертификата при верном времени — включить встроенные доверенные CA:
  - ROS 7.19–7.20: `/certificate/settings/set builtin-trust-anchors=trusted`
  - ROS **7.21+** (параметр переименован): `/certificate/settings/set builtin-trust-store=fetch`
  - старее 7.19 — команды нет, сначала обновить RouterOS.

### 1.4 tmpdir=ramstorage — ловушка инструкции
- Инструкция задаёт `/container config set ... tmpdir=ramstorage`, но **нигде не создаёт этот диск**. Если его нет — pull падает или вечно висит на extracting.
- Проверка: `/disk/print` — есть ли slot ramstorage.
- Фикс (свежие ROS): `/disk/add slot=ramstorage type=tmpfs tmpfs-max-size=150M`
  Либо просто убрать tmpdir: `/container/config/set tmpdir=""` (распаковка пойдёт на флешку — следить за местом).

### 1.5 Лимиты Docker Hub (частая причина «то качается, то нет»)
- Анонимные pull жёстко лимитированы по IP. За CGNAT провайдера лимит часто уже исчерпан соседями → 429/unauthorized.
- Фикс: бесплатный аккаунт на hub.docker.com и:
  ```
  /container/config/set username=ВАШ_ЛОГИН password=ВАШ_ПАРОЛЬ
  ```
  (поддерживается с ROS 7.8).

### 1.6 registry-1.docker.io недоступен из РФ-сети
- Docker Hub периодически ограничивает доступ с РФ IP + возможны блокировки/замедления на стороне ТСПУ. Симптом — чистый timeout.
- Можно попробовать публичное зеркало (доступность меняется, проверять):
  ```
  /container/config/set registry-url=https://mirror.gcr.io
  ```
  (mirror.gcr.io отдаёт только популярные образы — для wiktorbgu скорее всего не сработает, тогда → 1.7).

### 1.7 Универсальный обход: импорт образа файлом (работает всегда)
Официальный способ MikroTik «Option B». На любом ПК с Docker/Podman (можно через уже работающий VPN, можно прямо на зарубежном VPS):
```bash
# для arm64 (hAP ax2, ax3 и т.п.); для 32-бит arm заменить на --arch=arm
podman pull --arch=arm64 docker.io/wiktorbgu/vless-sing-box-tunnel-mikrotik:latest
podman save docker.io/wiktorbgu/vless-sing-box-tunnel-mikrotik:latest > vless-sbox.tar
# (docker: docker pull --platform linux/arm64 ... && docker save ... > vless-sbox.tar)
```
Залить `vless-sbox.tar` на роутер через Winbox → Files, затем:
```
/container/add file=vless-sbox.tar interface=VLESS-TUN-SBOX start-on-boot=yes root-dir=/docker/vless-tun-sing-box envlist=vless
```

### 1.8 Место на флешке
- hAP ax² без USB: образ ~17 МБ сжатый + распаковка. Проверить `free-hdd-space` в `/system/resource/print`. Меньше ~40–50 МБ свободно — чистить (старые npk, бэкапы, повторные root-dir от неудачных попыток: `/file/print`).
- Автор контейнера в доке кладёт root-dir на `usb1/...` — на устройствах с USB так и делать.

---

## 2. Скачался, но не стартует (status ≠ running / сразу stopped)

1. **Синтаксис envs.** В свежих ROS: `/container/envs/add list=vless key=... value=...`. Вариант `name=vless` — для старых версий (об этом в инструкции одна строчка мелко). Проверка: `/container/envs/print` — все 8 переменных в списке `vless`.
2. **Порядок.** Автор контейнера задаёт envs **до** `/container/add`. Если envs добавили/исправили после — минимум перезапустить, надёжнее пересоздать контейнер (`/container/remove` → add заново).
3. **Значения из ключа vless://** — типовые ошибки:
   - `PUBLIC_KEY` = `pbk=` (не приватный ключ!), `SHORT_ID` = `sid=`, `SERVER_NAME` = `sni=` (одно имя, без запятой), `FINGER_PRINT` = `fp=`;
   - `REMOTE_PORT` = порт **инбаунда** (в каскадной схеме на московском сервере это 8443, не порт панели!);
   - `FLOW` = `xtls-rprx-vision` ровно как у клиента на сервере; если у клиента flow пустой — оставить пустым;
   - без кавычек, пробелов, без хвоста `#название` и URL-кодов (%2F);
   - `ID` = UUID клиента целиком.
4. **dns у контейнера.** Автор в доке добавляет `dns=1.1.1.1,8.8.8.8,9.9.9.9` в `/container/add` — в инструкции этого нет. Обязательно, если REMOTE_ADDRESS — домен; не помешает и с IP.
5. **Смотреть логи** — контейнер сам скажет, что не так:
   ```
   /container/set 0 logging=yes
   /container/start 0
   /log/print where topics~"container"
   ```
   Ошибки sing-box вида `decode config`, `authentication failed`, `REALITY: processed invalid connection` указывают на конкретную env/ключ.
6. **veth.** `interface=VLESS-TUN-SBOX` в add должен точно совпадать с именем из `/interface/veth` (регистр важен).

---

## 3. Running, но интернет через туннель не идёт

1. Сначала исключить сервер: тот же ключ проверить с телефона (v2rayNG/NekoBox). Не работает и там — проблема на VPS, не в роутере.
2. NAT: `/ip firewall nat add action=masquerade chain=srcnat out-interface=VLESS-TUN-SBOX` — есть и не отключён.
3. MSS mangle-правило из шага 18 — есть. Правильный диапазон: `tcp-mss=1361-65535` при `new-mss=1360` (в инструкции опечатка `1453-6553`; и даже «исправленный» вариант 1453-65535 оставляет дыру 1361–1452 — такие пакеты не клампятся и соединения подвисают).
4. Маршруты: шлюз именно `172.18.20.6` (адрес контейнера), а не .5. Проверить `/ip/route/print where comment~"..."`.
5. Проверка изнутри: `/container/shell 0` → `ping 1.1.1.1` (если shell доступен в образе).
6. Каскад: Mikrotik должен подключаться к **московскому** серверу (порт 8443), а маршрутизация Москва→заграница настраивается на VPS (аутбаунд + правило), не на роутере.

---

## 4. Отличия инструкции от доки автора контейнера

| Инструкция №30 | Дока автора (Docker Hub) |
|---|---|
| envs после /container/add | envs **до** add |
| без `dns=` | `dns=1.1.1.1,8.8.8.8,9.9.9.9` |
| root-dir на внутренней флешке | root-dir на `usb1/...` |
| tmpdir=ramstorage (не создаётся) | tmpdir не задаёт |
| — | Автор: «🔥 NEW BEST CONTAINER» → `wiktorbgu/mihomo-mikrotik` |

Автор сам считает sing-box-контейнер устаревшим и рекомендует mihomo — у автора инструкции под это есть №32 («Mikrotik + VLESS + ядро Mihomo»), он же помечен как «проще». Если у пользователя всё падает на sing-box — быстрее перевести на №32.

Чат поддержки автора контейнера: https://t.me/it_network_people

---

## 5. Чек-лист для поддержки: что запросить у пользователя одной пачкой

```
/system/resource/print
/system/package/print
/system/device-mode/print
/system/clock/print
/disk/print
/container/config/print
/container/print detail
/container/envs/print
/interface/veth/print
/log/print where topics~"container"
```
По этому выводу однозначно видно: архитектуру/версию, установлен ли пакет, включён ли device-mode, существует ли tmpdir, дошёл ли образ, правильные ли envs и что пишет sing-box.
