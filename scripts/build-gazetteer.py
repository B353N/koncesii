#!/usr/bin/env python3
"""Гради apps/etl/assets/bg-gazetteer.json от GeoNames дъмпа за България.

Употреба:
  curl -sL -o /tmp/BG.zip https://download.geonames.org/export/dump/BG.zip
  unzip -o /tmp/BG.zip -d /tmp
  python3 scripts/build-gazetteer.py /tmp/BG.txt

Данни: GeoNames (https://www.geonames.org), лиценз CC BY 4.0 — атрибуцията
стои на страницата /map. Резултатът е детерминистичен за фиксиран дъмп.
Координатите са центроиди на населени места/общини — приблизителни,
обозначават се като такива в интерфейса.
"""

import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

CYR = re.compile(r"^[Ѐ-ӿ][Ѐ-ӿ\s.‐-―-]*$")
OUT = Path(__file__).resolve().parent.parent / "apps/etl/assets/bg-gazetteer.json"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower().strip()
    return re.sub(r"\s+", " ", s)


def cyrillic_names(alternates: str) -> list[str]:
    out = []
    for cand in alternates.split(","):
        cand = cand.strip()
        if cand and CYR.match(cand):
            out.append(cand)
    return out


def main(src: str) -> None:
    settlements: dict[str, list] = defaultdict(list)
    municipalities: dict[str, list] = defaultdict(list)
    oblasti: dict[str, list] = {}

    rows = [l.rstrip("\n").split("\t") for l in open(src, encoding="utf-8")]

    # области: ADM1 → всички кирилски варианти без префикса „Област"
    # (GeoNames съдържа и правописни варианти; пазим всички за съвпадение)
    for r in rows:
        if r[7] == "ADM1":
            names = cyrillic_names(r[3])
            plain = sorted(
                {n for n in (re.sub(r"^област\s+", "", norm(n)) for n in names) if n}
            )
            if plain:
                oblasti[r[10]] = plain

    for r in rows:
        feature_class, feature_code = r[6], r[7]
        lat, lon, adm1 = round(float(r[4]), 5), round(float(r[5]), 5), r[10]
        names = set(cyrillic_names(r[3]))
        if feature_class == "P":
            for n in names:
                settlements[norm(n)].append([lat, lon, adm1])
        elif feature_code == "ADM2":
            for n in names:
                key = re.sub(r"^(община|обштина)\s+", "", norm(n))
                if key:
                    municipalities[key].append([lat, lon, adm1])

    # дедупликация на еднакви координати за едно име
    dedup = lambda lst: [list(x) for x in sorted({tuple(e) for e in lst})]
    data = {
        "source": "GeoNames (geonames.org), CC BY 4.0",
        "oblasti": dict(sorted(oblasti.items())),
        "settlements": {k: dedup(v) for k, v in sorted(settlements.items())},
        "municipalities": {k: dedup(v) for k, v in sorted(municipalities.items())},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(
        f"области: {len(oblasti)}, населени места: {len(settlements)}, "
        f"общини: {len(municipalities)} → {OUT} ({OUT.stat().st_size // 1024} KB)"
    )


if __name__ == "__main__":
    main(sys.argv[1])
