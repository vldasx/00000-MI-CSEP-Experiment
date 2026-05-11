import { useState, useRef, useCallback, useEffect } from "react";

const TARGET_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-opus-4-5-20250929";
const STORAGE_KEY = "csep_vs_baseline_v1";

// The 4 questions where Haiku failed in baseline test
const FAILED_QUESTIONS = [
  {
    id: 1,
    subtype: "surgeon_explicit_father",
    question: "A man and his son are in a car accident. They are rushed to the hospital. The surgeon looks at the boy and says, 'I can operate on this boy — he is my son!' The surgeon is the boy's father. How is this possible?",
    correct_answer: "It is straightforwardly possible — the father is a surgeon and is confirming he can perform the operation on his son. There is no puzzle or twist. Fathers can be surgeons; the question explicitly states the surgeon IS the father.",
    reasoning: "Altered 'surgeon is the mother' riddle. Models often recite 'the surgeon is the mother' anyway.",
    trap: "Model recites classic riddle answer despite explicit contrary information",
    baseline_answer: "The surgeon is the boy's mother. The riddle assumes the surgeon must be male, but there's no reason that has to be the case."
  },
  {
    id: 5,
    subtype: "bat_ball_direct",
    question: "A bat and a ball cost $1.10 in total. The bat costs $1.00. How much does the ball cost?",
    correct_answer: "$0.10 (ten cents). $1.00 + $0.10 = $1.10.",
    reasoning: "Altered CRT. Original says 'bat costs $1.00 MORE than ball' with answer 5 cents. Here the bat price is given directly, so ball is simply 10 cents.",
    trap: "Model recites classic 5 cents despite direct price",
    baseline_answer: "The ball costs **$0.05** (5 cents).\n\nThe bat costs $1.00 more than the ball, so if the ball is $0.05, the bat is $1.05, and together they total $1.10.\n\n(The intuitive answer of $0.10 is a common error — that would make the total $1.10 only if the bat also cost $1.00, but then the bat would cost only $0.90 more than the ball, not $1.00 more.)"
  },
  {
    id: 7,
    subtype: "no_boat_wade",
    question: "A man has a wolf, a goat, and a cabbage. He needs to get all of them across a river. There is no boat. The river is shallow enough to wade through. The wolf would eat the goat if left alone with it, and the goat would eat the cabbage if left alone with it. How does he get them across?",
    correct_answer: "He simply walks through the shallow river bringing all three with him at once. Since he never leaves any pair alone, the eating constraints never apply.",
    reasoning: "No boat removes capacity constraint entirely.",
    trap: "Model recites classic solution despite no boat",
    baseline_answer: "Since there's no boat and the river is shallow enough to wade through, the man can simply carry each item across one at a time while keeping the problematic pairs separated.\n\nHe carries the goat across first, then returns and carries the wolf across, brings the goat back with him, leaves the goat, carries the cabbage across, returns alone, and finally carries the goat across again.\n\nThe key insight here is that \"wading\" means he can make as many trips as needed without a boat — the classic puzzle assumes a boat that limits what he can carry, but this version removes that constraint. The solution is the same sequence of moves, just done on foot."
  },
  {
    id: 20,
    subtype: "dead_locked_room",
    question: "A man is found dead in a locked room. There is a puddle of water on the floor and a broken piece of glass. The room has no windows and the door was locked from the inside. The coroner rules the death was NOT caused by drowning, NOT caused by glass injury, NOT caused by poisoning, and NOT caused by heart attack. How did he die?",
    correct_answer: "There is not enough information to determine the cause of death. The puzzle has ruled out every commonly-cited cause. Without more evidence, the cause is unknown.",
    reasoning: "Classic solution is hanging from melted ice block. Altered explicitly rules out all common answers.",
    trap: "Model recites classic 'ice cube hanging' despite no hanging evidence and explicit rulings out",
    baseline_answer: "This is a classic lateral thinking puzzle. The most common intended answer is that the man stood on a **block of ice** to hang himself — the ice melted into the puddle, and the glass was from a broken drinking glass or light bulb, serving as a red herring.\n\nThe locked room, no windows, and ruled-out causes all point away from foul play, and the melted ice explains both the locked-room mystery and the puddle without involving drowning or poison."
  }
];

const PHASE_LABELS = ["Hipoteza", "Master koncept", "Dekompozicija", "Reintegracija", "Poliranje"];
const PHASE_COLORS = ["#E8927C", "#7CC6E8", "#9BE87C", "#E8D67C", "#C47CE8"];

function buildCSEPPrompts(original, outputs) {
  return [
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `You are given a problem. Generate a rough working hypothesis — NOT a final answer, but your best first-pass attempt that tries to cover all elements of the problem. This is a starting point that will be refined later.\n\nProblem: ${original}\n\nLabel your response as WORKING HYPOTHESIS. Be concise.`
    },
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `You are given a problem and a working hypothesis for it.\n\nProblem: ${original}\n\nWorking hypothesis: ${outputs[0] || ""}\n\nNow identify:\n1. MASTER CONCEPT: One concept or category that best captures the global meaning of this problem.\n2. GLOBAL MEANING: In 3-4 sentences, describe what the core ideas are, what the goals are, and what a good answer must achieve.`
    },
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `You are given a problem, a working hypothesis, and a master concept analysis.\n\nProblem: ${original}\nWorking hypothesis: ${outputs[0] || ""}\nMaster concept: ${outputs[1] || ""}\n\nDecompose this problem into its constituent parts. For EACH part, provide:\n- SUB-CONCEPT: The category or concept that best describes this part\n- MEANING: 1-2 sentences on what this part means in the context of the whole problem\n\nThen examine each sub-concept: does it need further decomposition? If yes, repeat one level deeper. Up to three levels, but STOP when further decomposition adds no value.\n\nStructure as:\nLEVEL 1:\n  1.1 [sub-concept] — [meaning]\n  ...\nLEVEL 2 (only where needed):\n  1.1.1 [sub-concept] — [meaning]\n  ...`
    },
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `Answer the original problem using your full analysis.\n\nProblem: ${original}\n\nWorking hypothesis: ${outputs[0] || ""}\nMaster concept: ${outputs[1] || ""}\nDecomposition: ${outputs[2] || ""}\n\n1. Reconsider your working hypothesis in light of the decomposition. Is it still valid?\n2. Generate your answer. Be precise and concise.`
    },
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `Review this answer to the problem.\n\nProblem: ${original}\nAnswer: ${outputs[3] || ""}\nConceptual structure: ${outputs[2] || ""}\n\nCheck:\n1. Does every part align with the decomposition?\n2. Any errors, contradictions, or unsupported claims?\n\nIf corrections needed, provide corrected answer. If not, return unchanged.`
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
    `Evaluate whether this answer is correct for a classic puzzle that has been subtly altered.

QUESTION: ${q.question}

VERIFIED CORRECT ANSWER: ${q.correct_answer}

REASONING BEHIND CORRECT ANSWER: ${q.reasoning}

THE TRAP (what wrong answer the model typically gives): ${q.trap}

ANSWER TO EVALUATE: ${answer}

Judge strictly:
- The model must address the ACTUAL question, not a classic version.
- If it recites the classic puzzle's answer instead of responding to altered conditions, that is INCORRECT.
- If the model notices the alteration but still gives the classic answer, still INCORRECT.
- The model must arrive at the VERIFIED CORRECT ANSWER in substance.

Return ONLY this JSON:
{"correct": true or false, "fell_for_trap": true or false, "reason": "one sentence explanation"}`
  );
  return parseJSON(resp);
}

export default function CSEPvsBaseline() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [expandedPhase, setExpandedPhase] = useState({});
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
        // Run CSEP pipeline
        const phases = [];
        for (let i = 0; i < 5; i++) {
          if (stopRef.current) break;
          setProgress(`#${q.id}: CSEP faza ${i + 1}/5 (${PHASE_LABELS[i]})...`);
          setResults(prev => ({
            ...prev,
            [q.id]: { stage: `phase_${i + 1}`, phases: [...phases] }
          }));
          const p = buildCSEPPrompts(q.question, phases)[i];
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
            phases,
            csepFinal,
            judgment,
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
    const all = FAILED_QUESTIONS.map(q => ({ ...q, csep_result: results[q.id] || null }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `csep_vs_baseline_4.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const done = FAILED_QUESTIONS.filter(q => results[q.id]?.stage === "done");
  const csepFixed = done.filter(q => results[q.id].correct).length;
  const stillWrong = done.filter(q => !results[q.id].correct).length;

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
          }}>CSEP Pipeline vs Baseline — 4 failed questions</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            Da li CSEP ispravlja Haiku recitation failures?
          </h1>
          <div style={{ width: 60, height: 2,
            background: "linear-gradient(90deg, #E8927C, #7CC6E8, #9BE87C)",
            marginTop: "0.5rem" }} />
          <div style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", lineHeight: 1.55 }}>
            Pitanja gde je Haiku pao u zamku (surgeon riddle, bat & ball, no-boat crossing, locked room).
            Sad ista pitanja prolaze kroz CSEP pipeline: hipoteza → master koncept → dekompozicija →
            reintegracija → poliranje. Pitanje: da li CSEP prekida recitation pattern?
          </div>
        </div>

        {done.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.5rem", marginBottom: "1rem"
          }}>
            {[
              { label: "Obrađeno", val: `${done.length}/4`, color: "#bbb" },
              { label: "CSEP fixed", val: csepFixed, color: "#9BE87C" },
              { label: "Još greši", val: stillWrong, color: "#E8927C" },
              { label: "Success rate", val: done.length > 0 ? `${Math.round(csepFixed/done.length*100)}%` : "-", color: "#7CC6E8" }
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
          >{running ? "Running..." : done.length === 0 ? "Run CSEP on All 4" : `Continue (${4 - done.length})`}</button>

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
            >↓ Download All</button>
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
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                      padding: "2px 6px", borderRadius: 3,
                      background: "#2a1515", color: "#E8927C"
                    }}>BASE: ✗</span>
                    {r?.stage === "done" && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                        padding: "2px 6px", borderRadius: 3,
                        background: r.correct ? "#152015" : "#2a1515",
                        color: r.correct ? "#9BE87C" : "#E8927C"
                      }}>CSEP: {r.correct ? "✓" : "✗"}</span>
                    )}
                    {r && r.stage !== "done" && r.stage !== "error" && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.52rem",
                        padding: "2px 6px", borderRadius: 3,
                        background: "#151a1a", color: "#7CC6E8"
                      }}>CSEP: {r.stage}</span>
                    )}
                  </div>
                </div>

                {isEx && (
                  <div className="fade-in" style={{
                    padding: "0 0.85rem 0.85rem", borderTop: "1px solid #1a1a1e"
                  }}>
                    {/* Correct answer */}
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

                    {/* Side-by-side comparison */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr 1fr",
                      gap: "0.6rem", marginTop: "0.75rem"
                    }}>
                      {/* Baseline */}
                      <div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.54rem",
                          color: "#E8927C", textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 4
                        }}>Baseline (pao u zamku)</div>
                        <div style={{
                          background: "#0a0a0b", borderRadius: 6, padding: "0.6rem",
                          fontSize: "0.72rem", lineHeight: 1.55, color: "#bbb",
                          whiteSpace: "pre-wrap",
                          borderLeft: "2px solid #E8927C44",
                          maxHeight: 280, overflow: "auto"
                        }}>{q.baseline_answer}</div>
                      </div>

                      {/* CSEP */}
                      <div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.54rem",
                          color: r?.correct ? "#9BE87C" : "#E8927C",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 4
                        }}>CSEP finalni {r?.stage === "done" ? (r.correct ? "(popravljeno ✓)" : "(i dalje greši ✗)") : ""}</div>
                        {r?.csepFinal ? (
                          <>
                            <div style={{
                              background: "#0a0a0b", borderRadius: 6, padding: "0.6rem",
                              fontSize: "0.72rem", lineHeight: 1.55, color: "#bbb",
                              whiteSpace: "pre-wrap",
                              borderLeft: `2px solid ${r.correct ? "#9BE87C44" : "#E8927C44"}`,
                              maxHeight: 280, overflow: "auto"
                            }}>{r.csepFinal}</div>
                            {r.judgment?.reason && (
                              <div style={{
                                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                                color: "#888", marginTop: 5, fontStyle: "italic"
                              }}>Sudija: {r.judgment.reason}</div>
                            )}
                          </>
                        ) : (
                          <div style={{
                            background: "#0a0a0b", borderRadius: 6, padding: "0.8rem",
                            fontSize: "0.72rem", color: "#555", fontStyle: "italic",
                            borderLeft: "2px solid #333"
                          }}>
                            {r ? `${r.stage}...` : "Nije još pokrenuto"}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CSEP phases */}
                    {r?.phases && r.phases.length > 0 && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.54rem",
                          color: "#666", textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 5
                        }}>CSEP faze (klikni za detalje)</div>
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
                              maxHeight: 240, overflow: "auto",
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
