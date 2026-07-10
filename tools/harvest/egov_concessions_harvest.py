#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
egov_concessions_harvest.py
Слой 1 на концесионния проект: извличане на всички концесионни набори
от data.egov.bg по надлежния ред (публичното API, без api_key).

Етапи:
  1. discover  - енумерира наборите по ключови думи + тагове, дедупликация по uri
  2. fetch     - дърпа съдържанието на всеки ресурс през getResourceData (resumable)
  3. normalize - евристично мапва разнородните общински CSV схеми към единен модел

Употреба:
  python3 egov_concessions_harvest.py discover
  python3 egov_concessions_harvest.py fetch
  python3 egov_concessions_harvest.py normalize
  python3 egov_concessions_harvest.py all

Изход:
  data/datasets.json                       - каталог на откритите набори
  data/raw/{dataset_uri}/{resource_uri}.json - сурови отговори от API-то
  data/normalized/concessions.jsonl        - единен модел, 1 ред = 1 концесия
  data/normalized/unmapped_headers.json    - хедъри, които не са разпознати (за доглеждане)

Rate limit: 60 заявки/мин на IP -> пауза 1.1 s между заявките.
"""

import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests

API = "https://data.egov.bg/api"
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "raw"
NORM_DIR = DATA_DIR / "normalized"

# Ключови думи за discovery. Покриваме и добива, и плажовете, и правописните варианти.
KEYWORDS = [
    "концесии",
    "концесия",
    "концесиите",
    "концесионен",
    "подземни богатства",
    "морски плаж",
    "морски плажове",
]

# Тагове, видени в реалните отговори (762 = "концесии", 3028 = "РМС 436/2017")
TAG_IDS = [762, 3028]

SLEEP = 1.1  # 60 req/min лимит
SESSION = requests.Session()
SESSION.headers.update({"Content-Type": "application/json"})


def api_post(method: str, payload: dict, retries: int = 4) -> dict:
    """POST към API-то с пауза, ретраи и обработка на 429."""
    url = f"{API}/{method}"
    for attempt in range(1, retries + 1):
        try:
            r = SESSION.post(url, json=payload, timeout=60)
            if r.status_code == 429:
                wait = 15 * attempt
                print(f"  [429] rate limit, чакам {wait}s ...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            time.sleep(SLEEP)
            return r.json()
        except (requests.RequestException, json.JSONDecodeError) as e:
            if attempt == retries:
                raise
            wait = 5 * attempt
            print(f"  [!] {method}: {e} - ретрай {attempt}/{retries} след {wait}s")
            time.sleep(wait)
    return {}


# --------------------------------------------------------------------------
# Етап 1: DISCOVER
# --------------------------------------------------------------------------

def discover() -> dict:
    """Събира всички набори по KEYWORDS и TAG_IDS, дедупликация по dataset uri."""
    found: dict[str, dict] = {}

    def harvest(criteria: dict, label: str):
        page = 1
        while True:
            resp = api_post("listDatasets", {
                "records_per_page": 100,
                "page_number": page,
                "criteria": criteria,
            })
            datasets = resp.get("datasets") or []
            total = resp.get("total_records", 0)
            if page == 1:
                print(f"[discover] {label}: {total} набора")
            if not datasets:
                break
            for ds in datasets:
                uri = ds.get("uri")
                if uri and uri not in found:
                    found[uri] = ds
            if page * 100 >= total:
                break
            page += 1

    for kw in KEYWORDS:
        harvest({"keywords": kw, "locale": "bg"}, f'keyword "{kw}"')

    for tag in TAG_IDS:
        harvest({"tag_ids": [tag], "locale": "bg"}, f"tag {tag}")

    # Филтър срещу фалшиви попадения от общото търсене:
    # държим само набори, чието име/описание/таг реално споменава концесии,
    # добив на подземни богатства или морски плажове.
    pat = re.compile(r"концеси|подземни богатства|морски плаж", re.IGNORECASE)

    def relevant(ds: dict) -> bool:
        blob = " ".join([
            ds.get("name") or "",
            ds.get("descript") or "" if isinstance(ds.get("descript"), str) else "",
            " ".join(t.get("name", "") for t in ds.get("tags") or []),
        ])
        return bool(pat.search(blob))

    catalog = {u: d for u, d in found.items() if relevant(d)}
    dropped = len(found) - len(catalog)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / "datasets.json"
    out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), "utf-8")
    print(f"[discover] уникални: {len(found)}, релевантни: {len(catalog)} "
          f"(отпаднали: {dropped}) -> {out}")
    return catalog


# --------------------------------------------------------------------------
# Етап 2: FETCH
# --------------------------------------------------------------------------

def fetch():
    """Дърпа getResourceData за всеки ресурс на всеки набор. Resumable."""
    catalog = json.loads((DATA_DIR / "datasets.json").read_text("utf-8"))
    total_res, done, skipped, failed = 0, 0, 0, []

    for ds_uri, ds in catalog.items():
        resources = ds.get("resource") or {}
        ds_dir = RAW_DIR / ds_uri
        ds_dir.mkdir(parents=True, exist_ok=True)
        # Записваме и метаданните на набора до суровите файлове
        (ds_dir / "_dataset.json").write_text(
            json.dumps(ds, ensure_ascii=False, indent=2), "utf-8")

        for res_uri in resources:
            total_res += 1
            out = ds_dir / f"{res_uri}.json"
            if out.exists():
                skipped += 1
                continue
            try:
                resp = api_post("getResourceData", {"resource_uri": res_uri})
                if not resp.get("success"):
                    # пробваме и с изрична версия 1
                    resp = api_post("getResourceData",
                                    {"resource_uri": res_uri, "version": 1})
                out.write_text(json.dumps(resp, ensure_ascii=False), "utf-8")
                done += 1
                print(f"[fetch] {done}: {ds.get('name', '')[:50]} / {res_uri}")
            except Exception as e:
                failed.append({"dataset": ds_uri, "resource": res_uri, "error": str(e)})
                print(f"[fetch][!] {res_uri}: {e}")

    if failed:
        (DATA_DIR / "fetch_errors.json").write_text(
            json.dumps(failed, ensure_ascii=False, indent=2), "utf-8")
    print(f"[fetch] ресурси: {total_res}, свалени: {done}, "
          f"прескочени (вече налични): {skipped}, грешки: {len(failed)}")


# --------------------------------------------------------------------------
# Етап 3: NORMALIZE
# --------------------------------------------------------------------------

# Канонични полета на единния модел и евристики за разпознаване на хедъри.
# Общинските регистри по РМС 436/2017 имат сходни, но разписани различно колони.
HEADER_MAP = [
    ("row_number",        r"^№|номер по ред|пореден"),
    ("concession_id",     r"идентификац|номер на концеси|партиден"),
    ("decision",          r"решение|заповед|рмс"),
    ("subject",           r"предмет"),
    ("object_description", r"индивидуализация|обект на концеси|описание на обект|местонахожд"),
    ("concessionaire",    r"концесионер"),
    ("eik",               r"еик|булстат"),
    ("term",              r"срок"),
    ("payment",           r"възнаграждение|плащане|концесионно"),
    ("contract_date",     r"дата на скл|сключване|договор от|дата на договор"),
    ("termination",       r"прекрат"),
    ("status",            r"статус|състояние"),
]


def norm_text(s) -> str:
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s))
    return re.sub(r"\s+", " ", s).strip()


def map_headers(headers: list[str]) -> tuple[dict[int, str], list[str]]:
    """Връща {индекс на колона: канонично поле} + неразпознати хедъри."""
    mapping, unmapped = {}, []
    for i, h in enumerate(headers):
        hn = norm_text(h).lower()
        if not hn:
            continue
        for field, pattern in HEADER_MAP:
            if re.search(pattern, hn):
                # първото съвпадение печели; не презаписваме вече заето поле
                if field not in mapping.values():
                    mapping[i] = field
                break
        else:
            unmapped.append(h)
    return mapping, unmapped


def extract_rows(payload) -> list[list]:
    """Намира табличните данни в отговора на getResourceData,
    независимо как точно е вложен масивът (data.rows / data / csvData ...)."""
    def walk(node):
        if isinstance(node, list):
            # масив от масиви = таблица
            if node and all(isinstance(r, list) for r in node):
                return node
            for item in node:
                got = walk(item)
                if got:
                    return got
        elif isinstance(node, dict):
            for v in node.values():
                got = walk(v)
                if got:
                    return got
        return None
    return walk(payload) or []


def parse_payment(raw: str) -> dict:
    """Опит за извличане на числова стойност и валута от свободен текст."""
    t = norm_text(raw)
    m = re.search(r"([\d\s.,]{2,})\s*(лв|лева|bgn|евро|eur|€)?", t, re.IGNORECASE)
    value, currency = None, None
    if m and m.group(1):
        num = m.group(1).replace(" ", "").replace("\u00a0", "")
        # 1 234,56 -> 1234.56 ; 1,234.56 -> 1234.56
        if "," in num and "." in num:
            num = num.replace(",", "") if num.rfind(".") > num.rfind(",") \
                else num.replace(".", "").replace(",", ".")
        elif "," in num:
            num = num.replace(",", ".")
        try:
            value = float(num)
        except ValueError:
            value = None
        cur = (m.group(2) or "").lower()
        if cur:
            currency = "EUR" if cur in ("евро", "eur", "€") else "BGN"
    return {"payment_raw": t or None, "payment_value": value,
            "payment_currency": currency}


def normalize():
    NORM_DIR.mkdir(parents=True, exist_ok=True)
    out_path = NORM_DIR / "concessions.jsonl"
    unmapped_report = {}
    n_rows, n_files = 0, 0

    with out_path.open("w", encoding="utf-8") as out:
        for ds_dir in sorted(RAW_DIR.iterdir()):
            meta_file = ds_dir / "_dataset.json"
            if not meta_file.exists():
                continue
            ds = json.loads(meta_file.read_text("utf-8"))
            org_name = norm_text(ds.get("source") or ds.get("name"))

            for res_file in ds_dir.glob("*.json"):
                if res_file.name == "_dataset.json":
                    continue
                payload = json.loads(res_file.read_text("utf-8"))
                rows = extract_rows(payload)
                if len(rows) < 2:
                    continue
                n_files += 1

                # първият непразен ред приемаме за хедър
                header_idx = next(
                    (i for i, r in enumerate(rows) if any(norm_text(c) for c in r)), 0)
                headers = [norm_text(c) for c in rows[header_idx]]
                mapping, unmapped = map_headers(headers)
                if unmapped:
                    unmapped_report[f"{ds.get('name')} ({res_file.stem})"] = unmapped
                if not mapping:
                    continue

                for r in rows[header_idx + 1:]:
                    if not any(norm_text(c) for c in r):
                        continue
                    rec = {
                        "source": "data.egov.bg",
                        "dataset_uri": ds.get("uri"),
                        "dataset_name": norm_text(ds.get("name")),
                        "resource_uri": res_file.stem,
                        "grantor": org_name,       # концедент (общината/органът)
                        "updated_at": ds.get("updated_at"),
                    }
                    for idx, field in mapping.items():
                        if idx < len(r):
                            rec[field] = norm_text(r[idx]) or None
                    if rec.get("payment"):
                        rec.update(parse_payment(rec["payment"]))
                    # ЕИК от свободния текст на концесионера, ако липсва колона
                    if not rec.get("eik") and rec.get("concessionaire"):
                        m = re.search(r"\b(\d{9}|\d{13})\b", rec["concessionaire"])
                        if m:
                            rec["eik"] = m.group(1)
                    out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    n_rows += 1

    (NORM_DIR / "unmapped_headers.json").write_text(
        json.dumps(unmapped_report, ensure_ascii=False, indent=2), "utf-8")
    print(f"[normalize] файлове с таблици: {n_files}, концесии: {n_rows}")
    print(f"[normalize] -> {out_path}")
    print(f"[normalize] неразпознати хедъри -> {NORM_DIR/'unmapped_headers.json'}")


# --------------------------------------------------------------------------

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("discover", "all"):
        discover()
    if cmd in ("fetch", "all"):
        fetch()
    if cmd in ("normalize", "all"):
        normalize()
