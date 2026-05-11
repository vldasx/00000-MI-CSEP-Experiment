import { useState, useRef, useCallback, useEffect } from "react";

const TARGET_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-opus-4-5-20250929";
const STORAGE_KEY = "cot_test_4";

const FAILED_QUESTIONS = [
  {
    id: 1,
    subtype: "surgeon_explicit_father",
    question: "A man and his son are in a car accident. They are rushed to the hospital. The surgeon looks at the boy and says, 'I can operate on this boy — he is my son!' The surgeon is the boy's father. How is this possible?",
    correct_answer: "It is straightforwardly possible — the father is a surgeon and is confirming he can perform the operation on his son. There is no puzzle or twist.",
    reasoning: "Altered 'surgeon is the mother' riddle. Models often recite classic answer.",
    trap: "Model recites classic riddle answer despite explicit contrary information",
    baseline_answer: "The surgeon is the boy's mother...",
    csep_v1: "✗ (still recited classic)",
    csep_v2: "✓ (v2 succeeded)"
  },
  {
    id: 5,
    subtype: "bat_ball_direct",
    question: "A bat and a ball cost $1.10 in total. The bat costs $1.00. How much does the ball cost?",
    correct_answer: "$0.10 (ten cents). $1.00 + $0.10 = $1.10.",
    reasoning: "Altered CRT. Bat price given directly, so ball is 10 cents.",
    trap: "Model recites classic 5 cents despite direct price",
    baseline_answer: "$0.05 (imported 'bat costs $1.00 more than ball')",
    csep_v1: "✓ (v1 succeeded)",
    csep_v2: "✓ (v2 succeeded)"
  },
  {
    id: 7,
    subtype: "no_boat_wade",
    question: "A man has a wolf, a goat, and a cabbage. He needs to get all of them across a river. There is no boat. The river is shallow enough to wade through. The wolf would eat the goat if left alone with it, and the goat would eat the cabbage if left alone with it. How does he get them across?",
    correct_answer: "He simply walks through the shallow river bringing all three with him at once.",
    reasoning: "No boat removes capacity constraint entirely.",
    trap: "Model recites classic multi-trip solution despite no boat",
    baseline_answer: "Multi-trip solution with shuttling goat back",
    csep_v1: "✗ (invented 'one at a time' constraint)",
    csep_v2: "✓ (v2 succeeded)"
  },
  {
    id: 20,
    subtype: "dead_locked_room",
    question: "A man is found dead in a locked room. There is a puddle of water on the floor and a broken piece of glass. The room has no windows and the door was locked from the inside. The coroner rules the death was NOT caused by drowning, NOT caused by glass injury, NOT caused by poisoning, and NOT caused by heart attack. How did he die?",
    correct_answer: "There is not enough information. All commonly-cited causes have been ruled out.",
    reasoning: "Classic solution is hanging from melted ice. Altered rules out all common answers.",
    trap: "Model recites classic 'ice cube hanging' despite explicit exclusions",
    baseline_answer: "Stood on block of ice and hanged himself",
    csep_v1: "✗ (still defended classic)",
    csep_v2: "✓ (v2 succeeded)"
  }
];

// Standard Chain-of-Thought prompt
async function callCoT(question) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TARGET_MODEL,
      max_tokens: 1500,
      system: "You are a helpful assistant. Answer precisely.",
      messages: [{
        role: "user",
        content: `${question}\n\nLet's think step by step before giving the final answer.`
      }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(b => b.text || "").join("\n") || "";
}

async function callAPI(model, system, user, maxTokens = 1000) {
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
    `Evaluate whether this answer is correct for a classic puzzle with altered conditions.

QUESTION: ${q.question}
CORRECT ANSWER: ${q.correct_answer}
REASONING: ${q.reasoning}
TRAP: ${q.trap}

ANSWER TO EVALUATE: ${answer}

Judge strictly. If the model recited the classic puzzle's answer instead of responding to altered conditions, INCORRECT. Must arrive at verified correct answer.

Return ONLY: {"correct": true or false, "fell_for_trap": true or false, "reason": "one sentence"}`
  );
  return parseJSON(resp);
}

export default function CoTTest() {
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
        setProgress(`#${q.id}: CoT reasoning...`);
        setResults(prev => ({ ...prev, [q.id]: { stage: "cot" } }));

        const cotAnswer = await callCoT(q.question);

        setProgress(`#${q.id}: judging...`);
        setResults(prev => ({ ...prev, [q.id]: { stage: "judging", cotAnswer } }));

        const judgment = await judge(q, cotAnswer);

        setResults(prev => ({
          ...prev,
          [q.id]: {
            stage: "done",
            cotAnswer,
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
    const all = FAILED_QUESTIONS.map(q => ({ ...q, cot_result: results[q.id] || null }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cot_results.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const done = FAILED_QUESTIONS.filter(q => results[q.id]?.stage === "done");
  const cotFixed = done.filter(q => results[q.id].correct).length;

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
            color: "#E8D67C", marginBottom: "0.3rem"
          }}>Chain-of-Thought Baseline — 4 failed questions</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            Da li CoT rešava recitation failures?
          </h1>
          <div style={{ width: 60, height: 2,
            background: "linear-gradient(90deg, #E8927C, #E8D67C, #7CC6E8)",
            marginTop: "0.5rem" }} />
          <div style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", lineHeight: 1.55 }}>
            Standardni CoT: "Let's think step by step before giving the final answer."
            Nijedna dekompozicija, nijedna eksplicitna provera recitation-a. Samo prošireni prostor
            za razmišljanje u jednom prolazu. Porediće se sa baseline (0/4), CSEP v1 (1/4) i CSEP v2 (4/4).
          </div>
        </div>

        {/* Comparison banner */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          gap: "0.5rem", marginBottom: "1.25rem"
        }}>
          {[
            { label: "Baseline", val: "0/4", color: "#E8927C", desc: "0%" },
            { label: "CoT", val: done.length > 0 ? `${cotFixed}/${done.length}` : "?", color: "#E8D67C", desc: done.length > 0 ? `${Math.round(cotFixed/4*100)}%` : "testing..." },
            { label: "CSEP v1", val: "1/4", color: "#C47CE8", desc: "25%" },
            { label: "CSEP v2", val: "4/4", color: "#9BE87C", desc: "100%" }
          ].map((s, i) => (
            <div key={i} style={{
              background: "#111113",
              border: `1px solid ${s.color}33`,
              borderRadius: 8, padding: "0.7rem", textAlign: "center"
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.55rem", color: "#666",
                textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3
              }}>{s.label}</div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "1.4rem", fontWeight: 500, color: s.color
              }}>{s.val}</div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.55rem", color: "#888",
                marginTop: 2
              }}>{s.desc}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={runAll} disabled={running}
            style={{
              background: "#e8e4df", color: "#0a0a0b", border: "none",
              borderRadius: 6, padding: "0.5rem 1.25rem",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
              fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
            }}
          >{running ? "Running..." : done.length === 0 ? "Run CoT on 4" : `Continue (${4 - done.length})`}</button>

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

                  <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                      padding: "2px 5px", borderRadius: 3,
                      background: "#2a1515", color: "#E8927C"
                    }}>BASE✗</span>
                    {r?.stage === "done" && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                        padding: "2px 5px", borderRadius: 3,
                        background: r.correct ? "#1a2015" : "#2a1a15",
                        color: r.correct ? "#E8D67C" : "#E8927C"
                      }}>CoT{r.correct ? "✓" : "✗"}</span>
                    )}
                    {r && r.stage !== "done" && r.stage !== "error" && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                        padding: "2px 5px", borderRadius: 3,
                        background: "#151a1a", color: "#7CC6E8"
                      }}>CoT...</span>
                    )}
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                      padding: "2px 5px", borderRadius: 3,
                      background: q.id === 5 ? "#152015" : "#2a1515",
                      color: q.id === 5 ? "#9BE87C" : "#E8927C"
                    }}>v1{q.id === 5 ? "✓" : "✗"}</span>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                      padding: "2px 5px", borderRadius: 3,
                      background: "#152015", color: "#9BE87C"
                    }}>v2✓</span>
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

                    {r?.cotAnswer && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.54rem",
                          color: r.correct ? "#9BE87C" : "#E8927C",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em", marginBottom: 4
                        }}>Chain-of-Thought odgovor {r.correct ? "✓ TAČNO" : "✗ NETAČNO"}</div>
                        <div style={{
                          background: "#0a0a0b", borderRadius: 6, padding: "0.6rem",
                          fontSize: "0.72rem", lineHeight: 1.55, color: "#bbb",
                          whiteSpace: "pre-wrap",
                          borderLeft: `2px solid ${r.correct ? "#9BE87C44" : "#E8927C44"}`,
                          maxHeight: 400, overflow: "auto"
                        }}>{r.cotAnswer}</div>
                        {r.judgment?.reason && (
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.62rem",
                            color: "#888", marginTop: 5, fontStyle: "italic"
                          }}>Sudija: {r.judgment.reason}</div>
                        )}
                      </div>
                    )}

                    <div style={{ marginTop: "0.75rem", fontSize: "0.7rem", color: "#666" }}>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.54rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Kontekst:</div>
                      <div>Baseline: {q.baseline_answer}</div>
                      <div>CSEP v1: {q.csep_v1}</div>
                      <div>CSEP v2: {q.csep_v2}</div>
                    </div>

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
