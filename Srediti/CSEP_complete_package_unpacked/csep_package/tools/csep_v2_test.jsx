import { useState, useRef, useCallback, useEffect } from "react";

const TARGET_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-opus-4-5-20250929";
const STORAGE_KEY = "csep_v2_prompt_first";

const FAILED_QUESTIONS = [
  {
    id: 1,
    subtype: "surgeon_explicit_father",
    question: "A man and his son are in a car accident. They are rushed to the hospital. The surgeon looks at the boy and says, 'I can operate on this boy — he is my son!' The surgeon is the boy's father. How is this possible?",
    correct_answer: "It is straightforwardly possible — the father is a surgeon and is confirming he can perform the operation on his son. There is no puzzle or twist.",
    reasoning: "Altered 'surgeon is the mother' riddle. Models often recite classic answer.",
    trap: "Model recites classic riddle answer despite explicit contrary information",
    baseline_answer: "The surgeon is the boy's mother. The riddle assumes the surgeon must be male, but there's no reason that has to be the case.",
    csep_v1_answer: "The surgeon is the boy's mother (CSEP v1 also failed — decomposition amplified recitation)"
  },
  {
    id: 5,
    subtype: "bat_ball_direct",
    question: "A bat and a ball cost $1.10 in total. The bat costs $1.00. How much does the ball cost?",
    correct_answer: "$0.10 (ten cents). $1.00 + $0.10 = $1.10.",
    reasoning: "Altered CRT. Here bat price is given directly, so ball is 10 cents.",
    trap: "Model recites classic 5 cents despite direct price",
    baseline_answer: "The ball costs $0.05 (5 cents). The bat costs $1.00 more than the ball...",
    csep_v1_answer: "$0.10 — CSEP v1 succeeded on this one"
  },
  {
    id: 7,
    subtype: "no_boat_wade",
    question: "A man has a wolf, a goat, and a cabbage. He needs to get all of them across a river. There is no boat. The river is shallow enough to wade through. The wolf would eat the goat if left alone with it, and the goat would eat the cabbage if left alone with it. How does he get them across?",
    correct_answer: "He simply walks through the shallow river bringing all three with him at once. Since he never leaves any pair alone, the eating constraints never apply.",
    reasoning: "No boat removes capacity constraint entirely.",
    trap: "Model recites classic multi-trip solution despite no boat",
    baseline_answer: "He carries each item across one at a time... (classic multi-trip solution)",
    csep_v1_answer: "Multi-trip solution — CSEP v1 explicitly invented 'one item at a time' constraint"
  },
  {
    id: 20,
    subtype: "dead_locked_room",
    question: "A man is found dead in a locked room. There is a puddle of water on the floor and a broken piece of glass. The room has no windows and the door was locked from the inside. The coroner rules the death was NOT caused by drowning, NOT caused by glass injury, NOT caused by poisoning, and NOT caused by heart attack. How did he die?",
    correct_answer: "There is not enough information to determine the cause of death. All commonly-cited causes have been ruled out.",
    reasoning: "Classic solution is hanging from melted ice block. Altered rules out all common answers.",
    trap: "Model recites classic 'ice cube hanging' despite explicit exclusions",
    baseline_answer: "The man stood on a block of ice and hanged himself...",
    csep_v1_answer: "Ice block solution — CSEP v1 still defended classic answer"
  }
];

const PHASE_LABELS = [
  "Koncepti u promptu",
  "Šta se zahteva",
  "Provera pretpostavki",
  "Odgovor",
  "Poliranje"
];
const PHASE_COLORS = ["#7CC6E8", "#9BE87C", "#E8D67C", "#C47CE8", "#E8927C"];

// v2 PIPELINE: concepts FIRST, answer LAST
function buildCSEPv2Prompts(original, outputs) {
  return [
    // PHASE 1: Extract concepts from the PROMPT ITSELF — not solving, not guessing
    {
      system: "You are analyzing the structure of a problem. Do NOT attempt to solve it yet. Your job is to parse the problem as written.",
      user: `Read the following problem VERY CAREFULLY. Do not try to answer it.

Problem: ${original}

Your task: Extract and list every distinct concept, entity, condition, and constraint that the problem as written introduces. For each one:
- State it exactly as presented in the problem
- Note whether it is EXPLICITLY STATED in the text or merely IMPLIED

Structure your response:

EXPLICIT CONCEPTS (directly stated in the prompt):
- [concept 1 as written in the prompt]
- [concept 2 as written in the prompt]
- ...

IMPLICIT CONCEPTS (assumed by context but not stated):
- [any assumption needed to make sense of the problem, but NOT stated]
- ...

DO NOT introduce any information not actually in the prompt. If something is not there, do not add it.`
    },
    // PHASE 2: What does the question ACTUALLY ask? What kind of answer is expected?
    {
      system: "You are analyzing what a problem asks. Do not solve it yet.",
      user: `You have analyzed the concepts in this problem:

Problem: ${original}

Concepts found:
${outputs[0] || ""}

Now answer these meta-questions about the problem (NOT the problem itself):

1. WHAT KIND OF QUESTION IS THIS? (factual, logical, puzzle, trick question, ill-posed, etc.)
2. WHAT EXACTLY IS BEING ASKED? State the specific question in your own words, using only information from the prompt.
3. WHAT WOULD A VALID ANSWER LOOK LIKE? Describe the shape/type of answer the question demands (a number, a yes/no, an explanation, "insufficient information", etc.)
4. WHAT INFORMATION FROM THE PROMPT IS LOAD-BEARING for the answer? List the specific conditions that the answer must respect.

Do not attempt to answer yet.`
    },
    // PHASE 3: Check for false pattern matching — does this LOOK like a known puzzle?
    {
      system: "You are checking for pattern-matching errors. Be critical of your own first impressions.",
      user: `You have analyzed this problem:

Problem: ${original}

Concepts: ${outputs[0] || ""}
Question analysis: ${outputs[1] || ""}

Critical self-check — answer each carefully:

1. DOES THIS PROBLEM RESEMBLE A FAMOUS PUZZLE OR RIDDLE you have seen before? If yes, name it.
2. WHAT IS THE CANONICAL VERSION of that famous puzzle? State its exact conditions.
3. HOW DOES THE CURRENT PROBLEM DIFFER FROM THE CANONICAL VERSION? Compare condition by condition. Be specific about what has been ADDED, REMOVED, or CHANGED.
4. IF THE CANONICAL ANSWER WERE GIVEN TO THE CURRENT PROBLEM, WOULD IT STILL BE CORRECT? Why or why not — check the differences from question 3.

If the problem does not resemble a famous puzzle, state so and move on.`
    },
    // PHASE 4: Now answer — constrained by analysis
    {
      system: "You are now answering the original problem. Use only the information present in the prompt.",
      user: `You have fully analyzed this problem:

Problem: ${original}

Your concept analysis: ${outputs[0] || ""}
Your question analysis: ${outputs[1] || ""}
Your pattern-match check: ${outputs[2] || ""}

Now answer the problem. Rules:
- Respond only to what the prompt ACTUALLY says, not what a canonical version says.
- If your pattern-match check identified a canonical version with different conditions, do NOT give the canonical answer unless the current conditions also support it.
- If the prompt's conditions make the answer trivial, give the trivial answer.
- If the prompt's conditions make the answer undetermined, say so.
- Do not import conditions that are not in the prompt.

Answer concisely.`
    },
    // PHASE 5: Verify answer against concepts — catch any imported assumptions
    {
      system: "You are verifying an answer. Check each claim against the original prompt.",
      user: `Review this answer against the original problem.

Problem: ${original}

Explicit concepts in prompt: ${outputs[0] || ""}

Answer to verify: ${outputs[3] || ""}

Check each of the following:

1. Does the answer use any condition, fact, or assumption that is NOT in the prompt? List any.
2. Does the answer contradict any explicit condition in the prompt? List any.
3. Does the answer match the shape of what was asked (per your earlier question analysis)?

If the answer imports external conditions or contradicts the prompt, produce a corrected answer that strictly uses only what the prompt says. Otherwise, return the answer unchanged.`
    }
  ];
}

async function callAPI(model, system, user, maxTokens = 1500) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: user }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(b => b.text || "").join("\n") || "";
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found");
  return JSON.parse(match[0]);
}

async function judge(q, answer) {
  const resp = await callAPI(
    JUDGE_MODEL,
    "You are a strict, fair evaluator. Return only JSON.",
    `Evaluate whether this answer is correct for a classic puzzle with an altered condition.

QUESTION: ${q.question}

VERIFIED CORRECT ANSWER: ${q.correct_answer}

REASONING: ${q.reasoning}

TRAP (typical wrong answer): ${q.trap}

ANSWER TO EVALUATE: ${answer}

Judge strictly:
- Must address the ACTUAL question, not a classic version.
- If it recites the classic puzzle's answer, INCORRECT.
- Must arrive at the VERIFIED CORRECT ANSWER in substance.

Return ONLY JSON:
{"correct": true or false, "fell_for_trap": true or false, "reason": "one sentence"}`
  );
  return parseJSON(resp);
}

export default function CSEPv2Test() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const stopRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setResults(JSON.parse(saved));
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (Object.keys(results).length > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(results)); } catch (e) {}
    }
  }, [results]);

  const runAll = useCallback(async () => {
    setRunning(true);
    stopRef.current = false;

    for (const q of FAILED_QUESTIONS) {
      if (stopRef.current) break;
      if (results[q.id]?.stage === "done") continue;

      try {
        const phases = [];
        for (let i = 0; i < 5; i++) {
          if (stopRef.current) break;
          setProgress(`#${q.id}: faza ${i + 1}/5 (${PHASE_LABELS[i]})...`);
          setResults(prev => ({
            ...prev,
            [q.id]: { stage: `phase_${i + 1}`, phases: [...phases] }
          }));
          const p = buildCSEPv2Prompts(q.question, phases)[i];
          const resp = await callAPI(TARGET_MODEL, p.system, p.user);
          phases.push(resp);
        }
        if (stopRef.current) break;

        const csepFinal = phases[4] || phases[3] || "";

        setProgress(`#${q.id}: judging...`);
        setResults(prev => ({
          ...prev,
          [q.id]: { stage: "judging", phases, csepFinal }
        }));

        const judgment = await judge(q, csepFinal);

        setResults(prev => ({
          ...prev,
          [q.id]: {
            stage: "done",
            phases, csepFinal, judgment,
            correct: judgment.correct,
            fell_for_trap: judgment.fell_for_trap
          }
        }));
      } catch (e) {
        setResults(prev => ({ ...prev, [q.id]: { stage: "error", error: e.message } }));
      }
    }

    setProgress("");
    setRunning(false);
  }, [results]);

  const clearAll = () => {
    if (confirm("Obrisati sve rezultate?")) {
      setResults({});
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const downloadAll = () => {
    const all = FAILED_QUESTIONS.map(q => ({ ...q, csep_v2_result: results[q.id] || null }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `csep_v2_results.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const done = FAILED_QUESTIONS.filter(q => results[q.id]?.stage === "done");
  const v2Fixed = done.filter(q => results[q.id].correct).length;

  return (
    <div style={{
      fontFamily: "'Newsreader', Georgia, serif",
      minHeight: "100vh", background: "#0a0a0b", color: "#e8e4df", padding: "1.5rem"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:wght@300;400;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        @keyframes pulse { 0%,100%{opacity:0.4}50%{opacity:1} }
        @keyframes fadeIn { from{opacity:0}to{opacity:1} }
        .fade-in { animation: fadeIn 0.25s ease forwards; }
        button:disabled { opacity: 0.4; cursor: not-allowed !important; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
            letterSpacing: "0.2em", textTransform: "uppercase",
            color: "#9BE87C", marginBottom: "0.3rem"
          }}>CSEP v2 — PROMPT FIRST, answer last</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            Koncepti iz prompta pre bilo kakvog odgovora
          </h1>
          <div style={{ width: 60, height: 2,
            background: "linear-gradient(90deg, #7CC6E8, #9BE87C, #C47CE8)",
            marginTop: "0.5rem" }} />
          <div style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", lineHeight: 1.55 }}>
            Ključna izmena: NEMA hipoteze na početku. Model prvo parsira šta prompt EKSPLICITNO kaže,
            pa analizira šta se zahteva, pa se pita "da li ovo liči na neku klasiku i po čemu se razlikuje?",
            tek onda odgovara, i na kraju proverava da nije uveo pretpostavke koje nisu u promptu.
          </div>
        </div>

        {/* Pipeline overview */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
          gap: "0.4rem", marginBottom: "1.25rem"
        }}>
          {PHASE_LABELS.map((label, i) => (
            <div key={i} style={{
              background: "#0d0d0e",
              border: `1px solid ${PHASE_COLORS[i]}22`,
              borderLeft: `3px solid ${PHASE_COLORS[i]}`,
              borderRadius: 6, padding: "0.55rem 0.6rem"
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                color: PHASE_COLORS[i], textTransform: "uppercase",
                letterSpacing: "0.1em", marginBottom: 3
              }}>Faza {i + 1}</div>
              <div style={{ fontSize: "0.72rem", color: "#ccc", lineHeight: 1.4 }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {done.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.5rem", marginBottom: "1rem"
          }}>
            {[
              { label: "Obrađeno", val: `${done.length}/4`, color: "#bbb" },
              { label: "v2 Fixed", val: v2Fixed, color: "#9BE87C" },
              { label: "Još greši", val: done.length - v2Fixed, color: "#E8927C" },
              { label: "Success rate", val: done.length > 0 ? `${Math.round(v2Fixed/done.length*100)}%` : "-", color: "#7CC6E8" }
            ].map((s, i) => (
              <div key={i} style={{
                background: "#111113", border: "1px solid #1e1e22",
                borderRadius: 8, padding: "0.7rem", textAlign: "center"
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "1.4rem", fontWeight: 500, color: s.color
                }}>{s.val}</div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.55rem", color: "#666",
                  textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4
                }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={runAll} disabled={running}
            style={{
              background: "#e8e4df", color: "#0a0a0b", border: "none",
              borderRadius: 6, padding: "0.5rem 1.25rem",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
              fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
            }}
          >{running ? "Running..." : done.length === 0 ? "Run CSEP v2 on 4" : `Continue (${4 - done.length})`}</button>

          {running && (
            <button onClick={() => { stopRef.current = true; }}
              style={{
                background: "#E8927C", color: "#0a0a0b", border: "none",
                borderRadius: 6, padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
              }}
            >Stop</button>
          )}

          {done.length > 0 && (
            <button onClick={downloadAll}
              style={{
                background: "#9BE87C", color: "#0a0a0b", border: "none",
                borderRadius: 6, padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
              }}
            >↓ Download</button>
          )}

          <button onClick={clearAll} disabled={running}
            style={{
              background: "transparent", color: "#E8555C", border: "1px solid #E8555C33",
              borderRadius: 6, padding: "0.5rem 1.25rem",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
              fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
              marginLeft: "auto"
            }}
          >Clear</button>
        </div>

        {progress && (
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
            color: "#7CC6E8", marginBottom: "0.75rem",
            display: "flex", alignItems: "center", gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "#0d1518", borderRadius: 6, border: "1px solid #7CC6E822"
          }}>
            <span style={{ animation: "pulse 1.5s infinite" }}>●</span>
            {progress}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {FAILED_QUESTIONS.map(q => {
            const r = results[q.id];
            const isEx = expandedId === q.id;
            const statusColor = !r ? "#333" :
              r.stage === "done" ? (r.correct ? "#9BE87C" : "#E8927C") :
              r.stage === "error" ? "#E8555C" : "#7CC6E8";

            return (
              <div key={q.id} className="fade-in"
                style={{
                  background: isEx ? "#111113" : "#0d0d0e",
                  border: "1px solid #1a1a1e",
                  borderLeft: `3px solid ${statusColor}`,
                  borderRadius: 6, overflow: "hidden"
                }}
              >
                <div onClick={() => setExpandedId(isEx ? null : q.id)}
                  style={{
                    padding: "0.6rem 0.85rem", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: "0.6rem"
                  }}
                >
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "0.58rem",
                    color: "#555", minWidth: 22, textAlign: "right"
                  }}>#{q.id}</span>

                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                    color: "#7CC6E8",
                    padding: "2px 6px", background: "#7CC6E815",
                    borderRadius: 3, minWidth: 100, textAlign: "center"
                  }}>{q.subtype}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "0.78rem", lineHeight: 1.4, color: "#bbb",
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: isEx ? "normal" : "nowrap"
                    }}>{q.question}</div>
                  </div>

                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.5rem",
                      padding: "2px 5px", borderRadius: 3,
                      background: "#2a1515", color: "#E8927C"
                    }}>BASE: ✗</span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.5rem",
                      padding: "2px 5px", borderRadius: 3,
                      background: q.id === 5 ? "#152015" : "#2a1515",
                      color: q.id === 5 ? "#9BE87C" : "#E8927C"
                    }}>v1: {q.id === 5 ? "✓" : "✗"}</span>
                    {r?.stage === "done" && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.5rem",
                        padding: "2px 5px", borderRadius: 3,
                        background: r.correct ? "#152015" : "#2a1515",
                        color: r.correct ? "#9BE87C" : "#E8927C"
                      }}>v2: {r.correct ? "✓" : "✗"}</span>
                    )}
                    {r && r.stage !== "done" && r.stage !== "error" && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.5rem",
                        padding: "2px 5px", borderRadius: 3,
                        background: "#151a1a", color: "#7CC6E8"
                      }}>v2: {r.stage}</span>
                    )}
                  </div>
                </div>

                {isEx && (
                  <div className="fade-in" style={{
                    padding: "0 0.85rem 0.85rem", borderTop: "1px solid #1a1a1e"
                  }}>
                    <div style={{
                      marginTop: "0.55rem", padding: "0.45rem 0.7rem",
                      background: "#0d1a0d", borderLeft: "2px solid #9BE87C33",
                      borderRadius: "0 4px 4px 0", fontSize: "0.72rem", lineHeight: 1.55
                    }}>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.54rem",
                        color: "#9BE87C", textTransform: "uppercase", marginBottom: 3
                      }}>Tačan odgovor</div>
                      <div style={{ color: "#ccc" }}>{q.correct_answer}</div>
                      <div style={{
                        marginTop: 5, fontSize: "0.65rem",
                        color: "#C47CE8", fontStyle: "italic"
                      }}>Zamka: {q.trap}</div>
                    </div>

                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "0.5rem", marginTop: "0.75rem"
                    }}>
                      <div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                          color: "#E8927C", textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 4
                        }}>Baseline</div>
                        <div style={{
                          background: "#0a0a0b", borderRadius: 6, padding: "0.5rem",
                          fontSize: "0.68rem", lineHeight: 1.55, color: "#aaa",
                          whiteSpace: "pre-wrap",
                          borderLeft: "2px solid #E8927C44",
                          maxHeight: 220, overflow: "auto"
                        }}>{q.baseline_answer}</div>
                      </div>

                      <div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                          color: q.id === 5 ? "#9BE87C" : "#E8927C",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 4
                        }}>CSEP v1</div>
                        <div style={{
                          background: "#0a0a0b", borderRadius: 6, padding: "0.5rem",
                          fontSize: "0.68rem", lineHeight: 1.55, color: "#aaa",
                          whiteSpace: "pre-wrap",
                          borderLeft: `2px solid ${q.id === 5 ? "#9BE87C44" : "#E8927C44"}`,
                          maxHeight: 220, overflow: "auto"
                        }}>{q.csep_v1_answer}</div>
                      </div>

                      <div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                          color: r?.correct ? "#9BE87C" : "#E8927C",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 4
                        }}>CSEP v2 {r?.stage === "done" ? (r.correct ? "✓" : "✗") : ""}</div>
                        {r?.csepFinal ? (
                          <div style={{
                            background: "#0a0a0b", borderRadius: 6, padding: "0.5rem",
                            fontSize: "0.68rem", lineHeight: 1.55, color: "#ccc",
                            whiteSpace: "pre-wrap",
                            borderLeft: `2px solid ${r.correct ? "#9BE87C44" : "#E8927C44"}`,
                            maxHeight: 220, overflow: "auto"
                          }}>{r.csepFinal}</div>
                        ) : (
                          <div style={{
                            background: "#0a0a0b", borderRadius: 6, padding: "0.7rem",
                            fontSize: "0.68rem", color: "#555", fontStyle: "italic",
                            borderLeft: "2px solid #333"
                          }}>
                            {r ? `${r.stage}...` : "Nije pokrenuto"}
                          </div>
                        )}
                      </div>
                    </div>

                    {r?.judgment?.reason && (
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.62rem",
                        color: "#888", marginTop: 6, fontStyle: "italic"
                      }}>v2 sudija: {r.judgment.reason}</div>
                    )}

                    {r?.phases && r.phases.length > 0 && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.54rem",
                          color: "#666", textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 5
                        }}>CSEP v2 faze</div>
                        {r.phases.map((ph, i) => (
                          <details key={i} style={{ marginBottom: "0.3rem" }}>
                            <summary style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.62rem",
                              color: PHASE_COLORS[i], cursor: "pointer", padding: "3px 0"
                            }}>Faza {i + 1} — {PHASE_LABELS[i]}</summary>
                            <div style={{
                              background: "#0a0a0b",
                              borderLeft: `2px solid ${PHASE_COLORS[i]}33`,
                              padding: "0.5rem 0.7rem",
                              fontSize: "0.72rem", lineHeight: 1.55,
                              whiteSpace: "pre-wrap", color: "#aaa",
                              maxHeight: 260, overflow: "auto",
                              borderRadius: "0 4px 4px 0"
                            }}>{ph}</div>
                          </details>
                        ))}
                      </div>
                    )}

                    {r?.error && (
                      <div style={{
                        marginTop: "0.5rem", padding: "0.5rem 0.7rem",
                        fontSize: "0.72rem", color: "#E8555C",
                        background: "#1a0d0d", borderRadius: 4
                      }}>Error: {r.error}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
