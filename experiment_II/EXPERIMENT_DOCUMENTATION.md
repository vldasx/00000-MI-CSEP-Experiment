# CSEP Experiment — Kompletna dokumentacija
*Datum: 2026-04-27 | Autor: Vladimir Miletin*

---

## 1. Sta je ovaj eksperiment?

Eksperiment ispituje efikasnost **CSEP (Conceptual Space Expansion Prompting)** metode u poredjenju sa standardnim pristupima (zero-shot i Chain-of-Thought) na zadacima koji testiraju razlicite kognitivne sposobnosti malih jezickih modela.

### Cetiri eksperimentalna uslova

| Uslov | Naziv | Opis |
|---|---|---|
| 1 | zero_shot | Direktno pitanje, bez posebnog prompta |
| 2 | cot | Chain-of-Thought: 3 nezavisna prolaza + sinteza |
| 3 | csep_only | CSEP pipeline bez konteksta prethodnog odgovora |
| 4 | csep_plus_zeroshot | CSEP pipeline uz zero-shot odgovor kao pocetni kontekst |

### CSEP pipeline (4 koraka)
1. **Classify** — model klasifikuje tip problema
2. **Decompose** — razlaze problem na pod-koncepte
3. **Reintegrate** — sintetizuje odgovor iz pod-koncepata
4. **Polish** — finalizuje i precizira odgovor

### CoT pipeline (3 koraka)
1. **Pass 1, 2, 3** — tri nezavisna odgovora na isto pitanje
2. **Synthesis** — sintetizuje finalni odgovor iz sva tri prolaza

---

## 2. Modeli koji se testiraju

| Naziv | OpenRouter ID |
|---|---|
| Ministral 8B (Dec-25) | mistralai/ministral-8b-2512 |
| Llama 3.1 8B Instruct | meta-llama/llama-3.1-8b-instruct |
| Gemma 3 12B IT | google/gemma-3-12b-it |
| Qwen 2.5 7B Instruct | qwen/qwen-2.5-7b-instruct |
| Phi-4 (14B) | microsoft/phi-4 |

---

## 3. Skup pitanja

**Ukupno: 322 pitanja** u 20 kategorija, podijeljenih u dva izvora:

- **Generated** (generisana za ovaj eksperiment): apstraktne analogije, matematika, logicko rezonovanje, itd.
- **Known failure** (iz literature — poznati primjeri gdje LLM-i greše): fabricated entities, false premise, itd.

### 20 kategorija pitanja

| Kategorija | Opis |
|---|---|
| 1_abstract_analogies | Apstraktne analogije |
| 2_fabricated_entities | Izmisljeni entiteti (treba odbiti pitanje) |
| 3_math_with_distractors | Matematika s distraktorima |
| 4_multi_step_reasoning | Visekoracno rezonovanje |
| 5_temporal_reasoning | Temporalno rezonovanje |
| 6_false_premise | Lazna premisa (treba ispraviti) |
| 7_hidden_contradictions | Skrivene kontradikcije |
| 8_confidence_calibration | Kalibracija samopouzdanja |
| 9_open_ended_hallucination_prone | Otvorena pitanja sklona halucinaciji |
| 10_consistency_under_reframing | Konzistentnost pod preformulacijom |
| 11_spatial_reasoning | Prostorno rezonovanje |
| 12_counting_and_basic_arithmetic | Brojanje i osnovna aritmetika |
| 13_aiw_relational_puzzles | Relacione zagonetke (Alice in Wonderland stil) |
| 14_modified_classic_puzzles | Modifikovane klasicne zagonetke |
| 15_distractor_injection | Injekcija distrakcija |
| 16_logical_inference | Logicko zakljucivanje |
| 17_self_reference_paradox | Samoreferentni paradoksi |
| 18_hallucination_fabrication | Fabriciranje citata/izvora |
| 19_linguistic_constraint | Jezicka ogranicenja |
| 20_adversarial_pressure | Adversarni pritisak (model treba odrzati stav) |

**Ukupno zapisa: 322 pitanja × 4 uslova × 5 modela = 6440**

---

## 4. Kako pokrenuti eksperiment

### Preduslovi

- Python 3.10+ (instalirano)
- API kljuc za OpenRouter (pohranjen u `open_router_api.json`)
- Telegram bot token (pohranjen u `telegram_config.json`) — opciono, za pracenje

### Pokretanje

```bash
cd "G:\Meine Ablage\0000 PAPER\00000 MI CSEP Experiment\00000 Active Experiment"
python main.py
```

**Eksperiment se automatski nastavlja** od mjesta gdje je stao — provjerava `results/results.json` i preskace vec uradjene (model, pitanje, uslov) trojke.

### Samo analiza (bez pokretanja eksperimenta)

```bash
python main.py --analysis
```

### Pracenje napretka

Telegram bot odgovara na komande:
- `/status` — trenutni napredak
- `/tokens` — statistika tokena i cijena
- `/stop` — gracefulno zaustavljanje (ceka kraj trenutnog pitanja)

---

## 5. Struktura fajlova

```
00000 Active Experiment/
│
├── main.py                          # Entry point — pokretanje eksperimenta
├── config.py                        # Konfiguracija: modeli, putanje, parametre
├── experiment_runner.py             # Glavni loop eksperimenta
├── api_client.py                    # OpenRouter API pozivi s retry logicom
├── cot_runner.py                    # Chain-of-Thought pipeline
├── csep_runner.py                   # CSEP pipeline (4 koraka)
├── checkpoint.py                    # Cuvanje i ucitavanje checkpointa
├── analysis.py                      # Automatsko scoriranje i statistika
├── telegram_notifier.py             # Telegram bot za pracenje
│
├── open_router_api.json             # *** API kljuc (ne dijeliti!) ***
├── telegram_config.json             # Telegram bot token i chat_id
│
├── final_generated prompts.json     # 280 generisanih pitanja po kategorijama
├── final_known_failure_prompts.json # 42 pitanja iz literature
│
├── experiment_log.txt               # Live log svega sto se desava
│
├── results/
│   ├── results.json                 # *** GLAVNI FAJL SA REZULTATIMA ***
│   ├── checkpoint_YYYYMMDD_HHMMSS.json  # Automatski checkpointi (max 5)
│
└── analysis/
    ├── analysis_report.json         # Statisticki izvjestaj (generise analysis.py)
    ├── manual_review.json           # Zapisi koji trebaju manualnu ocjenu
    └── graphs/
        ├── 1_overall_by_condition.png
        ├── 2_by_model_and_condition.png
        ├── 3_category_heatmap.png
        ├── 4_csep_improvement.png
        └── 5_per_model_range.png
```

---

## 6. Format podataka — results.json

`results/results.json` je JSON lista. Svaki element je jedan eksperimentalni zapis.

### Struktura jednog zapisa

```json
{
  "model_id": "mistralai/ministral-8b-2512",
  "model_name": "Ministral 8B (Dec-25)",
  "source": "generated",
  "category": "1_abstract_analogies",
  "question_id": "1.1",
  "base_id": "1.1",
  "question": "If a library is to books as a museum is to ___, ...",
  "framing": null,
  "expected": "Artifacts / exhibits / displays...",
  "metric": "Binary on correctness...",
  "extra": {},
  "condition": 1,
  "condition_name": "zero_shot",
  "timestamp": "2026-04-26T19:27:15.727914",
  "response": "The blank should be filled with artifacts...",
  "intermediate": {},
  "error": null,
  "prompt_sent": "Answer the following question:\n\n..."
}
```

### Opis polja

| Polje | Tip | Opis |
|---|---|---|
| model_id | string | OpenRouter ID modela |
| model_name | string | Citljiv naziv modela |
| source | string | "generated" ili "known_failure" |
| category | string | Jedna od 20 kategorija (npr. "3_math_with_distractors") |
| question_id | string | Jedinstveni ID pitanja (npr. "3.5") |
| base_id | string | Za reframing par: isti base_id za oba framinga |
| question | string | Tekst pitanja |
| framing | string ili null | "a" ili "b" za kategoriju 10, inace null |
| expected | string | Ocekivani/tacni odgovor ili kriterij |
| metric | string | Opis kako se mjeri tacnost |
| extra | object | Dodatni metapodaci specificni za kategoriju |
| condition | int | 1=zero_shot, 2=cot, 3=csep_only, 4=csep_plus_zeroshot |
| condition_name | string | Naziv uslova |
| timestamp | string | ISO 8601 timestamp |
| response | string | Finalni odgovor modela |
| intermediate | object | Medjukoraci (vidi ispod) |
| error | string ili null | Poruka greske ako je doslo do greske |
| prompt_sent | string | Tacni prompt poslan modelu (samo za condition=1) |

### Polje "intermediate" — medjukoraci

**Za CoT (condition=2):**
```json
{
  "pass1": "Prvi nezavisni odgovor...",
  "pass2": "Drugi nezavisni odgovor...",
  "pass3": "Treci nezavisni odgovor...",
  "synthesis": "Sintetizovani odgovor...",
  "final_response": "Isti kao synthesis"
}
```

**Za CSEP (condition=3 i 4):**
```json
{
  "class_output": "Klasifikacija tipa problema...",
  "decomp_output": "Dekompozicija na pod-koncepte...",
  "reintegration_output": "Reintegracija odgovora...",
  "polish_output": "Poliran finalni odgovor...",
  "main_concept": "Glavni koncept identifikovan u koraku 1",
  "final_response": "Isti kao polish_output"
}
```

---

## 7. Kako procesirati rezultate

### Ucitavanje u Python

```python
import json

with open("results/results.json", encoding="utf-8") as f:
    results = json.load(f)

# Svaki rezultat je dict
for r in results:
    model    = r["model_id"]
    category = r["category"]
    condition = r["condition"]   # 1, 2, 3 ili 4
    response = r["response"]
    expected = r["expected"]
    error    = r["error"]        # None ako je OK
```

### Filtriranje

```python
# Samo uspjesni zapisi (bez gresaka)
ok = [r for r in results if not r["error"]]

# Specificni model
ministral = [r for r in results if r["model_id"] == "mistralai/ministral-8b-2512"]

# Specificna kategorija
math = [r for r in results if r["category"] == "3_math_with_distractors"]

# Specificni uslov
zero_shot = [r for r in results if r["condition"] == 1]

# Kombinacija: Ministral, matematika, CoT
subset = [r for r in results
          if r["model_id"] == "mistralai/ministral-8b-2512"
          and r["category"] == "3_math_with_distractors"
          and r["condition"] == 2]
```

### Provjera konzistentnosti (kategorija 10)

Kategorija `10_consistency_under_reframing` ima parove pitanja. Svako pitanje dolazi u dvije verzije (framing "a" i "b") s istim `base_id`:

```python
# Grupisanje parova
pairs = {}
for r in results:
    if r["category"] == "10_consistency_under_reframing":
        key = (r["model_id"], r["base_id"], r["condition"])
        pairs.setdefault(key, []).append(r)

# Provjera konzistentnosti para
for key, pair in pairs.items():
    if len(pair) == 2:
        resp_a = pair[0]["response"]
        resp_b = pair[1]["response"]
        # Uporedjivanje odgovora...
```

### Pristup medjukoracima

```python
# Pristup CoT prolazima
cot_record = next(r for r in results if r["condition"] == 2 and r["intermediate"])
print(cot_record["intermediate"]["pass1"])
print(cot_record["intermediate"]["synthesis"])

# Pristup CSEP koracima
csep_record = next(r for r in results if r["condition"] == 3 and r["intermediate"])
print(csep_record["intermediate"]["class_output"])
print(csep_record["intermediate"]["decomp_output"])
print(csep_record["intermediate"]["final_response"])
```

---

## 8. Automatsko scoriranje

`python main.py --analysis` generise `analysis/analysis_report.json` koji sadrzi:

```json
{
  "statistics": {
    "by_model_and_condition": {
      "mistralai/ministral-8b-2512": {
        "1": {"mean": 0.717, "n": 113},
        "2": {"mean": 0.743, "n": 113},
        "3": {"mean": 0.620, "n": 113},
        "4": {"mean": 0.681, "n": 113}
      }
    },
    "by_category_and_condition": {
      "3_math_with_distractors": {
        "1": {"mean": 0.725, "n": 40},
        ...
      }
    }
  }
}
```

### Kategorije koje se auto-scoriraju

| Kategorija | Metoda scoriranja |
|---|---|
| 2_fabricated_entities | Regex: kljucne rijeci odbijanja ("I cannot", "does not exist"...) |
| 3_math_with_distractors | Regex: ekstraktuje broj iz odgovora i poredi s tacnim |
| 6_false_premise | Regex: kljucne rijeci ispravke ("actually", "incorrect", "false"...) |
| 8_confidence_calibration | Regex: kljucne rijeci nesigurnosti ("uncertain", "unknown"...) |
| 12_counting_and_basic_arithmetic | Regex: broj u odgovoru |
| 13_aiw_relational_puzzles | Regex: ocekivani odgovor u tekstu |
| 15_distractor_injection | Regex: ocekivani odgovor u tekstu |
| 18_hallucination_fabrication | Regex: kljucne rijeci odbijanja |

### Kategorije koje trebaju manualnu ocjenu

Sve ostale kategorije (1, 4, 5, 7, 9, 10, 11, 14, 16, 17, 19, 20) zahtijevaju:
- Semanticko poredjenje odgovora s ocekivanim
- Ili LLM-as-judge pristup
- Ili manualnu ocjenu

`analysis/manual_review.json` sadrzi sve te zapise.

---

## 9. Trenutno stanje eksperimenta (2026-04-27)

| | |
|---|---|
| Ukupno planiranih zapisa | 6440 |
| Kompletiranih zapisa | ~1902 |
| Progres | ~29.5% |
| Kompletni modeli | Ministral 8B (100%) |
| Parcijalni modeli | Llama 3.1 8B (~Q149/322) |
| Preostali modeli | Gemma 3 12B, Qwen 2.5 7B, Phi-4 |
| Ukupni API pozivi | ~5940 |
| Ukupni tokeni | ~10.3M |
| Procijenjeni trosak | ~$1.32 USD |

### Kako nastaviti eksperiment

Samo pokrenuti `python main.py` — eksperiment ce sam detektovati gdje je stao i nastaviti od tog mjesta. Nema potrebe za nikakvim parametrima.

---

## 10. Rani rezultati (parcijalni — samo 2/5 modela)

### Ukupno po uslovu (auto-scored)
| Uslov | Skor |
|---|---|
| Zero-shot | 0.720 |
| CoT | 0.736 |
| CSEP | 0.632 |
| CSEP + ZS | 0.652 |

### Kljucni nalazi

**CSEP pomaze kod:** adversarial pressure, temporal reasoning, multi-step reasoning

**CSEP skodi kod:** fabricated entities (−40pp!), hallucination fabrication (pada na 0.00)

**CoT pomaze kod:** matematika (+17pp vs ZS), detekcija kontradikcija (+40pp vs ZS)

**Svi loše:** open-ended hallucination, self-reference paradoxes — mali modeli ne znaju da kazu "ne znam"

---

*Eksperiment pokrenut: 2026-04-26 | Zaustavljen: 2026-04-27 20:46 UTC*
*Za pitanja: Vladimir Miletin*
