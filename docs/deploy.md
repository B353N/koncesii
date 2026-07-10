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
# 1. Harvest (часове; учтиво: 1 заявка/сек, resumable)
cd tools/harvest
.venv/bin/python nkr_scraper.py all
.venv/bin/python egov_concessions_harvest.py all

# 2. Снапшотът отива на сървъра (идемпотентно, immutable датиран префикс)
pnpm harvest:upload --date ГГГГ-ММ-ДД

# 3. Билд на базата + integrity отчет (детерминистично)
pnpm ingest --snapshot ГГГГ-ММ-ДД     # или --local tools/harvest --date …

# 4. Публикуване: проверка на отчета → sha256 сверка → атомарна подмяна
pnpm db:push
```

Сайтът засича новия файл без рестарт. Rollback: предишният `koncesii.sqlite`
се пази като `.bak` на сървъра преди подмяна (или се ребилдва от който и да е
снапшот — всяка версия е възпроизводима).

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
curl -s https://koncesii.com/sitemap.xml | head -3                     # urlset
curl -sI https://koncesii.com/ | grep -i content-security-policy      # строг CSP
```
