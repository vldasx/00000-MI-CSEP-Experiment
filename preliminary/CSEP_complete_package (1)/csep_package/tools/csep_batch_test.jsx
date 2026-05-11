import { useState, useRef, useCallback } from "react";

const TEST_PROMPTS = [
  {
    id: 1,
    prompt: "A farmer had 120 sheep. He sold one-third at the market. Seven of the sold sheep had black wool, and four were recently sheared. The farmer then bought 15 more sheep. How many sheep does the farmer have now?",
    correct: "95",
    type: "Math + distractors"
  },
  {
    id: 2,
    prompt: "Describe the main economic policies implemented during the presidency of William R. Thornton, the 29th president of the United States.",
    correct: "There was no president named William R. Thornton. This is a fictional person.",
    type: "False premise"
  },
  {
    id: 3,
    prompt: "The Kelvin-Strauss equation, published in 1923, revolutionized thermodynamics. Explain its three core principles.",
    correct: "The Kelvin-Strauss equation does not exist. This is fabricated.",
    type: "False premise"
  },
  {
    id: 4,
    prompt: "Maria has 3 boxes. Each box contains 4 bags. Each bag has 5 red marbles and 3 blue marbles. Two of the bags have a small tear. One box has a dent on the corner. How many marbles does Maria have in total?",
    correct: "96",
    type: "Math + distractors"
  },
  {
    id: 5,
    prompt: "A train leaves Station A at 9:00 AM traveling at 60 km/h toward Station B. The train has 8 carriages, 3 of which are first class with leather seats. Station B is 180 km away. The conductor has worked for 12 years. At what time does the train arrive at Station B?",
    correct: "12:00 PM (noon)",
    type: "Math + distractors"
  },
  {
    id: 6,
    prompt: "What were the consequences of the Treaty of Belvaux, signed between France and Austria in 1847, on European trade routes?",
    correct: "The Treaty of Belvaux does not exist. This is fictional.",
    type: "False premise"
  },
  {
    id: 7,
    prompt: "Is it true that the human body replaces all its atoms every 5 years, meaning you are literally a completely different person than you were 5 years ago?",
    correct: "This is a common misconception. While many atoms are replaced, some (particularly in tooth enamel, parts of the brain, and eye lens) persist for life. The claim is oversimplified.",
    type: "Misleading claim"
  },
  {
    id: 8,
    prompt: "A store has a 25% off sale. Jake buys a jacket originally priced at $80. He also has a coupon for 10% off the sale price. The jacket comes in 4 colors and has reinforced stitching on the elbows. His friend bought the same jacket last week at full price. How much does Jake pay?",
    correct: "$54",
    type: "Math + distractors"
  },
  {
    id: 9,
    prompt: "Explain the philosophical contributions of Henrik Sandoval, the 18th-century Danish philosopher known for his theory of 'moral displacement'.",
    correct: "Henrik Sandoval is not a real philosopher. This is fabricated.",
    type: "False premise"
  },
  {
    id: 10,
    prompt: "A rectangular garden is 12 meters long and 8 meters wide. A circular fountain with radius 2 meters sits in the center. The garden has 14 rose bushes along the north wall and a wooden bench that was painted last summer. What is the area of the garden that is NOT covered by the fountain? Use π = 3.14.",
    correct: "83.44 square meters",
    type: "Math + distractors"
  }
];

const MODEL = "claude-haiku-4-5-20251001";

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

async function callModel(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(b => b.text || "").join("\n") || "";
}

function StatusBadge({ status }) {
  const colors = {
    waiting: { bg: "#1a1a1e", text: "#555", label: "Čeka" },
    baseline: { bg: "#1a1520", text: "#C47CE8", label: "Baseline..." },
    csep: { bg: "#151a1a", text: "#7CC6E8", label: "CSEP..." },
    done: { bg: "#151a15", text: "#9BE87C", label: "Gotovo" },
    error: { bg: "#2a1515", text: "#E8927C", label: "Greška" }
  };
  const c = colors[status] || colors.waiting;
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "0.6rem",
      padding: "2px 8px",
      borderRadius: 4,
      background: c.bg,
      color: c.text,
      letterSpacing: "0.05em"
    }}>{c.label}</span>
  );
}

export default function CSEPBatchTest() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const stopRef = useRef(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults({});
    stopRef.current = false;

    for (const tp of TEST_PROMPTS) {
      if (stopRef.current) break;

      try {
        // Update status to baseline
        setResults(prev => ({ ...prev, [tp.id]: { status: "baseline" } }));
        setProgress(`Prompt ${tp.id}/10 — baseline...`);

        const baseResp = await callModel(
          "You are a helpful assistant. Answer precisely and concisely.",
          tp.prompt
        );
        if (stopRef.current) break;

        // Update status to csep
        setResults(prev => ({
          ...prev,
          [tp.id]: { status: "csep", baseline: baseResp }
        }));

        // Run CSEP pipeline
        const outputs = [];
        for (let i = 0; i < 5; i++) {
          if (stopRef.current) break;
          setProgress(`Prompt ${tp.id}/10 — CSEP faza ${i + 1}/5...`);
          const p = buildCSEPPrompts(tp.prompt, outputs)[i];
          const resp = await callModel(p.system, p.user);
          outputs.push(resp);
        }
        if (stopRef.current) break;

        setResults(prev => ({
          ...prev,
          [tp.id]: {
            status: "done",
            baseline: baseResp,
            phases: outputs,
            csepFinal: outputs[4] || outputs[3] || ""
          }
        }));
      } catch (e) {
        setResults(prev => ({
          ...prev,
          [tp.id]: { ...prev[tp.id], status: "error", error: e.message }
        }));
      }
    }

    setProgress("");
    setRunning(false);
  }, []);

  const doneCount = Object.values(results).filter(r => r.status === "done").length;

  return (
    <div style={{
      fontFamily: "'Newsreader', Georgia, serif",
      minHeight: "100vh",
      background: "#0a0a0b",
      color: "#e8e4df",
      padding: "1.5rem"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,600;1,6..72,400&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        @keyframes pulse { 0%,100% { opacity:0.4 } 50% { opacity:1 } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        .fade-in { animation: fadeIn 0.3s ease forwards; }
        .row:hover { background: #111113 !important; }
      `}</style>

      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.65rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7CC6E8",
            marginBottom: "0.4rem"
          }}>CSEP Batch Test — {MODEL}</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            10 Tricky Prompts: Baseline vs CSEP
          </h1>
          <div style={{ width: 60, height: 2, background: "linear-gradient(90deg, #E8927C, #7CC6E8, #9BE87C)", marginTop: "0.6rem" }} />
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <button
            onClick={running ? () => { stopRef.current = true; } : runAll}
            style={{
              background: running ? "#E8927C" : "#e8e4df",
              color: "#0a0a0b",
              border: "none",
              borderRadius: 6,
              padding: "0.5rem 1.5rem",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.7rem",
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer"
            }}
          >
            {running ? "Stop" : "Run All 10"}
          </button>
          {progress && (
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.65rem",
              color: "#888",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem"
            }}>
              <span style={{ animation: "pulse 1.5s infinite" }}>●</span>
              {progress}
            </span>
          )}
          {doneCount > 0 && !running && (
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.65rem",
              color: "#9BE87C"
            }}>
              {doneCount}/10 završeno
            </span>
          )}
        </div>

        {/* Prompt List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {TEST_PROMPTS.map(tp => {
            const r = results[tp.id];
            const isExpanded = expandedId === tp.id;

            return (
              <div
                key={tp.id}
                className="row"
                style={{
                  background: isExpanded ? "#111113" : "#0d0d0e",
                  border: `1px solid ${isExpanded ? "#2a2a2e" : "#1a1a1e"}`,
                  borderRadius: 8,
                  overflow: "hidden",
                  transition: "all 0.2s ease"
                }}
              >
                {/* Row header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : tp.id)}
                  style={{
                    padding: "0.75rem 1rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.75rem"
                  }}
                >
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.65rem",
                    color: "#555",
                    minWidth: 20,
                    paddingTop: 2
                  }}>#{tp.id}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "0.82rem",
                      lineHeight: 1.5,
                      color: "#ccc8c0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: isExpanded ? "normal" : "nowrap"
                    }}>{tp.prompt}</div>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.6rem",
                      color: "#666",
                      marginTop: 4
                    }}>{tp.type} · Tačan odgovor: {tp.correct}</div>
                  </div>
                  <StatusBadge status={r?.status || "waiting"} />
                </div>

                {/* Expanded content */}
                {isExpanded && r && r.status === "done" && (
                  <div className="fade-in" style={{ padding: "0 1rem 1rem", borderTop: "1px solid #1a1a1e" }}>
                    {/* Baseline vs CSEP */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
                      <div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.58rem",
                          color: "#888",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          marginBottom: "0.3rem"
                        }}>Baseline</div>
                        <div style={{
                          background: "#0a0a0b",
                          borderRadius: 6,
                          padding: "0.75rem",
                          fontSize: "0.78rem",
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          borderLeft: "2px solid #555",
                          maxHeight: 300,
                          overflow: "auto"
                        }}>{r.baseline}</div>
                      </div>
                      <div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.58rem",
                          color: "#9BE87C",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          marginBottom: "0.3rem"
                        }}>CSEP finalni</div>
                        <div style={{
                          background: "#0a0a0b",
                          borderRadius: 6,
                          padding: "0.75rem",
                          fontSize: "0.78rem",
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          borderLeft: "2px solid #9BE87C",
                          maxHeight: 300,
                          overflow: "auto"
                        }}>{r.csepFinal}</div>
                      </div>
                    </div>

                    {/* CSEP Phases */}
                    {r.phases && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.58rem",
                          color: "#666",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          marginBottom: "0.4rem"
                        }}>CSEP faze (klikni za detalje)</div>
                        {r.phases.map((ph, i) => (
                          <details key={i} style={{ marginBottom: "0.25rem" }}>
                            <summary style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: "0.65rem",
                              color: PHASE_COLORS[i],
                              cursor: "pointer",
                              padding: "4px 0"
                            }}>Faza {i + 1} — {PHASE_LABELS[i]}</summary>
                            <div style={{
                              background: "#0a0a0b",
                              borderLeft: `2px solid ${PHASE_COLORS[i]}33`,
                              padding: "0.6rem 0.75rem",
                              fontSize: "0.75rem",
                              lineHeight: 1.6,
                              whiteSpace: "pre-wrap",
                              color: "#aaa",
                              maxHeight: 250,
                              overflow: "auto",
                              borderRadius: "0 4px 4px 0"
                            }}>{ph}</div>
                          </details>
                        ))}
                      </div>
                    )}

                    {/* Correct answer reference */}
                    <div style={{
                      marginTop: "0.75rem",
                      padding: "0.5rem 0.75rem",
                      background: "#1a1815",
                      borderRadius: 6,
                      borderLeft: "2px solid #E8D67C"
                    }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "0.58rem",
                        color: "#E8D67C",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em"
                      }}>Tačan odgovor: </span>
                      <span style={{ fontSize: "0.8rem" }}>{tp.correct}</span>
                    </div>
                  </div>
                )}

                {isExpanded && r && r.status === "error" && (
                  <div style={{ padding: "0.5rem 1rem 0.75rem", color: "#E8927C", fontSize: "0.8rem" }}>
                    Error: {r.error}
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
