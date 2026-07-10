# VLESS container images for RouterOS

Закреплённые Docker-archive образы sing-box для RouterOS Container. Один и тот
же образ поддерживает VLESS по raw TCP с TLS и Reality.

## Поддержка

- RouterOS 7.18 и новее;
- `arm` (ARMv7), `arm64`, `x86/x86_64`;
- sing-box `1.13.12`, upstream commit
  `1086ab2563320e0da0c23b3a491d8dfa0939dff4`;
- Go `1.26.5`;
- Alpine `3.22.5` с закреплёнными APK и контрольными суммами.

Устройства на EN7562CT требуют ARM32/v5 и этими ARMv7-образами не
поддерживаются.

## Файлы

```text
vless-routeros-1.13.12-arm.tar
vless-routeros-1.13.12-arm64.tar
vless-routeros-1.13.12-x86_64.tar
SHA256SUMS.txt
BUILD-MANIFEST.json
```

Перед ручной загрузкой на роутер проверьте образ:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Мастер может скачать образ автоматически с закреплённого commit URL. Он
использует HTTPS с `check-certificate=yes`, точное имя и точный размер. RouterOS
не предоставляет надёжной SHA-256-проверки больших файлов, поэтому ручная
проверка на компьютере остаётся наиболее строгим вариантом.

## Воспроизводимая сборка

```bash
node build-images.mjs
```

Сборка создаёт from-scratch runtime с одним слоем и встроенным SBOM. В runtime
нет `apk`, APK database, OpenSSL, `ssl_client` и nft-frontends; оставлены только
нужные legacy xtables-модули для TCP/NAT/REDIRECT.

Исходный код sing-box: <https://github.com/SagerNet/sing-box>.
Лицензия sing-box: GPL-3.0-or-later; файл лицензии встроен в каждый образ.
