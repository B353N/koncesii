# Bootstrap harvesters

Еднократните извличачи на суровите данни. Пускат се **ръчно от българско IP** (регистрите
режат datacenter адреси) — виж docs/etl.md и ADR-0002.

```bash
pip install requests beautifulsoup4 lxml
python3 nkr_scraper.py all                 # НКР: export + index + партиди + parse
python3 egov_concessions_harvest.py all    # data.egov.bg: discover + fetch + normalize
```

Резултатите (nkr_data/, data/) НЕ се комитват — качват се в snapshot хранилището на сървъра с датиран префикс.
