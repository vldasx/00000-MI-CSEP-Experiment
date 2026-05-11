import { useState, useRef, useCallback } from "react";

const DEFAULT_PROMPT = "Samantha saved $200 from her summer job. She spent one-fifth of her savings on books and one-fourth on clothes. Five of the books were hardcovers, and two had dog-eared pages. How much money does she have left?";

const PHASE_LABELS = [
  "Gruba hipoteza",
  "Master koncept",
  "Rekurzivna dekompozicija",
  "Reintegracija i odgovor",
  "Poliranje"
];

const PHASE_COLORS = [
  "#E8927C",
  "#7CC6E8",
  "#9BE87C",
  "#E8D67C",
  "#C47CE8"
];

function buildPhasePrompts(original, outputs) {
  return [
    // Phase 1 — Rough Hypothesis
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `You are given a problem. Generate a rough working hypothesis — NOT a final answer, but your best first-pass attempt that tries to cover all elements of the problem. This is a starting point that will be refined later.

Problem: ${original}

Label your response as WORKING HYPOTHESIS. Be concise.`
    },
    // Phase 2 — Master Concept
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `You are given a problem and a working hypothesis for it.

Problem: ${original}

Working hypothesis: ${outputs[0] || ""}

Now identify:
1. MASTER CONCEPT: One concept or category that best captures the global meaning of this problem (e.g., "proportional reasoning", "historical verification", "causal logic").
2. GLOBAL MEANING: In 3-4 sentences, describe what the core ideas are, what the goals are, and what a good answer must achieve.`
    },
    // Phase 3 — Recursive Decomposition
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `You are given a problem, a working hypothesis, and a master concept analysis.

Problem: ${original}
Working hypothesis: ${outputs[0] || ""}
Master concept: ${outputs[1] || ""}

Decompose this problem into its constituent parts. For EACH part, provide:
- SUB-CONCEPT: The category or concept that best describes this part
- MEANING: 1-2 sentences on what this part means in the context of the whole problem and how it relates to other parts

Then examine each sub-concept: does it need further decomposition? If yes, repeat the same process one level deeper. Continue up to three levels total, but STOP when further decomposition adds no value.

Structure your response as:

LEVEL 1:
  1.1 [sub-concept] — [meaning]
  1.2 [sub-concept] — [meaning]
  ...

LEVEL 2 (only where needed):
  1.1.1 [sub-concept] — [meaning]
  ...

LEVEL 3 (only where needed):
  ...`
    },
    // Phase 4 — Reintegration
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `You are now ready to answer the original problem. You have:

Problem: ${original}

Your initial working hypothesis:
${outputs[0] || ""}

Master concept and global meaning:
${outputs[1] || ""}

Full conceptual decomposition:
${outputs[2] || ""}

Now:
1. Reconsider your working hypothesis in light of the full decomposition. Is it still valid? Does it need correction?
2. Generate your answer. While constructing each part of your answer, keep in mind which specific sub-concept from the decomposition is relevant to what you are currently writing.
3. Be precise and concise.`
    },
    // Phase 5 — Polish
    {
      system: "You are a careful analytical assistant. Follow instructions precisely.",
      user: `Review the following answer to the given problem.

Problem: ${original}

Answer: ${outputs[3] || ""}

Conceptual structure: ${outputs[2] || ""}

Check:
1. Does every part of the answer align with the corresponding sub-concept from the decomposition?
2. Is the answer as a whole consistent with the master concept?
3. Are there any errors, contradictions, or unsupported claims?

If corrections are needed, provide the corrected answer. If no corrections are needed, return the answer unchanged.`
    }
  ];
}

async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(b => b.text || "").join("\n") || "";
}

export default function CSEPTest() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [baseline, setBaseline] = useState(null);
  const [phases, setPhases] = useState([]);
  const [running, setRunning] = useState(false);
  const [currentPhase, setCurrentPhase] = useState(-1);
  const [error, setError] = useState(null);
  const [expandedPhase, setExpandedPhase] = useState(null);
  const stopRef = useRef(false);

  const run = useCallback(async () => {
    if (!prompt.trim()) return;
    setRunning(true);
    setBaseline(null);
    setPhases([]);
    setCurrentPhase(-1);
    setError(null);
    setExpandedPhase(null);
    stopRef.current = false;

    try {
      // Baseline
      setCurrentPhase(0);
      const baseResp = await callClaude(
        "You are a helpful assistant. Answer precisely and concisely.",
        prompt
      );
      if (stopRef.current) return;
      setBaseline(baseResp);

      // CSEP Pipeline
      const outputs = [];
      const prompts = buildPhasePrompts(prompt, outputs);

      for (let i = 0; i < 5; i++) {
        if (stopRef.current) return;
        setCurrentPhase(i + 1);
        const p = buildPhasePrompts(prompt, outputs)[i];
        const resp = await callClaude(p.system, p.user);
        outputs.push(resp);
        setPhases(prev => [...prev, resp]);
      }

      setCurrentPhase(99);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [prompt]);

  const finalAnswer = phases[4] || phases[3] || null;
  const done = currentPhase === 99;

  return (
    <div style={{
      fontFamily: "'Newsreader', 'Georgia', serif",
      minHeight: "100vh",
      background: "#0a0a0b",
      color: "#e8e4df",
      padding: "2rem 1.5rem"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,600;1,6..72,400&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        textarea:focus, button:focus { outline: none; }
        .phase-card { transition: all 0.3s ease; cursor: pointer; }
        .phase-card:hover { transform: translateX(4px); }
        @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.4s ease forwards; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "2.5rem" }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7CC6E8",
            marginBottom: "0.5rem"
          }}>Conceptual Space Expansion Prompting</div>
          <h1 style={{
            fontSize: "1.8rem",
            fontWeight: 300,
            margin: 0,
            lineHeight: 1.3,
            color: "#f0ece6"
          }}>CSEP Pipeline Test</h1>
          <div style={{
            width: 60,
            height: 2,
            background: "linear-gradient(90deg, #E8927C, #7CC6E8, #9BE87C)",
            marginTop: "0.75rem"
          }} />
        </div>

        {/* Prompt Input */}
        <div style={{ marginBottom: "2rem" }}>
          <label style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.65rem",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "#888",
            display: "block",
            marginBottom: "0.5rem"
          }}>Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={running}
            rows={4}
            style={{
              width: "100%",
              background: "#141416",
              border: "1px solid #2a2a2e",
              borderRadius: 8,
              color: "#e8e4df",
              fontFamily: "'Newsreader', Georgia, serif",
              fontSize: "0.95rem",
              padding: "1rem",
              resize: "vertical",
              lineHeight: 1.6
            }}
          />
          <button
            onClick={run}
            disabled={running || !prompt.trim()}
            style={{
              marginTop: "0.75rem",
              background: running ? "#2a2a2e" : "#e8e4df",
              color: running ? "#666" : "#0a0a0b",
              border: "none",
              borderRadius: 6,
              padding: "0.6rem 1.8rem",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.75rem",
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: running ? "not-allowed" : "pointer"
            }}
          >
            {running ? "Running..." : "Run Comparison"}
          </button>
        </div>

        {error && (
          <div style={{
            background: "#2a1515",
            border: "1px solid #E8927C",
            borderRadius: 8,
            padding: "1rem",
            marginBottom: "1.5rem",
            fontSize: "0.85rem",
            color: "#E8927C"
          }}>Error: {error}</div>
        )}

        {/* Progress */}
        {running && (
          <div style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginBottom: "1.5rem",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.7rem",
            color: "#888"
          }}>
            <span style={{ animation: "pulse 1.5s infinite" }}>●</span>
            {currentPhase === 0 ? "Generišem baseline odgovor..." :
              `Faza ${currentPhase}/5 — ${PHASE_LABELS[currentPhase - 1] || ""}...`}
          </div>
        )}

        {/* Results */}
        {(baseline || phases.length > 0) && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>

            {/* Baseline */}
            {baseline && (
              <div className="fade-in">
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.65rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#888",
                  marginBottom: "0.5rem"
                }}>Baseline — direktan odgovor</div>
                <div style={{
                  background: "#141416",
                  border: "1px solid #2a2a2e",
                  borderRadius: 8,
                  padding: "1.25rem",
                  fontSize: "0.9rem",
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap"
                }}>{baseline}</div>
              </div>
            )}

            {/* CSEP Phases */}
            {phases.length > 0 && (
              <div className="fade-in">
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.65rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#888",
                  marginBottom: "0.75rem"
                }}>CSEP Pipeline — {phases.length}/5 faza završeno</div>

                {/* Phase cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
                  {phases.map((p, i) => (
                    <div
                      key={i}
                      className="phase-card"
                      onClick={() => setExpandedPhase(expandedPhase === i ? null : i)}
                      style={{
                        background: expandedPhase === i ? "#1a1a1e" : "#111113",
                        border: `1px solid ${expandedPhase === i ? PHASE_COLORS[i] + "66" : "#2a2a2e"}`,
                        borderLeft: `3px solid ${PHASE_COLORS[i]}`,
                        borderRadius: 6,
                        padding: "0.75rem 1rem",
                        fontSize: "0.8rem"
                      }}
                    >
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.7rem",
                          color: PHASE_COLORS[i]
                        }}>
                          Faza {i + 1} — {PHASE_LABELS[i]}
                        </span>
                        <span style={{
                          fontSize: "0.7rem",
                          color: "#555",
                          fontFamily: "'JetBrains Mono', monospace"
                        }}>
                          {expandedPhase === i ? "▼" : "▶"}
                        </span>
                      </div>
                      {expandedPhase === i && (
                        <div style={{
                          marginTop: "0.75rem",
                          paddingTop: "0.75rem",
                          borderTop: `1px solid ${PHASE_COLORS[i]}22`,
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.7,
                          fontSize: "0.85rem",
                          color: "#ccc8c0"
                        }}>{p}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Final CSEP Answer */}
                {done && finalAnswer && (
                  <div className="fade-in">
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.65rem",
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      color: "#9BE87C",
                      marginBottom: "0.5rem"
                    }}>CSEP — finalni odgovor</div>
                    <div style={{
                      background: "#141416",
                      border: "1px solid #9BE87C33",
                      borderRadius: 8,
                      padding: "1.25rem",
                      fontSize: "0.9rem",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap"
                    }}>{finalAnswer}</div>
                  </div>
                )}
              </div>
            )}

            {/* Side-by-side comparison */}
            {done && baseline && finalAnswer && (
              <div className="fade-in" style={{
                background: "#111113",
                border: "1px solid #2a2a2e",
                borderRadius: 8,
                padding: "1.25rem"
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.65rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#E8D67C",
                  marginBottom: "1rem"
                }}>Poređenje</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.6rem",
                      color: "#888",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: "0.4rem"
                    }}>Baseline</div>
                    <div style={{
                      background: "#0a0a0b",
                      borderRadius: 6,
                      padding: "1rem",
                      fontSize: "0.85rem",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      borderLeft: "2px solid #555"
                    }}>{baseline}</div>
                  </div>
                  <div>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.6rem",
                      color: "#9BE87C",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: "0.4rem"
                    }}>CSEP</div>
                    <div style={{
                      background: "#0a0a0b",
                      borderRadius: 6,
                      padding: "1rem",
                      fontSize: "0.85rem",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      borderLeft: "2px solid #9BE87C"
                    }}>{finalAnswer}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
