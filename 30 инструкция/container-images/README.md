# Запасные образы контейнера (зеркало для установщика)

Здесь лежит образ VLESS-контейнера, сохранённый в файлы `.tar` под все три архитектуры MikroTik. Они нужны как **запасной источник**: если у пользователя не качается с Docker Hub (частая беда в РФ), установщик берёт образ отсюда и ставит из файла.

| Файл | Для каких роутеров | RouterOS `architecture-name` |
|---|---|---|
| `vless-container-arm64.tar` (51 МБ) | hAP ax², ax³ и большинство современных | `arm64` |
| `vless-container-arm.tar` (39 МБ) | старые 32-битные ARM (hAP ac², hEX и т.п.) | `arm` |
| `vless-container-x86_64.tar` (46 МБ) | x86 / CHR (редко) | `x86_64` |

Образ-источник: `wiktorbgu/vless-sing-box-tunnel-mikrotik:latest` (Docker Hub, автор — @it_network_people). Это **точная копия** официального образа (тот же digest и содержимое), просто сохранённая в файл. Формат — docker-archive с несжатыми слоями (`crane --format=legacy`), проверен на живом RouterOS 7.18.2 (обычный `crane pull` даёт несовместимый gzip-формат!). Контрольные суммы — в `SHA256SUMS.txt`. Снимок сделан 2026-07-06; если автор обновит образ, зеркало стоит пересобрать (команды ниже).

---

## Как выложить на GitHub и подключить к мастеру

Файлы по ~16–18 МБ — влезают в GitHub без ухищрений. Два способа, оба работают с установщиком.

### Способ 1 — GitHub Releases (рекомендую)

1. Создай репозиторий (можно приватный не подойдёт — нужен публичный доступ на скачивание; сделай **public**).
2. Вкладка **Releases** → **Draft a new release** → задай тег, например `images-v1`.
3. Перетащи в раздел «Attach binaries» все три файла `vless-container-*.tar`.
4. **Publish release.** Прямые ссылки получатся вида:
   ```
   https://github.com/ТВОЙ_ЛОГИН/ТВОЙ_РЕПО/releases/download/images-v1/vless-container-arm64.tar
   ```
5. В мастере (шаг 6 → «Запасной образ» → поле «Ссылка на .tar») впиши **одну** ссылку с плейсхолдером `{arch}`:
   ```
   https://github.com/ТВОЙ_ЛОГИН/ТВОЙ_РЕПО/releases/download/images-v1/vless-container-{arch}.tar
   ```
   Установщик сам подставит `arm64`, `arm` или `x86_64` под конкретный роутер. Одна ссылка — все модели.

### Способ 2 — файлы прямо в репозитории (raw)

1. Создай **public** репозиторий, положи туда папку `container-images/` с этими `.tar` (через веб можно перетащить — файлы <25 МБ проходят).
2. Ссылка на raw:
   ```
   https://raw.githubusercontent.com/ТВОЙ_ЛОГИН/ТВОЙ_РЕПО/main/container-images/vless-container-{arch}.tar
   ```
   (мастер уже качает списки доменов с `raw.githubusercontent.com`, так что путь проверенный).

> Не используй Git LFS для этих файлов: `raw.githubusercontent.com` отдаёт для LFS-файлов текстовый указатель, а не сам образ. Обычный git add / drag-drop — то, что нужно.

---

## Как это работает у пользователя

1. Установщик пробует скачать контейнер **с Docker Hub — до 3 раз** (свежая версия в приоритете).
2. Не вышло → берёт `.tar`: сначала ищет файл рядом со скриптом, потом качает по твоей ссылке `{arch}`, потом (если есть) собирает через podman/docker.
3. Заливает образ на роутер и доустанавливает всё остальное.

Итог: даже при полностью заблокированном Docker Hub установка проходит, пока доступен GitHub (обычно доступен из РФ).

Альтернатива для совсем офлайн-случаев: раздавай нужный `.tar` подписчикам вместе с мастером — они кладут файл в ту же папку, что `setup.ps1`/`setup.sh`, и ссылка не нужна вовсе.

---

## Как обновить зеркало (если автор обновил образ)

На любом ПК/сервере, где открыт Docker Hub (нужен `crane`, `podman` или `docker`):

```bash
# вариант с crane (github.com/google/go-containerregistry)
# ВАЖНО: --format=legacy обязателен! Без него crane делает gzip-слои,
# которые RouterOS НЕ читает ("error getting layer file"). Проверено на живом ax².
img=wiktorbgu/vless-sing-box-tunnel-mikrotik:latest
crane pull --format=legacy --platform linux/arm64  $img vless-container-arm64.tar
crane pull --format=legacy --platform linux/arm/v7 $img vless-container-arm.tar
crane pull --format=legacy --platform linux/amd64  $img vless-container-x86_64.tar

# вариант с podman
podman pull --arch=arm64 docker.io/$img && podman save docker.io/$img -o vless-container-arm64.tar
podman pull --arch=arm   docker.io/$img && podman save docker.io/$img -o vless-container-arm.tar
podman pull --arch=amd64 docker.io/$img && podman save docker.io/$img -o vless-container-x86_64.tar
```

Перезалей файлы в тот же релиз/папку — ссылки не изменятся.
