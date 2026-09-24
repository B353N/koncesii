# Bootstrap harvesters

Еднократните извличачи на суровите данни. Пускат се **ръчно от българско IP** (регистрите
режат datacenter адреси) — виж docs/etl.md и ADR-0002.

```bash
pip install requests beautifulsoup4 lxml
python3 nkr_scraper.py all                 # НКР: export + index + партиди + parse + files
python3 egov_concessions_harvest.py all    # data.egov.bg: discover + fetch + normalize
```

Етапът `files` сваля прикачените документи (договори, решения) в
`nkr_data/files/{партида}/` с манифест `nkr_data/files.jsonl` (URL на оригинала,
заглавие на линка, тип, размер, sha256). Очакван обем: 3–8 GB; възобновим — вече
свалените се прескачат. Текстът им се вади след това с `pnpm extract` (виж
docs/document-extraction.md).

Резултатите (nkr_data/, data/) НЕ се комитват — качват се в snapshot хранилището на сървъра с датиран префикс.
