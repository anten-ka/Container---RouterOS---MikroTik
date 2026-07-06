# План тестирования на hAP ax³: старая прошивка → новая

Идея: одна железка, два поколения прошивок — так мы покрываем и «старых», и «новых» подписчиков. Сначала фиксируем всё на старой прошивке, потом обновляемся и повторяем короткую программу.

## Что понадобится

- hAP ax³ **желательно не как основной роутер** (интернет дома будет падать во время тестов). Идеально: WAN ax³ → LAN основного роутера (двойной NAT для тестов не мешает), ПК подключён к ax³.
- Физический доступ к питанию ax³ (device-mode подтверждается выдёргиванием вилки).
- Рабочий ключ `vless://` от твоего VPS (+ по желанию заведомо битый ключ для негативного теста).
- ПК: Mac (setup.sh) и, если есть, Windows или виртуалка (setup.ps1) — чтобы проверить оба установщика.
- 40–90 минут.

## Этап 0. Фиксация исходного состояния (5 мин)

В терминале роутера (WinBox → New Terminal или ssh):

```
/system/resource/print
/system/package/print
/system/device-mode/print
/interface/print
```

Запиши (или пришли мне) как минимум `version`, `board-name`, `architecture-name` — от версии зависит, что именно мы ожидаем:

| Версия на ax³ | Чего ждём |
|---|---|
| < 7.4 | Контейнеров в этой версии нет вообще. Ценный негативный тест: установщик должен **корректно остановиться** с объяснением (пакета container-X.Y для неё не существует → Manual-режим). Дальше сразу Этап B. |
| 7.4 – 7.8 | Контейнеры есть, но нет авторизации Docker Hub (7.8+) и `/interface/wifi` — Wi-Fi должен создаться через ветку **wifiwave2**. |
| 7.9 – 7.12 | Полный тест; Wi-Fi через ветку **wifiwave2** (в логе будет видно). |
| 7.13 – 7.18 | Wi-Fi через `/interface/wifi`; сертификаты: в логе «недоступны (ROS < 7.19)» — это норма. |
| 7.19 – 7.20 | Сертификаты: «builtin-trust-anchors, ROS 7.19-7.20». |
| 7.21+ | Это уже «новая»; Этап A и B сольются — тогда прогони Этап A как есть. |

Дополнительно к автоматическому бэкапу сделай свой личный:

```
/system/backup/save name=my-pretest dont-encrypt=yes
/export file=my-pretest
```

и скачай оба файла из Files на ПК.

## Этап A. Старая прошивка

### Тест A1 — мастер в браузере (5 мин)

- [ ] Открой `vless-mikrotik-wizard.html`, вставь ключ → «Разобрать ключ» — поля заполнились, предупреждений нет (или они по делу).
- [ ] Кнопки A− / A+ меняют размер шрифта; после перезагрузки страницы размер запомнился.
- [ ] Сузь/растяни окно браузера — страница перестраивается без горизонтальной прокрутки.
- [ ] В DomainMapper отметь один маленький сервис (например, Openai) → «Собрать подсети» — список появился в поле.
- [ ] Подсказка ОС над полем пароля показывает твою систему.

### Тест A2 — авто-установка (конфигурация «максимум»): отдельная подсеть + Wi-Fi + бэкап

В мастере: авто-режим (IP/логин ax³), галочка бэкапа ✓, шаг 3 = «Создать отдельную VPN-подсеть» (192.168.99.0/24), шаг 4 = без дополнительного списка, шаг 5 = «Создать отдельную VPN Wi-Fi» (SSID `Test-VPN`, пароль 8+), шаг 6 = внутренняя память. Скачай `setup.sh` (Mac) или `setup.ps1` (Windows) + `vless-setup.rsc` в одну папку, запусти установщик.

Чек-лист по ходу (всё видно в консоли):

- [ ] Подключился, спросил пароль 1–2 раза, дальше без пароля.
- [ ] **Карточка роутера открылась в браузере: фото ax³ + модель + версия.** (`router-info.html` лежит рядом со скриптом.)
- [ ] Рядом со скриптом появились `vless-wizard-backup.backup` и `.rsc` — открой .rsc глазами, это твой конфиг.
- [ ] Если пакета container не было: сам скачал zip под **твою старую версию**, залил npk, перезагрузил, дождался.
- [ ] Попросил дёрнуть питание для device-mode ровно один раз; после включения продолжил сам.
- [ ] Живой лог `[router] === [1/N] ...` со всеми шагами и пояснениями «Зачем».
- [ ] `ИТОГОВЫЙ ОТЧЁТ`: контейнер running, подсеть, Wi-Fi — сколько радио создано (**ожидаем 2**; в логе видно, через какую ветку — wifi или wifiwave2 — запиши это).
- [ ] Скрипт удалил свой ssh-ключ (проверка: `/user/ssh-keys/print` — пусто или только твои).

### Тест A3 — функциональные проверки туннеля (10 мин)

- [ ] Появился SSID `Test-VPN`; телефон подключился, получил адрес из 192.168.99.x.
- [ ] С телефона открой 2ip.ru → **IP твоего VPS**.
- [ ] С телефона открой 192.168.88.1 (WinBox/WebFig роутера) → открывается (исключения для локалки работают).
- [ ] Основная сеть (обычный Wi-Fi/кабель) ходит в интернет напрямую (2ip = IP провайдера).
- [ ] **Kill-switch:** в терминале `/container/stop 0` → на телефоне в Test-VPN интернета нет вообще (не «через провайдера», а нет). `/container/start 0`, подожди ~15 сек → интернет вернулся через VPS.
- [ ] Перезагрузи роутер → контейнер поднялся сам (start-on-boot), Test-VPN снова через VPS.

### Тест A4 — идемпотентность и ручной режим (5 мин)

- [ ] Запусти установщик ещё раз: бэкап перезаписался, шаги «уже есть — пропускаю», дубликатов нет (`/ip/firewall/mangle/print`, `/ip/route/print where comment~"vless"` — по одному комплекту).
- [ ] Сгенерируй в мастере ручной вариант (существующая сеть + список из DomainMapper) → выполни `/import vless-setup.rsc verbose=yes` → маршруты добавились, 2ip с ПК за роутером для маршрутизируемых сетей = IP VPS.

### Тест A5 — негативный (по желанию, 5 мин)

- [ ] Неверный пароль роутера → установщик уходит в Manual-режим с инструкцией, ничего не сломав.
- [ ] Битый ключ (испорти pbk) → контейнер не running, лог говорит смотреть /log и проверять PUBLIC_KEY/SHORT_ID/SNI.

### Тест A6 — запасной образ .tar (главная фича для РФ, 10 мин)

Как сымитировать «Docker Hub недоступен» на стенде: на роутере временно сломай доступ к registry, чтобы pull падал (после теста верни):

```
/ip/dns/static/add name=registry-1.docker.io address=127.0.0.1 comment=block-docker-test
/ip/dns/static/add name=lscr.io address=127.0.0.1 comment=block-docker-test
```

Заранее подготовь `.tar` (на этом же Mac, если есть podman/docker; иначе на VPS):

```
podman pull --arch=arm64 docker.io/wiktorbgu/vless-sing-box-tunnel-mikrotik:latest
podman save docker.io/wiktorbgu/vless-sing-box-tunnel-mikrotik:latest -o vless-container-arm64.tar
```

Положи `vless-container-arm64.tar` рядом с setup.sh/setup.ps1 и запусти установщик:

- [ ] В логе видно 3 попытки скачать с Docker Hub, каждая падает.
- [ ] Установщик пишет «подключаю запасной образ (.tar)», находит файл рядом, заливает по scp.
- [ ] Повторный `/import` ставит контейнер **из файла** → статус running.
- [ ] Маршруты/Wi-Fi/kill-switch до-настроились в том же прогоне (не потерялись из-за первой неудачи).
- [ ] Проверь вариант «файла нет»: убери tar, оставь пустые поля → установщик даёт понятную инструкцию, как получить образ (без краша).
- [ ] Проверь вариант «по ссылке»: выложи tar на любой URL, впиши его в мастере в поле «Ссылка на .tar» → установщик сам скачал и поставил.

После теста сними блокировку:

```
/ip/dns/static/remove [/ip/dns/static/find where comment=block-docker-test]
```

Отдельно проверь «горячий» путь без подмены DNS: просто положи `.tar` рядом со скриптом на чистом роутере — установщик первым же `/import` должен взять образ **из файла** (в логе «Найден локальный образ… ставлю из файла»), не тратя время на Docker Hub вообще.

## Между этапами: очистка

Вариант 1 (честный): восстанови исходное состояние — `Files → vless-wizard-backup.backup → Restore` (или `my-pretest`). Роутер перезагрузится «как был».

Вариант 2 (выборочный): снести только то, что создал мастер — вставь целиком:

```
{
:foreach i in=[/container/find where interface="VLESS-TUN-SBOX"] do={ :do { /container/stop $i ; :delay 3s } on-error={} ; /container/remove $i }
:do { /container/envs/remove [/container/envs/find where list="vless"] } on-error={ :do { /container/envs/remove [/container/envs/find where name="vless"] } on-error={} }
:do { /ip/route/remove [/ip/route/find where comment~"vless-"] } on-error={}
# маршруты списка удаляй по своему комментарию, например:
:do { /ip/route/remove [/ip/route/find where comment~"VPN-"] } on-error={}
:do { /ip/firewall/mangle/remove [/ip/firewall/mangle/find where comment~"vless-"] } on-error={}
:do { /ip/firewall/nat/remove [/ip/firewall/nat/find where comment~"vless-"] } on-error={}
:do { /interface/wifi/remove [/interface/wifi/find where name~"^vpn-"] } on-error={}
:do { /interface/wifiwave2/remove [/interface/wifiwave2/find where name~"^vpn-"] } on-error={}
:do { /interface/wireless/remove [/interface/wireless/find where name~"^vpn-"] } on-error={}
:do { /interface/wireless/security-profiles/remove [/interface/wireless/security-profiles/find where name="vpn-sec"] } on-error={}
:do { /ip/dhcp-server/remove [/ip/dhcp-server/find where name="vpn-dhcp"] } on-error={}
:do { /ip/dhcp-server/network/remove [/ip/dhcp-server/network/find where comment~"" and address~"192.168.99"] } on-error={}
:do { /ip/pool/remove [/ip/pool/find where name="vpn-pool"] } on-error={}
:do { /interface/bridge/port/remove [/interface/bridge/port/find where bridge="bridge-vpn"] } on-error={}
:do { /ip/address/remove [/ip/address/find where interface="bridge-vpn"] } on-error={}
:do { /interface/bridge/remove [/interface/bridge/find where name="bridge-vpn"] } on-error={}
:do { /routing/table/remove [/routing/table/find where name="vpn-rt"] } on-error={}
:do { /ip/address/remove [/ip/address/find where interface="VLESS-TUN-SBOX"] } on-error={}
:do { /interface/veth/remove [/interface/veth/find where name="VLESS-TUN-SBOX"] } on-error={}
:do { /disk/remove [/disk/find where slot="ramstorage"] } on-error={}
:put "Очистка завершена"
}
```

## Этап B. Новая прошивка (20 мин)

1. Обновись: `/system/package/update/check-for-updates` → `install` (канал stable; сейчас это 7.2x). После перезагрузки: `/system/routerboard/upgrade` + ещё один reboot (прошивка загрузчика).
2. Проверь, что пакет container пережил апгрейд: `/system/package/print` (он обновляется вместе с системой).
3. Повтори **A2 в конфигурации «действующая сеть + список маршрутов»** (другая ветка логики) — и обрати внимание в логе:
   - [ ] сертификаты: должно быть «builtin-trust-store, ROS 7.21+»;
   - [ ] Wi-Fi (если включал): ветка `/interface/wifi`;
   - [ ] маршруты добавились батчами, счётчик в отчёте совпадает с размером списка.
4. Повтори A3 (сокращённо: 2ip через маршрутизируемую сеть, kill-switch если есть подсеть).
5. Если есть второй ПК/ВМ с другой ОС — прогони установщик оттуда (закрыть обе пары: sh и ps1).

## Если что-то пошло не так — что мне прислать

1. Полный вывод установщика (весь текст консоли, особенно строки `[router]`).
2. Пачку диагностики с роутера (одной вставкой):

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
/ip/firewall/mangle/print where comment~"vless"
/ip/route/print where comment~"vless"
/log/print where topics~"container"
```

3. Для Wi-Fi проблем: `/interface/wifi/print detail` (или `wifiwave2`/`wireless` — что есть).

## Итоговая матрица

| Проверка | Старая (v = ____) | Новая (v = ____) |
|---|---|---|
| Карточка роутера (фото ax³) | ☐ | ☐ |
| Бэкап скачался до изменений | ☐ | ☐ |
| npk сам установился | ☐ | — |
| device-mode через power-cycle | ☐ | — |
| Контейнер running | ☐ | ☐ |
| Wi-Fi SSID создан (ветка: ____) | ☐ | ☐ |
| Kill-switch (стоп = нет интернета) | ☐ | ☐ |
| Локалка доступна из VPN-сети | ☐ | ☐ |
| Маршруты по списку | ☐ | ☐ |
| Запасной .tar: файл рядом → ставит из файла | ☐ | ☐ |
| Запасной .tar: 3 попытки Docker → фолбэк | ☐ | ☐ |
| Повторный запуск без дубликатов | ☐ | ☐ |
| Отчёт в конце соответствует реальности | ☐ | ☐ |
| Установщик: sh ☐ / ps1 ☐ | | |
