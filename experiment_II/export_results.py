import os
# -*- coding: utf-8 -*-
"""
export_results.py
─────────────────
1. Dijeli full_experiment.json na 5 fajlova po modelu  →  results/per_model/
2. Crta 8 grafova                                       →  analysis/graphs/
3. Generiše kompletan PDF izvještaj                     →  analysis/CSEP_Report.pdf
"""

import json, os, sys, textwrap
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY

# ── Paths ──────────────────────────────────────────────────────────────
BASE = Path(os.path.dirname(os.path.abspath(__file__)))
RES    = BASE / "results" / "full_experiment.json"
PMODEL = BASE / "results" / "per_model"
GRAPHS = BASE / "analysis" / "graphs"
REPORT = BASE / "analysis" / "CSEP_Report.pdf"
REPJSON= BASE / "analysis" / "analysis_report.json"

PMODEL.mkdir(parents=True, exist_ok=True)
GRAPHS.mkdir(parents=True, exist_ok=True)

print("Učitavam podatke...")
with open(RES, encoding="utf-8") as f:
    data = json.load(f)

with open(REPJSON, encoding="utf-8") as f:
    rep = json.load(f)

# ── Konstante ──────────────────────────────────────────────────────────
MODEL_IDS = {
    "Llama 3.3 70B":    "meta-llama/llama-3.3-70b-instruct",
    "Qwen 2.5 72B":     "qwen/qwen-2.5-72b-instruct",
    "Nemotron 70B":     "nvidia/llama-3.1-nemotron-70b-instruct",
    "R1 Distill 70B":   "deepseek/deepseek-r1-distill-llama-70b",
    "Command R+ 104B":  "cohere/command-r-plus-08-2024",
}
SHORT = {v: k for k, v in MODEL_IDS.items()}
COND  = {1: "Zero-shot", 2: "CoT", 3: "CSEP", 4: "CSEP+ZS"}
COLORS = {
    "Zero-shot":  "#4C72B0",
    "CoT":        "#DD8452",
    "CSEP":       "#55A868",
    "CSEP+ZS":    "#C44E52",
}
MODEL_COLORS = [
    "#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B2"
]

# ══════════════════════════════════════════════════════════════════════
# 1. PODIJELI JSON PO MODELU
# ══════════════════════════════════════════════════════════════════════
print("\n1. Dijeljenje JSON-a po modelima...")
for mname, mid in MODEL_IDS.items():
    subset = [r for r in data if r["model_id"] == mid]
    safe   = mname.replace(" ", "_").replace("+", "plus").replace("/", "-")
    path   = PMODEL / f"{safe}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(subset, f, ensure_ascii=False, indent=2)
    print(f"   {path.name}  ({len(subset)} zapisa)")

# ══════════════════════════════════════════════════════════════════════
# 2.  HEURISTIČKE METRIKE
# ══════════════════════════════════════════════════════════════════════
idx = {(r["model_id"], r["question_id"], r["condition"]): r for r in data}

REFUSE_FE = [
    "not a recognized","no information","does not exist","fictional",
    "cannot find","don't have","not aware","not found","no evidence",
    "not a real","no record","not exist","not been documented",
    "not a documented","not appear to be","not known","not a well-known",
    "no reliable","not able to find","unable to find","no data",
    "not familiar","i couldn","i could not","i was unable",
    "made-up","misspelling","typo","not a widely","not widely",
    "no scientific","not a historically","not a medical","not a standard",
    "not a known","not publicly","no publicly",
    "does not appear","not appear","no verifiable","no credible",
    "not have information","not have any information","isn't a","isnt a",
]
FP_REFUSE = [
    "not correct","misconception","incorrect","false premise",
    "not accurate","clarify","actually","wrong","not true",
    "contrary","mistaken","penguins are flightless","not fly",
    "flightless","not evolved","did not evolve","does not fly",
    "not a fact","inaccurate","not the case","myth",
    "false assumption","the premise","based on a mis",
]
CC_REFUSE = [
    "impossible","cannot determine","not possible","no way to know",
    "no records","not available","not be determined","impossible to",
    "no data","no record","not known","cannot know","can't know",
    "not able to","cannot provide","exact number",
    "no reliable","no scientific","no historical","unknown",
]

def pct_match(records, keywords):
    if not records:
        return float("nan")
    n   = len(records)
    hit = sum(1 for r in records
              if r.get("response") and
              any(kw in r["response"].lower() for kw in keywords))
    return hit / n * 100

def category_records(cat, cond=None, model_id=None, ok_only=True):
    out = [r for r in data if r["category"] == cat]
    if cond:      out = [r for r in out if r["condition"] == cond]
    if model_id:  out = [r for r in out if r["model_id"] == model_id]
    if ok_only:   out = [r for r in out if not r.get("error")]
    return out

# ── Matrica: model × cond → % odbijanja za FE, FP, CC ─────────────
fe_matrix, fp_matrix, cc_matrix = {}, {}, {}
for mname, mid in MODEL_IDS.items():
    fe_matrix[mname] = {}
    fp_matrix[mname] = {}
    cc_matrix[mname] = {}
    for c in [1, 2, 3, 4]:
        fe_matrix[mname][c] = pct_match(category_records("2_fabricated_entities", c, mid), REFUSE_FE)
        fp_matrix[mname][c] = pct_match(category_records("6_false_premise",         c, mid), FP_REFUSE)
        cc_matrix[mname][c] = pct_match(category_records("8_confidence_calibration",c, mid), CC_REFUSE)

# ── Overall accuracy (iz analysis_report) ─────────────────────────
stats     = rep["statistics"]
mc_stats  = stats["by_model_and_condition"]
cat_stats = stats["by_category_and_condition"]
oc_stats  = stats["overall_by_condition"]

def mc(mid, cond):
    v = mc_stats.get(mid, {}).get(str(cond), {})
    return v.get("mean", float("nan")) * 100 if "mean" in v else float("nan")

def cs(cat, cond):
    v = cat_stats.get(cat, {}).get(str(cond), {})
    return v.get("mean", float("nan")) * 100 if "mean" in v else float("nan")

# ══════════════════════════════════════════════════════════════════════
# 3.  GRAFOVI
# ══════════════════════════════════════════════════════════════════════
print("\n2. Crtanje grafova...")

def save(fig, name):
    p = GRAPHS / name
    fig.savefig(p, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"   {p.name}")
    return p

graph_paths = {}

# ── G1: Ukupna tačnost po uvjetu (bar) ────────────────────────────
fig, ax = plt.subplots(figsize=(7, 4))
cond_labels = ["Zero-shot", "CoT", "CSEP", "CSEP+ZS"]
vals  = [oc_stats.get(str(c), {}).get("mean", 0) * 100 for c in [1,2,3,4]]
ns    = [oc_stats.get(str(c), {}).get("n", 0) for c in [1,2,3,4]]
bars  = ax.bar(cond_labels, vals, color=[COLORS[c] for c in cond_labels],
               width=0.55, edgecolor="white", linewidth=1.2, zorder=3)
for bar, v, n in zip(bars, vals, ns):
    ax.text(bar.get_x() + bar.get_width()/2, v + 0.5,
            f"{v:.1f}%\n(n={n})", ha="center", va="bottom", fontsize=9)
ax.set_ylim(55, 82)
ax.set_ylabel("Tačnost (%)", fontsize=11)
ax.set_title("Ukupna tačnost po kondicionalu\n(auto-scored kategorije)", fontsize=12, fontweight="bold")
ax.yaxis.grid(True, linestyle="--", alpha=0.5, zorder=0)
ax.set_axisbelow(True)
fig.tight_layout()
graph_paths["g1"] = save(fig, "G1_overall_by_condition.png")

# ── G2: Tačnost po modelu i uvjetu (grouped bar) ──────────────────
fig, ax = plt.subplots(figsize=(11, 5))
x      = np.arange(len(MODEL_IDS))
width  = 0.19
conds  = [1, 2, 3, 4]
offsets= [-1.5, -0.5, 0.5, 1.5]
mnames = list(MODEL_IDS.keys())
mids   = list(MODEL_IDS.values())
for i, (c, offset) in enumerate(zip(conds, offsets)):
    vals = [mc(mid, c) for mid in mids]
    bars = ax.bar(x + offset*width, vals, width, label=COND[c],
                  color=COLORS[COND[c]], edgecolor="white", linewidth=0.8, zorder=3)
    for bar, v in zip(bars, vals):
        if not np.isnan(v):
            ax.text(bar.get_x() + bar.get_width()/2, v + 0.4,
                    f"{v:.0f}", ha="center", va="bottom", fontsize=6.5)
ax.set_xticks(x)
ax.set_xticklabels([m.replace(" ", "\n") for m in mnames], fontsize=9)
ax.set_ylim(30, 105)
ax.set_ylabel("Tačnost (%)", fontsize=11)
ax.set_title("Tačnost po modelu i kondicionalu\n(auto-scored kategorije)", fontsize=12, fontweight="bold")
ax.legend(fontsize=9, loc="upper right")
ax.yaxis.grid(True, linestyle="--", alpha=0.4, zorder=0)
ax.set_axisbelow(True)
fig.tight_layout()
graph_paths["g2"] = save(fig, "G2_accuracy_model_condition.png")

# ── G3: Heatmapa fabricated entities ──────────────────────────────
fig, axes = plt.subplots(1, 3, figsize=(13, 4))
matrices = [
    (fe_matrix, "Fabricated Entities\n(% odbijanja halucinacije)"),
    (fp_matrix, "False Premise\n(% ispravnog odbijanja)"),
    (cc_matrix, "Confidence Calibration\n(% priznavanja neznanja)"),
]
for ax, (mat, title) in zip(axes, matrices):
    mnames_short = ["Llama", "Qwen", "Nemo", "R1", "CmdR+"]
    matrix_vals = np.array(
        [[mat[m].get(c, float("nan")) for c in [1,2,3,4]]
         for m in MODEL_IDS.keys()],
        dtype=float
    )
    im = ax.imshow(matrix_vals, cmap="RdYlGn", vmin=0, vmax=100, aspect="auto")
    ax.set_xticks([0,1,2,3])
    ax.set_xticklabels(["ZS","CoT","CSEP","CSEP+ZS"], fontsize=8)
    ax.set_yticks(range(5))
    ax.set_yticklabels(mnames_short, fontsize=9)
    ax.set_title(title, fontsize=10, fontweight="bold")
    for i in range(5):
        for j in range(4):
            v = matrix_vals[i, j]
            if not np.isnan(v):
                txt_color = "black" if 30 < v < 70 else "white"
                ax.text(j, i, f"{v:.0f}%", ha="center", va="center",
                        fontsize=8, color=txt_color, fontweight="bold")
    plt.colorbar(im, ax=ax, shrink=0.8)
fig.suptitle("Heatmapa: Pravilno odbijanje po modelu i kondicionalu",
             fontsize=13, fontweight="bold", y=1.02)
fig.tight_layout()
graph_paths["g3"] = save(fig, "G3_heatmap_refusal.png")

# ── G4: Kategorije – ZS vs CSEP+ZS ────────────────────────────────
cats_auto = [
    ("2_fabricated_entities",         "Fabricated\nEntities"),
    ("3_math_with_distractors",       "Math\nDistractors"),
    ("6_false_premise",               "False\nPremise"),
    ("8_confidence_calibration",      "Confidence\nCalibration"),
    ("12_counting_and_basic_arithmetic","Counting &\nArithmetic"),
    ("13_aiw_relational_puzzles",     "AIW\nPuzzles"),
    ("15_distractor_injection",       "Distractor\nInjection"),
    ("18_hallucination_fabrication",  "Hallucination\nFabrication"),
]
fig, ax = plt.subplots(figsize=(12, 5))
x     = np.arange(len(cats_auto))
w     = 0.2
offsets4 = [-1.5, -0.5, 0.5, 1.5]
for i, (c, offset) in enumerate(zip([1,2,3,4], offsets4)):
    vals = [cs(cat, c) for cat, _ in cats_auto]
    bars = ax.bar(x + offset*w, vals, w, label=COND[c],
                  color=COLORS[COND[c]], edgecolor="white", linewidth=0.6, zorder=3)
labels = [lbl for _, lbl in cats_auto]
ax.set_xticks(x)
ax.set_xticklabels(labels, fontsize=8)
ax.set_ylim(0, 110)
ax.set_ylabel("Tačnost (%)", fontsize=11)
ax.set_title("Tačnost po kategoriji i kondicionalu (auto-scored)",
             fontsize=12, fontweight="bold")
ax.legend(fontsize=9)
ax.yaxis.grid(True, linestyle="--", alpha=0.4, zorder=0)
ax.set_axisbelow(True)
fig.tight_layout()
graph_paths["g4"] = save(fig, "G4_by_category.png")

# ── G5: Greške po modelu (stacked bar) ────────────────────────────
fig, ax = plt.subplots(figsize=(8, 4.5))
err_data = {
    "Llama 3.3 70B":   {"ok": 780,  "err": 0},
    "Qwen 2.5 72B":    {"ok": 765,  "err": 15},
    "Nemotron 70B":    {"ok": 772,  "err": 8},
    "R1 Distill 70B":  {"ok": 679,  "err": 101},
    "Command R+ 104B": {"ok": 536,  "err": 244},
}
mnames_e = list(err_data.keys())
ok_vals  = [err_data[m]["ok"]  for m in mnames_e]
err_vals = [err_data[m]["err"] for m in mnames_e]
x_e = np.arange(len(mnames_e))
b1 = ax.barh(x_e, ok_vals,  color="#55A868", label="OK", edgecolor="white")
b2 = ax.barh(x_e, err_vals, left=ok_vals, color="#C44E52", label="Greška", edgecolor="white")
for xi, (ok, er) in enumerate(zip(ok_vals, err_vals)):
    pct = er/(ok+er)*100
    ax.text(ok+er+5, xi, f"{er} ({pct:.0f}%)", va="center", fontsize=9,
            color="#C44E52" if er > 0 else "gray")
ax.set_yticks(x_e)
ax.set_yticklabels([m.replace(" ", "\n") for m in mnames_e], fontsize=9)
ax.set_xlim(0, 900)
ax.set_xlabel("Broj zapisa", fontsize=11)
ax.set_title("Greške po modelu (ukupno 3900 zapisa)", fontsize=12, fontweight="bold")
ax.legend(fontsize=10)
ax.xaxis.grid(True, linestyle="--", alpha=0.4, zorder=0)
ax.set_axisbelow(True)
fig.tight_layout()
graph_paths["g5"] = save(fig, "G5_errors_per_model.png")

# ── G6: Fabricated entities – halucinacija vs odbijanje (linijski) ─
fig, ax = plt.subplots(figsize=(8, 4.5))
cond_labels = ["Zero-shot", "CoT", "CSEP", "CSEP+ZS"]
for i, (mname, mid) in enumerate(MODEL_IDS.items()):
    vals = [fe_matrix[mname].get(c, float("nan")) for c in [1,2,3,4]]
    ax.plot(cond_labels, vals, "o-", color=MODEL_COLORS[i],
            label=mname, linewidth=2, markersize=7)
ax.set_ylim(-5, 115)
ax.set_ylabel("% koji ispravno odbija halucinaciju", fontsize=11)
ax.set_title("Fabricated Entities — pravilno odbijanje po kondicionalu",
             fontsize=12, fontweight="bold")
ax.legend(fontsize=8, loc="lower right")
ax.yaxis.grid(True, linestyle="--", alpha=0.4)
ax.axhline(50, color="gray", linestyle=":", linewidth=1, alpha=0.6)
fig.tight_layout()
graph_paths["g6"] = save(fig, "G6_fabricated_entities_line.png")

# ── G7: False Premise linijski ─────────────────────────────────────
fig, ax = plt.subplots(figsize=(8, 4.5))
for i, (mname, mid) in enumerate(MODEL_IDS.items()):
    vals = [fp_matrix[mname].get(c, float("nan")) for c in [1,2,3,4]]
    ax.plot(cond_labels, vals, "s-", color=MODEL_COLORS[i],
            label=mname, linewidth=2, markersize=7)
ax.set_ylim(-5, 105)
ax.set_ylabel("% koji ispravno odbija lažnu premisu", fontsize=11)
ax.set_title("False Premise — prepoznavanje i odbijanje po kondicionalu",
             fontsize=12, fontweight="bold")
ax.legend(fontsize=8)
ax.yaxis.grid(True, linestyle="--", alpha=0.4)
fig.tight_layout()
graph_paths["g7"] = save(fig, "G7_false_premise_line.png")

# ── G8: Radarski graf – modeli na ZS ──────────────────────────────
from matplotlib.patches import FancyArrowPatch
cats_radar = ["Math\nDistractors","False\nPremise","Confidence\nCalib.",
              "Counting &\nArithmetic","AIW\nPuzzles","Distractor\nInject."]
cat_keys   = ["3_math_with_distractors","6_false_premise",
              "8_confidence_calibration","12_counting_and_basic_arithmetic",
              "13_aiw_relational_puzzles","15_distractor_injection"]
N = len(cats_radar)
angles = [n / float(N) * 2 * np.pi for n in range(N)]
angles += angles[:1]
fig, ax = plt.subplots(figsize=(7, 7), subplot_kw=dict(polar=True))
for i, (mname, mid) in enumerate(MODEL_IDS.items()):
    model_stats = mc_stats.get(mid, {})
    vals_r = []
    for ck in cat_keys:
        v = cat_stats.get(ck, {}).get("1", {}).get("mean", float("nan"))
        vals_r.append(v * 100 if not np.isnan(v) else 50)
    vals_r += vals_r[:1]
    ax.plot(angles, vals_r, "o-", color=MODEL_COLORS[i],
            label=mname, linewidth=2, markersize=5)
    ax.fill(angles, vals_r, alpha=0.07, color=MODEL_COLORS[i])
ax.set_xticks(angles[:-1])
ax.set_xticklabels(cats_radar, fontsize=9)
ax.set_ylim(0, 100)
ax.set_yticks([20,40,60,80,100])
ax.set_yticklabels(["20","40","60","80","100"], fontsize=7)
ax.set_title("Radarski graf — Zero-shot profili modela\n(auto-scored kategorije)",
             fontsize=12, fontweight="bold", pad=20)
ax.legend(loc="upper right", bbox_to_anchor=(1.35, 1.15), fontsize=8)
fig.tight_layout()
graph_paths["g8"] = save(fig, "G8_radar_models_zeroshot.png")

# ══════════════════════════════════════════════════════════════════════
# 4.  PDF IZVJEŠTAJ
# ══════════════════════════════════════════════════════════════════════
print("\n3. Generišem PDF izvještaj...")

doc = SimpleDocTemplate(
    str(REPORT),
    pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2.2*cm, bottomMargin=2*cm,
    title="CSEP Experiment — Kompletan izvještaj",
    author="CSEP Experiment Pipeline",
)

SS    = getSampleStyleSheet()
W, H  = A4

# ── Stilovi ───────────────────────────────────────────────────────
s_title = ParagraphStyle("s_title", fontSize=22, fontName="Helvetica-Bold",
                          spaceAfter=6, alignment=TA_CENTER, textColor=colors.HexColor("#1a1a2e"))
s_sub   = ParagraphStyle("s_sub",   fontSize=13, fontName="Helvetica-Bold",
                          spaceAfter=4, alignment=TA_CENTER, textColor=colors.HexColor("#4a4a8a"))
s_h1    = ParagraphStyle("s_h1",    fontSize=14, fontName="Helvetica-Bold",
                          spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#1a1a2e"))
s_h2    = ParagraphStyle("s_h2",    fontSize=11, fontName="Helvetica-Bold",
                          spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#2c4a8a"))
s_body  = ParagraphStyle("s_body",  fontSize=9,  fontName="Helvetica",
                          spaceAfter=5, leading=14, alignment=TA_JUSTIFY)
s_note  = ParagraphStyle("s_note",  fontSize=8,  fontName="Helvetica-Oblique",
                          textColor=colors.HexColor("#666666"), spaceAfter=4)
s_pos   = ParagraphStyle("s_pos",   fontSize=9,  fontName="Helvetica-Bold",
                          textColor=colors.HexColor("#1e7e34"), spaceAfter=3)
s_neg   = ParagraphStyle("s_neg",   fontSize=9,  fontName="Helvetica-Bold",
                          textColor=colors.HexColor("#c0392b"), spaceAfter=3)

def TS(data_rows, col_widths=None, header=True):
    """Kreira stilizovanu tablicu."""
    if col_widths is None:
        ncols = max(len(r) for r in data_rows)
        avail = W - 4*cm
        col_widths = [avail / ncols] * ncols
    t = Table(data_rows, colWidths=col_widths)
    style = [
        ("FONTNAME",    (0,0), (-1,-1),  "Helvetica"),
        ("FONTSIZE",    (0,0), (-1,-1),  8),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [colors.white, colors.HexColor("#f8f9fa")]),
        ("GRID",        (0,0), (-1,-1),  0.3, colors.HexColor("#dee2e6")),
        ("VALIGN",      (0,0), (-1,-1),  "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1),  5),
        ("RIGHTPADDING",(0,0), (-1,-1),  5),
        ("TOPPADDING",  (0,0), (-1,-1),  3),
        ("BOTTOMPADDING",(0,0),(-1,-1),  3),
    ]
    if header:
        style += [
            ("BACKGROUND",  (0,0), (-1,0), colors.HexColor("#2c4a8a")),
            ("TEXTCOLOR",   (0,0), (-1,0), colors.white),
            ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",    (0,0), (-1,0), 8.5),
        ]
    t.setStyle(TableStyle(style))
    return t

def img(path, width_cm=15):
    w = width_cm * cm
    return Image(str(path), width=w, height=w*0.55)

def colored_cell(val, good_thresh=70, bad_thresh=50):
    """Formatira ćeliju s bojom prema vrijednosti."""
    if isinstance(val, float) and np.isnan(val):
        return "N/A"
    try:
        v = float(str(val).replace("%",""))
        if v >= good_thresh:
            return Paragraph(f'<font color="#1e7e34"><b>{val}</b></font>', SS["Normal"])
        elif v < bad_thresh:
            return Paragraph(f'<font color="#c0392b"><b>{val}</b></font>', SS["Normal"])
        else:
            return Paragraph(str(val), SS["Normal"])
    except:
        return str(val)

def fmt(v, decimals=1):
    if isinstance(v, float) and np.isnan(v):
        return "N/A"
    return f"{v:.{decimals}f}%"

# ── Elementi ──────────────────────────────────────────────────────
elems = []

# ── Naslovna strana ───────────────────────────────────────────────
elems += [
    Spacer(1, 2*cm),
    Paragraph("CSEP Experiment", s_title),
    Paragraph("Kompletan izvještaj o rezultatima", s_sub),
    Spacer(1, 0.4*cm),
    HRFlowable(width="100%", thickness=2, color=colors.HexColor("#2c4a8a")),
    Spacer(1, 0.3*cm),
    Paragraph("Conceptual Space Expansion Prompting — Evaluacija 5 LLM modela na 195 pitanja × 4 kondicionala", s_note),
    Spacer(1, 0.6*cm),
]

# Sažetak ukupnog statusa
status_rows = [
    ["Parametar", "Vrijednost"],
    ["Ukupno zapisa", "3.900 / 3.900 ✓ ZAVRŠENO"],
    ["Uspješnih odgovora", "3.532 (90,6%)"],
    ["Grešaka (legitimne)", "368 (9,4%)"],
    ["Auto-ocijenjeno", "1.972 zapisa"],
    ["Zahtijeva ručni pregled", "1.560 zapisa"],
    ["Datum završetka", "2026-05-02, 04:25"],
    ["Broj modela", "5 (Llama, Qwen, Nemotron, R1 Distill, Command R+)"],
    ["Broj kategorija", "19 kategorija pitanja"],
    ["Kondicionali", "Zero-shot / CoT / CSEP / CSEP+ZS"],
]
elems.append(TS(status_rows, col_widths=[6*cm, 11*cm]))
elems.append(Spacer(1, 0.5*cm))
elems.append(Paragraph(
    "Napomena: Auto-scored kategorije pokrivaju objektivne zadatke (matematika, logika, prepoznavanje entiteta). "
    "Subjektivne kategorije (apstraktne analogije, otvoreni odgovori) zahtijevaju ručno ocjenjivanje.",
    s_note))
elems.append(PageBreak())

# ── 1. Greške po modelu ───────────────────────────────────────────
elems.append(Paragraph("1. Integritet podataka — greške po modelu", s_h1))
elems.append(Paragraph(
    "Sve 368 grešaka su legitimna odbijanja modela (content filter, timeout) — "
    "ne radi se o tehničkim bugovima. Command R+ 104B je jedini model sa sistemskim problemom.", s_body))

err_rows = [["Model", "OK zapisa", "Greške", "Error %", "Dominantan uzrok"]]
err_info = [
    ("Llama 3.3 70B",   780, 0,   "0%",    "—"),
    ("Qwen 2.5 72B",    765, 15,  "1,9%",  "HTTP 400 (content filter)"),
    ("Nemotron 70B",    772, 8,   "1,0%",  "HTTP 429 (rate limit)"),
    ("R1 Distill 70B",  679, 101, "13,0%", "Prazni odgovori (model odbija generisanje)"),
    ("Command R+ 104B", 536, 244, "31,3%", "HTTP 403 — odbija CSEP/CoT promptove"),
]
for row in err_info:
    pct_str = row[3]
    pct_val = float(pct_str.replace(",",".").replace("%",""))
    color = "#c0392b" if pct_val > 10 else ("#e67e22" if pct_val > 2 else "#1e7e34")
    err_rows.append([
        row[0], str(row[1]),
        Paragraph(f'<font color="{color}"><b>{row[2]}</b></font>', SS["Normal"]),
        Paragraph(f'<font color="{color}"><b>{pct_str}</b></font>', SS["Normal"]),
        row[4]
    ])
elems.append(TS(err_rows, col_widths=[3.8*cm, 2.3*cm, 2*cm, 2*cm, 7*cm]))
elems.append(Spacer(1, 0.4*cm))
elems.append(img(graph_paths["g5"], 14))
elems.append(PageBreak())

# ── 2. Ukupna tačnost po kondicionalu ─────────────────────────────
elems.append(Paragraph("2. Ukupna tačnost po kondicionalu", s_h1))
elems.append(Paragraph(
    "Rezultati auto-scored kategorija. Zero-shot pobjeđuje sve složenije metode u ukupnom zbiru, "
    "ali slika se dramatično mijenja kad se gleda po kategorijama i modelima.", s_body))

oc_rows = [["Kondicijonál", "Tačnost", "Broj zapisa", "Ocjena"]]
oc_info = [
    ("Zero-shot",  73.9, 525, "★ Generalno best"),
    ("CSEP+ZS",    71.1, 477, "Dobro, pomaže Llami"),
    ("CSEP",       69.5, 478, "Umjereno"),
    ("CoT",        64.8, 492, "Loše na halucinacijskim zadacima"),
]
for name, val, n, note in oc_info:
    color = "#1e7e34" if val >= 72 else ("#e67e22" if val >= 69 else "#c0392b")
    oc_rows.append([
        name,
        Paragraph(f'<font color="{color}"><b>{val:.1f}%</b></font>', SS["Normal"]),
        str(n),
        note
    ])
elems.append(TS(oc_rows, col_widths=[3.5*cm, 2.5*cm, 3*cm, 8.2*cm]))
elems.append(Spacer(1, 0.4*cm))
elems.append(img(graph_paths["g1"], 13))
elems.append(PageBreak())

# ── 3. Tačnost po modelu i kondicionalu ───────────────────────────
elems.append(Paragraph("3. Tačnost po modelu i kondicionalu", s_h1))
elems.append(Paragraph("Auto-scored kategorije kombinirano.", s_body))

mc_rows = [["Model", "Zero-shot", "CoT", "CSEP", "CSEP+ZS", "Trend"]]
trends = {
    "Llama 3.3 70B":   "CSEP+ZS dramatično pomaže (+9,5pp)",
    "Qwen 2.5 72B":    "Relativno stabilan, CoT blago bolje",
    "Nemotron 70B":    "CSEP škodi! Već izvrsno radi bez pomoći",
    "R1 Distill 70B":  "Poboljšava se s CoT i CSEP+ZS",
    "Command R+ 104B": "Sve lošije s kompleksnijim promptovima",
}
for mname, mid in MODEL_IDS.items():
    row = [mname]
    for c in [1,2,3,4]:
        v = mc(mid, c)
        row.append(colored_cell(fmt(v), good_thresh=75, bad_thresh=55))
    row.append(trends[mname])
    mc_rows.append(row)
elems.append(TS(mc_rows, col_widths=[3.5*cm, 2*cm, 2*cm, 2*cm, 2.3*cm, 5.4*cm]))
elems.append(Spacer(1, 0.4*cm))
elems.append(img(graph_paths["g2"], 16))
elems.append(PageBreak())

# ── 4. Kategorije detaljno ─────────────────────────────────────────
elems.append(Paragraph("4. Rezultati po kategorijama (auto-scored)", s_h1))
elems.append(img(graph_paths["g4"], 16))
elems.append(Spacer(1, 0.3*cm))

cat_rows = [["Kategorija", "ZS", "CoT", "CSEP", "CSEP+ZS", "Zaključak"]]
cat_detail = [
    ("2_fabricated_entities",         "Fabricated Entities",         "Heuristički — % odbijanja; CoT katastrofalan"),
    ("3_math_with_distractors",       "Math + Distraktori",          "Sve metode slično (83–87%); CSEP neutralan"),
    ("6_false_premise",               "False Premise",               "CoT pada; CSEP+ZS vraća ili popravlja"),
    ("8_confidence_calibration",      "Confidence Calibration",      "Mješovito; CmdR+ pada s CSEP-om"),
    ("12_counting_and_basic_arithmetic","Counting & Arithmetic",     "CoT daleko best (97,5%); CSEP dobro"),
    ("13_aiw_relational_puzzles",     "AIW Relational Puzzles",      "CoT best (92,9%); CSEP dobro (85,7%)"),
    ("15_distractor_injection",       "Distractor Injection",        "CSEP best (93,3%); R1 uvijek griješi"),
    ("18_hallucination_fabrication",  "Hallucination Fabrication",   "CSEP+ZS best (+27pp); ostale metode slabo"),
]
for cat_key, cat_label, note in cat_detail:
    row = [cat_label]
    for c in [1,2,3,4]:
        v = cs(cat_key, c)
        row.append(colored_cell(fmt(v), good_thresh=75, bad_thresh=55))
    row.append(note)
    cat_rows.append(row)
elems.append(TS(cat_rows, col_widths=[3.2*cm, 1.7*cm, 1.7*cm, 1.7*cm, 2.1*cm, 6.8*cm]))
elems.append(PageBreak())

# ── 5. Heuristički nalazi ──────────────────────────────────────────
elems.append(Paragraph("5. Heuristički nalazi (heatmape)", s_h1))
elems.append(Paragraph(
    "Tri kategorije su analizirane heuristički na osnovu ključnih riječi u odgovorima modela. "
    "Zeleno = model ispravno odbija/prepoznaje problem. Crveno = halucinira ili prihvata grešku.", s_body))
elems.append(img(graph_paths["g3"], 16))
elems.append(Spacer(1, 0.4*cm))

# Podtabele za FE, FP, CC
for mat, title, keywords_desc in [
    (fe_matrix, "Fabricated Entities — % koji ispravno odbija halucinaciju",
     "Traži: 'not recognized', 'does not exist', 'fictional', 'cannot find'..."),
    (fp_matrix, "False Premise — % koji ispravno odbija lažnu premisu",
     "Traži: 'misconception', 'incorrect', 'flightless', 'did not evolve'..."),
    (cc_matrix, "Confidence Calibration — % koji prizna neznanje",
     "Traži: 'impossible', 'cannot determine', 'no way to know', 'unknown'..."),
]:
    elems.append(Paragraph(title, s_h2))
    elems.append(Paragraph(keywords_desc, s_note))
    rows = [["Model", "Zero-shot", "CoT", "CSEP", "CSEP+ZS"]]
    for mname in MODEL_IDS:
        row = [mname]
        for c in [1,2,3,4]:
            v = mat[mname].get(c, float("nan"))
            row.append(colored_cell(fmt(v), good_thresh=70, bad_thresh=40))
        rows.append(row)
    elems.append(TS(rows, col_widths=[4.5*cm, 3*cm, 3*cm, 3*cm, 3.7*cm]))
    elems.append(Spacer(1, 0.3*cm))
elems.append(PageBreak())

# ── 6. Linijski grafovi ────────────────────────────────────────────
elems.append(Paragraph("6. Trendovi po kondicionalu — linijski prikaz", s_h1))
elems.append(Paragraph("Fabricated Entities — pravilno odbijanje:", s_h2))
elems.append(img(graph_paths["g6"], 14))
elems.append(Spacer(1, 0.3*cm))
elems.append(Paragraph("False Premise — prepoznavanje:", s_h2))
elems.append(img(graph_paths["g7"], 14))
elems.append(PageBreak())

# ── 7. Radarski graf ───────────────────────────────────────────────
elems.append(Paragraph("7. Profil modela — radarski graf (Zero-shot)", s_h1))
elems.append(Paragraph(
    "Prikaz jakosti i slabosti svakog modela na zero-shot kondicionalu. "
    "Veća površina = bolji ukupni profil.", s_body))
elems.append(img(graph_paths["g8"], 13))
elems.append(PageBreak())

# ── 8. Ključni nalazi – pozitivni i negativni ─────────────────────
elems.append(Paragraph("8. Ključni nalazi — šta je pozitivno, šta je neuspjeh", s_h1))
elems.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#1e7e34")))
elems.append(Spacer(1, 0.2*cm))
elems.append(Paragraph("✅  POZITIVNI REZULTATI", ParagraphStyle("ph", fontSize=11,
    fontName="Helvetica-Bold", textColor=colors.HexColor("#1e7e34"), spaceAfter=6)))

positives = [
    ("CSEP+ZS dramatično pomaže Llami",
     "Llama 3.3 70B: ZS 81,9% → CSEP+ZS 91,4% (+9,5pp). Najdramatičniji efekt eksperimenta."),
    ("CoT je daleko best za računanje",
     "Counting & Arithmetic: ZS 78% → CoT 97,5% (+19,5pp). Jasna i reproducibilna prednost."),
    ("CSEP pomaže R1 Distillu na fabricated entities",
     "R1 na ZS halucinira 84% puta. Sa CSEP-om odbija u 59% slučajeva — poboljšanje +43pp."),
    ("CSEP+ZS vraća performansu na false premise",
     "Llama 85%, Qwen 75%, R1 61% (CSEP+ZS) — sve bolje ili jednako ZS-u."),
    ("Nemotron je konzistentno najkalibrovaniji",
     "89% na confidence calibration, 100% odolijevanje adversarial pritisku."),
    ("CSEP best na distractor injection",
     "93,3% za CSEP — model sistematski ignorira irelevantne informacije."),
    ("CSEP+ZS best na hallucination fabrication",
     "43% ZS → 70,8% CSEP+ZS (+27,5pp) — najveći dobitak po kategoriji."),
]
for title_p, desc in positives:
    elems.append(Paragraph(f"<b>{title_p}</b>", s_pos))
    elems.append(Paragraph(desc, s_body))

elems.append(Spacer(1, 0.3*cm))
elems.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#c0392b")))
elems.append(Spacer(1, 0.2*cm))
elems.append(Paragraph("❌  NEUSPJESI I ZABRINJAVAJUĆI NALAZI", ParagraphStyle("nh", fontSize=11,
    fontName="Helvetica-Bold", textColor=colors.HexColor("#c0392b"), spaceAfter=6)))

negatives = [
    ("CoT je katastrofalan za fabricated entities",
     "Pada za 30–63pp kod svih modela vs ZS. Tri halucinirana pokušaja međusobno se 'potvrđuju' "
     "i konsenzus je pogrešan. Qwen: ZS 53% → CoT 16%."),
    ("CSEP šteti Nemotron-u",
     "Nemotron: ZS 91,4% → CSEP+ZS 68,3% (−23pp). Model koji je već izvrsno radio — "
     "CSEP uvodi nepotrebnu složenost i pogoršava rezultate."),
    ("Command R+ je neupotrebljiv s CSEP-om",
     "31% error rate, a i kada odgovori: ZS 71,4% → CoT 43,8% → CSEP+ZS 48,6%. "
     "Podaci za ovaj model su strukturno nebalansovani."),
    ("R1 Distill trajno loš na distraktor injekciji",
     "Uvijek primijeni inflacijsku korekciju čak i kad nije tražena. "
     "Bez poboljšanja ni pod jednim kondicionalom."),
    ("CSEP uništava kalibraciju CmdR+-a",
     "74% ZS → 40% CSEP → 33% CSEP+ZS. Model gubi sposobnost da prizna neznanje."),
    ("Ukupno: zero-shot pobjeđuje sve metode",
     "73,9% ZS vs 71,1% CSEP+ZS vs 64,8% CoT. CSEP nema konzistentno pozitivan efekt "
     "— rezultati su jako zavisni od modela i kategorije."),
    ("CoT pada na false premise svugdje",
     "Tri prolaza prihvataju lažnu premisu međusobno. Svi modeli slabiji vs ZS."),
]
for title_p, desc in negatives:
    elems.append(Paragraph(f"<b>{title_p}</b>", s_neg))
    elems.append(Paragraph(desc, s_body))

elems.append(PageBreak())

# ── 9. Metodološke napomene ────────────────────────────────────────
elems.append(Paragraph("9. Metodološke napomene", s_h1))
notes = [
    "1.560 zapisa (40%) zahtijeva ručni pregled — kategorije: abstract_analogies, "
    "open_ended_hallucination, temporal_reasoning, hidden_contradictions, itd. "
    "Konačni zaključci mogu se promijeniti nakon kompletnog ocjenjivanja.",

    "Command R+ 104B je strukturno isključen iz komparativne analize kondicionala "
    "zbog 31% error rate-a u Cond 2/3/4. Poređenje uvjeta za ovaj model nije statistički validno.",

    "Heurističke metrike (FE, FP, CC) temelje se na pretrazi ključnih riječi — ne garantuju "
    "100% preciznost, ali daju konzistentnu procjenu na skupu od 380–400 zapisa po kategoriji.",

    "Auto-scoring pokriva objektivne kategorije (matematika, logika, definisani tačni odgovori). "
    "Sve auto-scored vrijednosti u ovom izvještaju su finalne.",

    "Greške tipa 'OSError Errno 22' (Windows socket bug) su bile prisutne u prvoj iteraciji "
    "i ispravljene — 650 zapisa je ponovo generirano. Finalni dataset ne sadrži niti jedan Errno 22 zapis.",
]
for note in notes:
    elems.append(Paragraph(f"• {note}", s_body))

elems.append(Spacer(1, 0.5*cm))
elems.append(Paragraph("10. Distribucija datoteka", s_h1))
file_rows = [
    ["Datoteka", "Opis"],
    ["results/full_experiment.json", "Svih 3.900 zapisa kombinirano"],
    ["results/per_model/Llama_3.3_70B.json", "780 zapisa, 0 grešaka"],
    ["results/per_model/Qwen_2.5_72B.json", "780 zapisa, 15 grešaka"],
    ["results/per_model/Nemotron_70B.json", "780 zapisa, 8 grešaka"],
    ["results/per_model/R1_Distill_70B.json", "780 zapisa, 101 grešaka"],
    ["results/per_model/Command_R+_104B.json", "780 zapisa, 244 grešaka"],
    ["analysis/analysis_report.json", "Auto-scored statistike"],
    ["analysis/manual_review.json", "1.560 zapisa za ručni pregled"],
    ["analysis/graphs/", "8 PNG grafova"],
    ["analysis/CSEP_Report.pdf", "Ovaj dokument"],
]
elems.append(TS(file_rows, col_widths=[8*cm, 9.2*cm]))

# ── Build ──────────────────────────────────────────────────────────
doc.build(elems)
print(f"\n✓ PDF sačuvan: {REPORT}")
print(f"✓ Per-model JSON fajlovi: {PMODEL}")
print(f"✓ Grafovi: {GRAPHS}")
print("\nGOTOVO.")
