# Деплой — runbook

Как koncesii.com стига до продъкшън и как се публикуват данните. Архитектурното
решение е [ADR-0005](adr/0005-selfhosted-coolify.md): всичко работи на собствения
сървър, управляван с Coolify.

## Топология

| Компонент         | Къде                                                               |
| ----------------- | ------------------------------------------------------------------ |
| Приложението      | Coolify app `koncesii` — Node SSR контейнер (nixpacks билд)        |
| Базата            | `/data/koncesii/koncesii.sqlite` на хоста, mount-ната в контейнера |
| Суровите снапшоти | `/data/koncesii/snapshots/ГГГГ-ММ-ДД/` на хоста                    |
| DNS               | koncesii.com → Cloudflare proxy → сървъра (Traefik, Let's Encrypt) |

## Деплой на кода

Билд стъпките са фиксирани в [`nixpacks.toml`](../nixpacks.toml): инсталацията е
`pnpm install --frozen-lockfile --prod=false`, защото Coolify подава
`NPM_CONFIG_PRODUCTION=true` и иначе pnpm прескача dev пакетите, нужни за билда.

**Мърдж към `main` = деплой.** GitHub webhook задейства Coolify, който билдва
(nixpacks: `pnpm i --frozen-lockfile` → `pnpm build` → `pnpm start`) и подменя
контейнера. `main` е защитен: промени влизат само през PR със зелен CI.

Конфигурация на приложението в Coolify (вече зададена; тук за възстановяване):

| Настройка          | Стойност                                                  |
| ------------------ | --------------------------------------------------------- |
| Build pack         | nixpacks, base directory `/`                              |
| Port               | 3000                                                      |
| Env (buildtime)    | `NIXPACKS_NODE_VERSION=22`                                |
| Env (runtime)      | `PORT=3000`, `KONCESII_DB=/data/koncesii/koncesii.sqlite` |
| Persistent storage | host `/data/koncesii` → container `/data/koncesii`        |

Без база приложението работи и показва „Данните се подготвят" — липсата на данни
никога не е грешка 500.

## Публикуване на данните

Извличането върви **от машина с българско IP** (регистрите режат datacenter
адреси; сървърът не скрейпва никога). Пълният цикъл:

```bash
# 1. Harvest (часове; учтиво: 1 заявка/сек, resumable) — вкл. прикачените документи
cd tools/harvest
.venv/bin/python nkr_scraper.py all
.venv/bin/python egov_concessions_harvest.py all

# 2. Текстът на документите (локално; OCR за сканираните — часове при първото пускане)
cd ../..
pnpm extract --local "$PWD/tools/harvest"

# 3. Снапшотът отива на сървъра (идемпотентно, immutable датиран префикс)
pnpm harvest:upload --date ГГГГ-ММ-ДД

# 4. Билд на базата + integrity отчет (детерминистично)
pnpm ingest --snapshot ГГГГ-ММ-ДД     # или --local tools/harvest --date …

# 5. Публикуване: проверка на отчета → sha256 сверка → атомарна подмяна
pnpm db:push
```

Инструментите за стъпка 2 се слагат веднъж: `brew install poppler tesseract
tesseract-lang` и `brew install --cask libreoffice` (Word/RTF документите). Без
tesseract сканираните страници остават без текст и се опитват отново при следващото
пускане.

Или накратко, целият цикъл в една команда (същите пет стъпки, с лог в
`build/refresh-ГГГГ-ММ-ДД.log`):

```bash
pnpm refresh                      # днешна дата; --skip-harvest пропуска стъпка 1,
                                  # --skip-extract - стъпка 2
```

Сайтът засича новия файл без рестарт. Rollback: предишният `koncesii.sqlite`
се пази като `.bak` на сървъра преди подмяна (или се ребилдва от който и да е
снапшот — всяка версия е възпроизводима).

### Седмично обновяване

Harvest-ът **не може** да върви на сървъра: регистрите режат datacenter адреси,
затова цикълът се пуска от машина на поддържащия, с българско IP. На macOS —
launchd агент, който буди `pnpm refresh` всяка неделя в 03:00:

```xml
<!-- ~/Library/LaunchAgents/com.koncesii.refresh.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.koncesii.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd ~/Claude/Projects/koncesii &amp;&amp; pnpm refresh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>3</integer></dict>
  <key>RunAtLoad</key><false/>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.koncesii.refresh.plist
```

Защо седмично: регистрите се менят бавно, а обхождането е учтиво (1 заявка/сек,
часове). По-често не носи нови данни, но товари чужда инфраструктура.

След публикуване `db:push` известява IndexNow (Bing, Yandex, Seznam) за
променените адреси. Ключът е публичен по проектиране: това е файлът
`apps/web/public/<ключ>.txt`, чието име е самият ключ - търсачката го чете
оттам, за да провери, че известието идва от домейна. Затова стои като статичен
файл, а не в кода, където изглежда като изтекла тайна и вдига секрет-скенера.
`KONCESII_INDEXNOW_KEY` го замества, ако е зададен. Google няма такъв механизъм — за него работи `lastmod` в
sitemap-а, който идва от `changed_at` (виж [`etl.md`](etl.md)).

## Достъп и тайни

- SSH: конфигуриран хост (`ssh imprya` в `~/.ssh/config` на maintainer-а);
  override през env `KONCESII_SSH_HOST`. Пътят до базата: `KONCESII_DB_PATH`.
- В репото няма тайни; `.env*` е в `.gitignore`, CI пуска gitleaks на всеки push.
- Coolify API токенът и SSH ключовете живеят само при maintainer-а.

## Първи деплой от нулата (нов сървър)

1. Coolify: нова application от GitHub репото (`B353N/koncesii`, branch `main`),
   nixpacks, порт 3000, env + persistent storage по таблицата горе.
2. `ssh сървъра "mkdir -p /data/koncesii/snapshots"`.
3. Домейн + TLS в Coolify (Traefik/Let's Encrypt или Cloudflare proxy).
4. Мърдж/redeploy → сайтът е горе в режим „Данните се подготвят".
5. Цикълът „Публикуване на данните" по-горе → живи данни.

## Проверка след деплой

```bash
curl -s -o /dev/null -w "%{http_code}" https://koncesii.com/          # 200
curl -s https://koncesii.com/sitemap.xml | head -3                     # sitemapindex
curl -s https://koncesii.com/sitemap-concessions.xml | grep -c "<loc>"  # брой партиди
curl -sI https://koncesii.com/ | grep -i content-security-policy      # строг CSP
```
