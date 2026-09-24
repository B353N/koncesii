#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
nkr_scraper.py
Слой 2 на концесионния проект: пълно извличане на НКР (nkr.government.bg).

Етапи:
  export   - опитва вградения CSV експорт (/Concessions/Export?file=csv)
  index    - обхожда списъците (Концесии + Процедури) през GET Search?page=N,
             вади GUID-овете от скритите колони
  details  - за всеки GUID дърпа партидата + всички /Preview/ документи по нея
  parse    - извлича label/value структурата от Preview страниците в JSON
  files    - сваля прикачените документи (договори, решения - PDF/DOC/сканове)
             по всяка партида; текстът им се вади после с `pnpm extract`

Употреба:
  python3 nkr_scraper.py export
  python3 nkr_scraper.py index
  python3 nkr_scraper.py details
  python3 nkr_scraper.py parse
  python3 nkr_scraper.py files
  python3 nkr_scraper.py all

Изход:
  nkr_data/export_concessions.csv       - вграденият експорт (ако мине)
  nkr_data/index/concessions.jsonl      - индекс: 1 ред = 1 партида (GUID + колоните)
  nkr_data/index/procedures.jsonl       - индекс на процедурите
  nkr_data/html/{guid}/partida.html     - сурова партида
  nkr_data/html/{guid}/{doc_guid}.html  - сурови Preview документи
  nkr_data/parsed/{guid}.json           - структурирани данни по партида
  nkr_data/files/{guid}/{file_id}.{ext} - прикачените документи, байт-точни
  nkr_data/files.jsonl                  - манифест: 1 ред = 1 сваляне (URL,
                                          заглавие от линка, тип, размер, sha256)

Зависимости: pip install requests beautifulsoup4 lxml
Учтивост: 1 заявка/сек. Сайтът реже datacenter IP-та - пускай от BG машина.
"""

import csv
import hashlib
import json
import mimetypes
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://nkr.government.bg"
OUT = Path("nkr_data")
HTML_DIR = OUT / "html"
IDX_DIR = OUT / "index"
PARSED_DIR = OUT / "parsed"
FILES_DIR = OUT / "files"
FILES_MANIFEST = OUT / "files.jsonl"

SLEEP = 1.0
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")

# Секциите на регистъра: (име, списъчна страница, search endpoint)
SECTIONS = [
    ("concessions", "/Concessions", "/Concessions/Search"),
    ("procedures", "/ConcessionaireProcedures", "/ConcessionaireProcedures/Search"),
]


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
    })
    # първо GET към началната, за да получим ASP.NET_SessionId
    r = s.get(BASE + "/Concessions", timeout=60,
              headers={"X-Requested-With": ""})
    r.raise_for_status()
    time.sleep(SLEEP)
    return s


def get(s: requests.Session, url: str, **kw) -> requests.Response:
    for attempt in range(1, 5):
        try:
            r = s.get(url, timeout=90, **kw)
            if r.status_code in (429, 503):
                wait = 20 * attempt
                print(f"  [{r.status_code}] чакам {wait}s ...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            time.sleep(SLEEP)
            return r
        except requests.RequestException as e:
            if attempt == 4:
                raise
            print(f"  [!] {url}: {e} - ретрай {attempt}")
            time.sleep(10 * attempt)
    raise RuntimeError(url)


# --------------------------------------------------------------------------
# Етап 0: EXPORT - вграденият CSV
# --------------------------------------------------------------------------

def export():
    OUT.mkdir(parents=True, exist_ok=True)
    s = make_session()
    # Проверено на живо: /Concessions/Export?file=csv връща TSV (tab-separated)
    # в кодировка windows-1251, ~1465 реда / ~512 KB за пълния регистър.
    try:
        r = get(s, f"{BASE}/Concessions/Export?file=csv",
                headers={"X-Requested-With": ""})
        (OUT / "export_concessions_raw.tsv").write_bytes(r.content)
        text = r.content.decode("windows-1251", errors="replace")
        (OUT / "export_concessions.tsv").write_text(text, "utf-8")
        n = len([l for l in text.splitlines() if l.strip()])
        print(f"[export] {n} реда -> export_concessions.tsv (UTF-8, tab-separated)")
    except Exception as e:
        print(f"[export] неуспешен: {e}")


# --------------------------------------------------------------------------
# Етап 1: INDEX - обхождане на списъците
# --------------------------------------------------------------------------

def parse_index_table(html: str) -> tuple[list[dict], int]:
    """Парсва таблицата от Search отговора. Връща (редове, общ брой)."""
    soup = BeautifulSoup(html, "lxml")
    total = 0
    m = re.search(r"Общо:\s*(\d+)", soup.get_text(" "))
    if m:
        total = int(m.group(1))

    rows = []
    table = soup.find("table", class_="tableResults") or soup.find("table")
    if not table or not table.find("tbody"):
        return rows, total

    # хедъри за имена на колоните
    headers = [th.get_text(" ", strip=True) for th in table.select("thead th")]

    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        rec = {}
        for i, td in enumerate(tds):
            classes = td.get("class") or []
            text = td.get_text(" ", strip=True)
            if "IdColumn" in classes and "hiddenColumn" in classes:
                rec["guid"] = text
            elif "TypeIdColumn" in classes:
                rec["type_id"] = text or None
            elif "RelatedLotIdColumn" in classes:
                rec["related_lot_guid"] = text or None
            else:
                key = headers[i] if i < len(headers) and headers[i] else f"col_{i}"
                rec[key] = text or None
        if rec.get("guid"):
            rows.append(rec)
    return rows, total


def index():
    IDX_DIR.mkdir(parents=True, exist_ok=True)
    s = make_session()

    for name, landing, search in SECTIONS:
        out_path = IDX_DIR / f"{name}.jsonl"
        seen: set[str] = set()
        # зареждаме секцията, за да е чиста сесията/филтрите
        try:
            get(s, BASE + landing, headers={"X-Requested-With": ""})
        except Exception as e:
            print(f"[index] {name}: {landing} недостъпен ({e}), прескачам секцията")
            continue

        page, total = 1, None
        with out_path.open("w", encoding="utf-8") as out:
            while True:
                url = f"{BASE}{search}?page={page}&rowsPerPage=100"
                try:
                    r = get(s, url)
                except Exception as e:
                    print(f"[index] {name} стр.{page}: {e}")
                    break
                rows, t = parse_index_table(r.text)
                if total is None and t:
                    total = t
                    print(f"[index] {name}: общо {total}")
                if not rows:
                    break
                new = 0
                for rec in rows:
                    if rec["guid"] in seen:
                        continue
                    seen.add(rec["guid"])
                    rec["_section"] = name
                    out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    new += 1
                print(f"[index] {name} стр.{page}: {len(rows)} реда ({new} нови)")
                if new == 0:  # зацикляне = стигнали сме края
                    break
                if total and len(seen) >= total:
                    break
                page += 1
        print(f"[index] {name}: {len(seen)} записа -> {out_path}")


# --------------------------------------------------------------------------
# Етап 2: DETAILS - партиди + Preview документи
# --------------------------------------------------------------------------

PARTIDA_URL = "/ConcessionaireProcedures/ConcessionaireProcedureInfo/{guid}"
PREVIEW_RE = re.compile(r"/Preview/[A-Za-z]+/[0-9a-f-]{36}", re.IGNORECASE)


def details():
    HTML_DIR.mkdir(parents=True, exist_ok=True)
    s = make_session()

    guids: list[str] = []
    for name, _, _ in SECTIONS:
        p = IDX_DIR / f"{name}.jsonl"
        if p.exists():
            for line in p.read_text("utf-8").splitlines():
                rec = json.loads(line)
                for key in ("guid", "related_lot_guid"):
                    g = rec.get(key)
                    if g and re.fullmatch(r"[0-9a-f-]{36}", g, re.IGNORECASE):
                        guids.append(g)
    guids = list(dict.fromkeys(guids))
    print(f"[details] {len(guids)} уникални GUID-а")

    for n, guid in enumerate(guids, 1):
        gdir = HTML_DIR / guid
        partida_file = gdir / "partida.html"
        if partida_file.exists():
            continue
        gdir.mkdir(parents=True, exist_ok=True)
        try:
            r = get(s, BASE + PARTIDA_URL.format(guid=guid),
                    headers={"X-Requested-With": ""})
            partida_file.write_text(r.text, "utf-8")
        except Exception as e:
            print(f"[details][!] партида {guid}: {e}")
            continue

        # всички Preview документи, реферирани в партидата
        doc_urls = sorted(set(PREVIEW_RE.findall(r.text)))
        for du in doc_urls:
            doc_guid = du.rstrip("/").split("/")[-1]
            doc_kind = du.split("/")[2]  # AssignedConcession, ConcessionProcedure...
            doc_file = gdir / f"{doc_kind}_{doc_guid}.html"
            if doc_file.exists():
                continue
            try:
                dr = get(s, urljoin(BASE, du), headers={"X-Requested-With": ""})
                doc_file.write_text(dr.text, "utf-8")
            except Exception as e:
                print(f"[details][!] {du}: {e}")
        if n % 25 == 0:
            print(f"[details] {n}/{len(guids)}")
    print("[details] готово")


# --------------------------------------------------------------------------
# Етап 3: PARSE - структуриране на Preview страниците
# --------------------------------------------------------------------------

SECTION_NUM_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+(.*)$")


ROMAN_SECTION_RE = re.compile(r"^Раздел\s+([IVX]+)\.\s*(.*)$")


def parse_preview(html: str) -> dict:
    """Вади структурата от Preview страница.
    Проверена на живо структура (AssignedConcession):
      .concession-assignment > .section-content (Раздел I-XI) > .form-group.
    Стойностите вътре са частично номерирани (9.6.1, 9.12.2 ...), затова
    върху текста на всяка секция прилагаме и номерираното разбиване."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    def clean(s: str) -> str:
        return re.sub(r"\s+", " ", s or "").strip()

    def split_numbered(text: str) -> dict:
        """Разбива 'плосък' текст по подточки от вида 9.12.1. Label: value."""
        out = {}
        # вмъкваме разделител преди всяка номерация и режем
        marked = re.sub(r"(?<!\d)(\d{1,2}(?:\.\d{1,2}){1,3})\.\s+", r"\n\1. ", text)
        for chunk in marked.split("\n"):
            chunk = chunk.strip()
            m = re.match(r"^(\d{1,2}(?:\.\d{1,2}){1,3})\.\s+(.*)$", chunk)
            if not m:
                continue
            label, _, value = m.group(2).partition(":")
            out[f"{m.group(1)} {clean(label)}"] = clean(value) or None
        return out

    sections = {}
    containers = soup.select(".section-content")
    if containers:
        for sec in containers:
            head = sec.find(["h1", "h2", "h3", "h4", "h5", "strong", "b"])
            title = clean(head.get_text()) if head else ""
            body_text = clean(sec.get_text(" "))
            if title and body_text.startswith(title):
                body_text = clean(body_text[len(title):])
            m = ROMAN_SECTION_RE.match(title)
            key = f"{m.group(1)} {m.group(2).rstrip(':')}" if m else (title or "untitled")
            entry = {"text": body_text}
            numbered = split_numbered(body_text)
            if numbered:
                entry["items"] = numbered
            # form-group стойности за секции без номерация (Раздел VI - концесионер)
            groups = [clean(fg.get_text(" ")) for fg in sec.select(".form-group")]
            groups = [g for g in groups if g]
            if groups and not numbered:
                entry["groups"] = groups
            sections[key] = entry
    else:
        # fallback: генерично номерирано разбиване върху целия текст
        sections["_flat"] = {"items": split_numbered(clean(soup.get_text(" ")))}

    return {"sections": sections}


def parse():
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    for gdir in sorted(HTML_DIR.iterdir()):
        if not gdir.is_dir():
            continue
        out_file = PARSED_DIR / f"{gdir.name}.json"
        if out_file.exists():
            continue
        result = {"guid": gdir.name, "documents": {}}
        for f in gdir.glob("*.html"):
            html = f.read_text("utf-8", errors="replace")
            if f.name == "partida.html":
                soup = BeautifulSoup(html, "lxml")
                title = soup.find(string=re.compile(r"партида на концесия"))
                result["partida_title"] = title.strip() if title else None
                # линкове към файлове по партидата (договори и пр.)
                # проверено: договорите са на /File/Download/{guid}
                result["file_links"] = sorted(set(
                    a.get("href") for a in soup.find_all("a", href=True)
                    if "/File/Download" in a["href"]
                    or "/Content/Download" in a["href"]))
            else:
                result["documents"][f.stem] = parse_preview(html)
        out_file.write_text(json.dumps(result, ensure_ascii=False, indent=1), "utf-8")
        count += 1
        if count % 50 == 0:
            print(f"[parse] {count}")
    print(f"[parse] структурирани партиди: {count} -> {PARSED_DIR}")


# --------------------------------------------------------------------------
# Етап 4: FILES - прикачените документи (docs/document-extraction.md, E1)
# --------------------------------------------------------------------------

FILE_LINK_RE = re.compile(r"/(File|Content)/Download", re.IGNORECASE)
GUID_TAIL_RE = re.compile(r"/File/Download/([0-9a-f-]{36})", re.IGNORECASE)

# Разширение по Content-Type, когато сървърът не подаде име на файл.
EXT_BY_TYPE = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/rtf": ".rtf",
    "text/rtf": ".rtf",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/tiff": ".tif",
}


def partida_file_links(html: str) -> list[dict]:
    """Линковете към файлове в партидата, с текста на линка като заглавие.
    Същото правило като parsePartida в packages/ingest."""
    soup = BeautifulSoup(html, "lxml")
    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not FILE_LINK_RE.search(href) or href in seen:
            continue
        seen.add(href)
        title = re.sub(r"\s+", " ", a.get_text(" ")).strip() or None
        out.append({"href": href, "title": title})
    return sorted(out, key=lambda r: r["href"])


def file_id(href: str) -> str:
    """Стабилно име на файла: GUID-ът на НКР, иначе хеш на адреса."""
    m = GUID_TAIL_RE.search(href)
    if m:
        return m.group(1).lower()
    return hashlib.sha1(href.encode("utf-8")).hexdigest()[:20]


def disposition_filename(header: str | None) -> str | None:
    """Името от Content-Disposition, вкл. RFC 5987 (filename*=UTF-8''...)."""
    if not header:
        return None
    m = re.search(r"filename\*\s*=\s*([^']*)'[^']*'([^;]+)", header, re.IGNORECASE)
    if m:
        try:
            return unquote(m.group(2).strip().strip('"'), encoding=m.group(1) or "utf-8")
        except LookupError:
            return unquote(m.group(2).strip().strip('"'))
    m = re.search(r'filename\s*=\s*"?([^";]+)"?', header, re.IGNORECASE)
    if not m:
        return None
    name = m.group(1).strip()
    # ASP.NET понякога праща кирилицата като latin-1 байтове
    try:
        name = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return name


def file_ext(filename: str | None, content_type: str | None, head: bytes) -> str:
    if filename:
        suffix = Path(filename).suffix.lower()
        if re.fullmatch(r"\.[a-z0-9]{1,5}", suffix):
            return suffix
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in EXT_BY_TYPE:
        return EXT_BY_TYPE[ctype]
    if head.startswith(b"%PDF"):
        return ".pdf"
    return mimetypes.guess_extension(ctype) or ".bin"


def load_manifest() -> dict[tuple[str, str], dict]:
    """(партида, href) → последният запис. Манифестът е append-only."""
    done: dict[tuple[str, str], dict] = {}
    if FILES_MANIFEST.exists():
        for line in FILES_MANIFEST.read_text("utf-8").splitlines():
            if line.strip():
                rec = json.loads(line)
                done[(rec["lot_guid"], rec["href"])] = rec
    return done


def download_file(s: requests.Session, lot_guid: str, link: dict) -> dict:
    href = link["href"]
    url = urljoin(BASE, href)
    rec = {
        "lot_guid": lot_guid,
        "href": href,
        "url": url,
        "title": link["title"],
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    lot_dir = FILES_DIR / lot_guid
    lot_dir.mkdir(parents=True, exist_ok=True)
    fid = file_id(href)
    part = lot_dir / f"{fid}.part"
    for attempt in range(1, 5):
        try:
            with s.get(url, timeout=180, stream=True,
                       headers={"X-Requested-With": ""}) as r:
                if r.status_code in (429, 503):
                    time.sleep(20 * attempt)
                    continue
                if r.status_code >= 400:
                    rec.update(status="error", error=f"HTTP {r.status_code}")
                    time.sleep(SLEEP)
                    return rec
                sha = hashlib.sha256()
                size = 0
                head = b""
                with part.open("wb") as out:
                    for chunk in r.iter_content(chunk_size=1 << 16):
                        if not chunk:
                            continue
                        if len(head) < 16:
                            head += chunk[:16]
                        sha.update(chunk)
                        size += len(chunk)
                        out.write(chunk)
                filename = disposition_filename(r.headers.get("Content-Disposition"))
                ctype = r.headers.get("Content-Type")
            ext = file_ext(filename, ctype, head)
            final = lot_dir / f"{fid}{ext}"
            part.replace(final)
            rec.update(
                status="ok",
                file=final.relative_to(OUT).as_posix(),
                filename=filename,
                content_type=ctype,
                size=size,
                sha256=sha.hexdigest(),
            )
            time.sleep(SLEEP)
            return rec
        except requests.RequestException as e:
            if attempt == 4:
                rec.update(status="error", error=str(e)[:300])
                return rec
            print(f"  [!] {url}: {e} - ретрай {attempt}")
            time.sleep(10 * attempt)
    rec.update(status="error", error="retries exhausted")
    return rec


def files():
    """Сваля всеки /File/Download и /Content/Download от партидите.
    Възобновимо: успешно свалените (по манифеста и на диска) се прескачат,
    грешките се опитват отново при следващото пускане."""
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    done = load_manifest()
    todo: list[tuple[str, dict]] = []
    for gdir in sorted(HTML_DIR.iterdir()) if HTML_DIR.exists() else []:
        partida = gdir / "partida.html"
        if not gdir.is_dir() or not partida.exists():
            continue
        for link in partida_file_links(partida.read_text("utf-8", errors="replace")):
            prev = done.get((gdir.name, link["href"]))
            if prev and prev.get("status") == "ok" and (OUT / prev["file"]).exists():
                continue
            todo.append((gdir.name, link))
    print(f"[files] за сваляне: {len(todo)} (вече свалени: "
          f"{sum(1 for r in done.values() if r.get('status') == 'ok')})")
    if not todo:
        return

    s = make_session()
    ok = err = 0
    with FILES_MANIFEST.open("a", encoding="utf-8") as manifest:
        for n, (lot_guid, link) in enumerate(todo, 1):
            rec = download_file(s, lot_guid, link)
            manifest.write(json.dumps(rec, ensure_ascii=False) + "\n")
            manifest.flush()
            if rec["status"] == "ok":
                ok += 1
            else:
                err += 1
                print(f"[files][!] {rec['url']}: {rec.get('error')}")
            if n % 25 == 0:
                print(f"[files] {n}/{len(todo)}")
    print(f"[files] готово: {ok} свалени, {err} грешки -> {FILES_DIR}")


# --------------------------------------------------------------------------

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    STAGES = ("export", "index", "details", "parse", "files", "all")
    if cmd not in STAGES:
        # непознат етап не бива да минава тихо, без да направи нищо
        sys.exit(f"непознат етап „{cmd}“; възможни: {', '.join(STAGES)}")
    if cmd in ("export", "all"):
        export()
    if cmd in ("index", "all"):
        index()
    if cmd in ("details", "all"):
        details()
    if cmd in ("parse", "all"):
        parse()
    if cmd in ("files", "all"):
        files()
