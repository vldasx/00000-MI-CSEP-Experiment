import { useState, useRef, useCallback } from "react";

const MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-sonnet-4-20250514";

const QUESTION_TYPES = [
  {
    id: "math_distractors",
    name: "Matematika sa distraktorima",
    prompt: `Generate a math word problem with the following structure:
- A clear mathematical question that requires 2-3 calculation steps
- Include 3-4 pieces of IRRELEVANT information (colors, names, past events, descriptive details) designed to distract
- The problem should be solvable but the distractors should make it easy to lose track

Return ONLY a JSON object (no markdown, no backticks):
{
  "question": "the complete word problem",
  "correct_answer": "the numerical answer with units if applicable",
  "explanation": "brief explanation of the solution ignoring distractors"
}`
  },
  {
    id: "false_premise",
    name: "Lažne premise",
    prompt: `Generate a question based on a COMPLETELY FICTIONAL premise:
- Invent a non-existent historical event, person, scientific theory, or treaty
- Make it sound plausible (use realistic names, dates, contexts)
- Ask the model to explain or describe it

Return ONLY a JSON object (no markdown, no backticks):
{
  "question": "the question with false premise",
  "correct_answer": "The model should refuse and state that [X] does not exist / is fictional",
  "explanation": "what is fictional in this question"
}`
  },
  {
    id: "misleading",
    name: "Obmanjujuće tvrdnje",
    prompt: `Generate a question about a common misconception or oversimplified claim:
- State a popular but incorrect or oversimplified belief
- Ask if it's true

Return ONLY a JSON object (no markdown, no backticks):
{
  "question": "the question stating the misconception",
  "correct_answer": "explanation of why the claim is false or oversimplified",
  "explanation": "what makes this claim misleading"
}`
  }
];

async function callAPI(model, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(b => b.text || "").join("\n") || "";
}

async function generateQuestion(type) {
  const resp = await callAPI(
    JUDGE_MODEL,
    "You are a question generator. Follow instructions precisely.",
    type.prompt
  );
  try {
    const clean = resp.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return { ...parsed, type: type.id };
  } catch (e) {
    throw new Error(`Failed to parse question: ${e.message}`);
  }
}

async function testBaseline(question) {
  return await callAPI(
    MODEL,
    "You are a helpful assistant. Answer precisely and concisely.",
    question
  );
}

async function judgeAnswer(question, answer, correctAnswer) {
  const resp = await callAPI(
    JUDGE_MODEL,
    "You are a strict evaluator. Respond with ONLY a JSON object, no markdown, no backticks.",
    `Evaluate if this answer is correct.

QUESTION: ${question}

CORRECT ANSWER: ${correctAnswer}

ANSWER TO EVALUATE: ${answer}

Judge strictly:
- For math: the final numerical answer must be correct
- For false premises: the model MUST identify the premise as false/fictional. If it fabricates an answer, that is WRONG.
- For misleading claims: the model must identify the claim as false or oversimplified

Respond with ONLY this JSON (no backticks, no markdown):
{"correct": true or false, "reason": "one sentence explanation"}`
  );
  try {
    const clean = resp.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { correct: false, reason: "Could not parse evaluation" };
  }
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function QuestionFilter() {
  const [questions, setQuestions] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [phase, setPhase] = useState("idle"); // idle, generating, testing, done
  const stopRef = useRef(false);

  const generate = useCallback(async (count) => {
    setRunning(true);
    setQuestions([]);
    setPhase("generating");
    stopRef.current = false;

    const generated = [];
    const perType = Math.floor(count / 3);

    try {
      for (const type of QUESTION_TYPES) {
        for (let i = 0; i < perType; i++) {
          if (stopRef.current) break;
          setProgress(`Generišem pitanja: ${generated.length + 1}/${count} (${type.name})`);
          
          const q = await generateQuestion(type);
          generated.push({
            id: generated.length + 1,
            ...q,
            status: "generated"
          });
          setQuestions([...generated]);
        }
        if (stopRef.current) break;
      }

      if (stopRef.current) {
        setRunning(false);
        return;
      }

      // Test baseline
      setPhase("testing");
      for (let i = 0; i < generated.length; i++) {
        if (stopRef.current) break;
        const q = generated[i];
        setProgress(`Testiram baseline: ${i + 1}/${generated.length}`);

        const baseResp = await testBaseline(q.question);
        const judgment = await judgeAnswer(q.question, baseResp, q.correct_answer);

        generated[i] = {
          ...q,
          baseline_answer: baseResp,
          baseline_correct: judgment.correct,
          baseline_reason: judgment.reason,
          status: judgment.correct ? "passed" : "failed"
        };
        setQuestions([...generated]);
      }

      setPhase("done");
      setProgress("");
    } catch (e) {
      setProgress(`Greška: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }, []);

  const failedQuestions = questions.filter(q => q.status === "failed");
  const passedQuestions = questions.filter(q => q.status === "passed");
  const untested = questions.filter(q => q.status === "generated");

  const exportFailed = () => {
    const dataset = failedQuestions.map(q => ({
      id: q.id,
      type: q.type,
      question: q.question,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      baseline_failed_answer: q.baseline_answer,
      baseline_reason: q.baseline_reason
    }));
    downloadJSON(dataset, "csep_test_questions.json");
  };

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
        @keyframes pulse { 0%,100%{opacity:0.4}50%{opacity:1} }
        button:disabled { opacity: 0.4; cursor: not-allowed !important; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7CC6E8",
            marginBottom: "0.3rem"
          }}>Question Generator & Filter</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            Generiši i filtriraj pitanja gde Haiku greši
          </h1>
          <div style={{ width: 60, height: 2, background: "linear-gradient(90deg, #E8927C, #7CC6E8, #9BE87C)", marginTop: "0.5rem" }} />
        </div>

        {/* Stats */}
        {questions.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.75rem",
            marginBottom: "1.25rem"
          }}>
            {[
              { label: "Ukupno", val: questions.length, color: "#888" },
              { label: "Model pogrešio", val: failedQuestions.length, color: "#E8927C" },
              { label: "Model tačan", val: passedQuestions.length, color: "#9BE87C" },
              { label: "Netestirano", val: untested.length, color: "#7CC6E8" }
            ].map((s, i) => (
              <div key={i} style={{
                background: "#111113",
                border: "1px solid #1e1e22",
                borderRadius: 8,
                padding: "0.75rem",
                textAlign: "center"
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "1.6rem",
                  fontWeight: 500,
                  color: s.color
                }}>{s.val}</div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.55rem",
                  color: "#666",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginTop: 4
                }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <button
            onClick={() => generate(30)}
            disabled={running}
            style={{
              background: "#e8e4df",
              color: "#0a0a0b",
              border: "none",
              borderRadius: 6,
              padding: "0.5rem 1.25rem",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer"
            }}
          >Generiši 30</button>
          
          <button
            onClick={() => generate(100)}
            disabled={running}
            style={{
              background: "#7CC6E8",
              color: "#0a0a0b",
              border: "none",
              borderRadius: 6,
              padding: "0.5rem 1.25rem",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              fontWeight: 500,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer"
            }}
          >Generiši 100</button>

          {failedQuestions.length > 0 && (
            <button
              onClick={exportFailed}
              style={{
                background: "#9BE87C",
                color: "#0a0a0b",
                border: "none",
                borderRadius: 6,
                padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.68rem",
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                cursor: "pointer"
              }}
            >Export {failedQuestions.length} Failed Questions</button>
          )}

          {running && (
            <button
              onClick={() => { stopRef.current = true; }}
              style={{
                background: "#E8927C",
                color: "#0a0a0b",
                border: "none",
                borderRadius: 6,
                padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.68rem",
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                cursor: "pointer"
              }}
            >Stop</button>
          )}
        </div>

        {progress && (
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.65rem",
            color: "#888",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}>
            <span style={{ animation: "pulse 1.5s infinite" }}>●</span>
            {progress}
          </div>
        )}

        {/* Question List */}
        {questions.length > 0 && (
          <div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.6rem",
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: "0.5rem"
            }}>Pitanja ({questions.length})</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {questions.map(q => (
                <div key={q.id} style={{
                  background: "#0d0d0e",
                  border: `1px solid ${
                    q.status === "failed" ? "#E8927C33" :
                    q.status === "passed" ? "#9BE87C33" :
                    "#1a1a1e"
                  }`,
                  borderLeft: `3px solid ${
                    q.status === "failed" ? "#E8927C" :
                    q.status === "passed" ? "#9BE87C" :
                    "#7CC6E8"
                  }`,
                  borderRadius: 6,
                  padding: "0.65rem 0.85rem"
                }}>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.6rem",
                      color: "#444",
                      minWidth: 24
                    }}>#{q.id}</span>
                    
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.82rem", lineHeight: 1.5, marginBottom: 4 }}>
                        {q.question}
                      </div>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "0.58rem",
                        color: "#666",
                        marginTop: 6
                      }}>
                        <span style={{ color: "#888" }}>Tačan:</span> {q.correct_answer}
                      </div>
                      
                      {q.baseline_answer && (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "0.58rem",
                            color: q.baseline_correct ? "#9BE87C" : "#E8927C",
                            cursor: "pointer"
                          }}>
                            Baseline: {q.baseline_correct ? "TAČNO" : "NETAČNO"}
                            {q.baseline_reason && ` — ${q.baseline_reason}`}
                          </summary>
                          <div style={{
                            background: "#0a0a0b",
                            borderRadius: 4,
                            padding: "0.5rem",
                            marginTop: 4,
                            fontSize: "0.75rem",
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                            borderLeft: `2px solid ${q.baseline_correct ? "#9BE87C33" : "#E8927C33"}`
                          }}>{q.baseline_answer}</div>
                        </details>
                      )}
                    </div>

                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.55rem",
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: 
                        q.status === "failed" ? "#2a1515" :
                        q.status === "passed" ? "#152015" :
                        "#151a1a",
                      color:
                        q.status === "failed" ? "#E8927C" :
                        q.status === "passed" ? "#9BE87C" :
                        "#7CC6E8"
                    }}>
                      {q.status === "failed" ? "FAILED" :
                       q.status === "passed" ? "PASSED" :
                       "GEN"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
