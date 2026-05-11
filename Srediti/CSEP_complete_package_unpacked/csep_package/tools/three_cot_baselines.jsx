import { useState, useRef, useCallback, useEffect } from "react";

const TARGET_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-opus-4-5-20250929";
const STORAGE_KEY = "three_cot_baselines_v1";

const FAILED_QUESTIONS = [
  {
    id: 1,
    subtype: "surgeon_explicit_father",
    question: "A man and his son are in a car accident. They are rushed to the hospital. The surgeon looks at the boy and says, 'I can operate on this boy — he is my son!' The surgeon is the boy's father. How is this possible?",
    correct_answer: "It is straightforwardly possible — the father is a surgeon and is confirming he can perform the operation on his son. There is no puzzle.",
    reasoning: "Altered 'surgeon is the mother' riddle. The altered version explicitly states surgeon IS the father.",
    trap: "Model recites classic riddle answer despite explicit contrary information"
  },
  {
    id: 5,
    subtype: "bat_ball_direct",
    question: "A bat and a ball cost $1.10 in total. The bat costs $1.00. How much does the ball cost?",
    correct_answer: "$0.10 (ten cents). $1.00 + $0.10 = $1.10.",
    reasoning: "Altered CRT. Bat price given directly, so ball is 10 cents.",
    trap: "Model recites classic 5 cents despite direct price"
  },
  {
    id: 7,
    subtype: "no_boat_wade",
    question: "A man has a wolf, a goat, and a cabbage. He needs to get all of them across a river. There is no boat. The river is shallow enough to wade through. The wolf would eat the goat if left alone with it, and the goat would eat the cabbage if left alone with it. How does he get them across?",
    correct_answer: "He simply walks through the shallow river bringing all three with him at once.",
    reasoning: "No boat removes capacity constraint entirely.",
    trap: "Model recites classic multi-trip solution despite no boat"
  },
  {
    id: 20,
    subtype: "dead_locked_room",
    question: "A man is found dead in a locked room. There is a puddle of water on the floor and a broken piece of glass. The room has no windows and the door was locked from the inside. The coroner rules the death was NOT caused by drowning, NOT caused by glass injury, NOT caused by poisoning, and NOT caused by heart attack. How did he die?",
    correct_answer: "There is not enough information. All commonly-cited causes have been ruled out.",
    reasoning: "Classic solution is hanging from melted ice. Altered rules out all common answers.",
    trap: "Model recites classic 'ice cube hanging' despite explicit exclusions"
  }
];

// =================================================================
// METHOD 1: STANDARD COT
// =================================================================
async function standardCoT(question) {
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

// =================================================================
// METHOD 2: SELF-CONSISTENCY COT (5 independent runs + majority vote)
// =================================================================
async function selfConsistencyCoT(question, runs = 5) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TARGET_MODEL,
        max_tokens: 1200,
        // Higher temperature for diversity across samples
        temperature: 0.7,
        system: "You are a helpful assistant. Answer precisely.",
        messages: [{
          role: "user",
          content: `${question}\n\nLet's think step by step before giving the final answer.`
        }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const text = data.content?.map(b => b.text || "").join("\n") || "";
    samples.push(text);
  }

  // Extract the "final answer" claim from each sample using a simple judge pass
  // to normalize and compare
  const extractRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 600,
      system: "Extract and normalize final answers. Return only JSON.",
      messages: [{
        role: "user",
        content: `Here are ${runs} independent answers to the same question.
For each answer, extract the FINAL claim the model makes (one short sentence per answer).
Then identify the most common answer (majority vote).

Question: ${question}

Answers:
${samples.map((s, i) => `--- SAMPLE ${i+1} ---\n${s}`).join("\n\n")}

Return ONLY JSON:
{
  "normalized_answers": ["answer from sample 1", "answer from sample 2", ...],
  "majority_answer": "the most common answer claim",
  "vote_counts": {"claim1": count, "claim2": count}
}`
      }]
    })
  });
  const extractData = await extractRes.json();
  if (extractData.error) throw new Error(extractData.error.message);
  const extractText = extractData.content?.map(b => b.text || "").join("\n") || "";
  const clean = extractText.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  let extracted = null;
  try {
    extracted = JSON.parse(match[0]);
  } catch (e) {
    extracted = { majority_answer: "Could not parse", normalized_answers: [], vote_counts: {} };
  }

  return {
    samples,
    normalized_answers: extracted.normalized_answers || [],
    majority_answer: extracted.majority_answer || "",
    vote_counts: extracted.vote_counts || {},
    final: extracted.majority_answer || samples[0]
  };
}

// =================================================================
// METHOD 3: REAL TREE OF THOUGHTS (explicit tree search)
// =================================================================
// Classical ToT (Yao et al. 2023):
//   - Generate multiple thought branches
//   - Evaluate each branch's promise independently
//   - Expand the most promising branches
//   - Select the best final solution

async function treeOfThoughts(question) {
  // STEP 1: Generate 3 distinct thought branches (different starting approaches)
  const branchGenRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TARGET_MODEL,
      max_tokens: 1000,
      system: "You are exploring reasoning branches. Propose distinct starting approaches.",
      messages: [{
        role: "user",
        content: `Problem: ${question}

Generate 3 DISTINCT initial reasoning branches for this problem. Each branch should open with a different analytical lens:
- BRANCH A: Take the problem at face value, reason directly from stated conditions
- BRANCH B: Treat as a trick or puzzle, look for hidden twists
- BRANCH C: Check for unstated assumptions or missing information

For each branch, write 2-3 sentences of opening reasoning (do NOT solve yet — just open the thought).

Return ONLY JSON:
{
  "branch_a": "2-3 sentences of opening reasoning for branch A",
  "branch_b": "2-3 sentences of opening reasoning for branch B",
  "branch_c": "2-3 sentences of opening reasoning for branch C"
}`
      }]
    })
  });
  const branchData = await branchGenRes.json();
  if (branchData.error) throw new Error(branchData.error.message);
  const branchText = branchData.content?.map(b => b.text || "").join("\n") || "";
  const branchClean = branchText.replace(/```json|```/g, "").trim();
  const branchMatch = branchClean.match(/\{[\s\S]*\}/);
  const branches = JSON.parse(branchMatch[0]);

  // STEP 2: Expand each branch independently — separate calls, no cross-contamination
  const expandBranch = async (branchLabel, opening) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TARGET_MODEL,
        max_tokens: 800,
        system: "You are developing one reasoning branch. Commit to this approach.",
        messages: [{
          role: "user",
          content: `Problem: ${question}

You are developing this reasoning branch (${branchLabel}):
"${opening}"

Continue this branch step by step to reach a tentative answer. Stay within this branch's analytical lens — do not switch to a different approach.

Provide:
1. Your step-by-step reasoning (3-5 sentences)
2. Your tentative answer for this branch

End with: "TENTATIVE ANSWER: <your answer>"`
        }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.content?.map(b => b.text || "").join("\n") || "";
  };

  const [expandedA, expandedB, expandedC] = await Promise.all([
    expandBranch("BRANCH A — face value", branches.branch_a),
    expandBranch("BRANCH B — trick/puzzle", branches.branch_b),
    expandBranch("BRANCH C — hidden assumptions", branches.branch_c),
  ]);

  // STEP 3: Evaluate each branch — separate evaluator call
  const evalRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TARGET_MODEL,
      max_tokens: 800,
      system: "You are a neutral evaluator of reasoning branches.",
      messages: [{
        role: "user",
        content: `Problem: ${question}

Three independent reasoning branches were developed for this problem:

${"="*50}
BRANCH A (face-value reading):
${expandedA}

${"="*50}
BRANCH B (trick/puzzle framing):
${expandedB}

${"="*50}
BRANCH C (hidden-assumption check):
${expandedC}

Evaluate which branch best respects what the problem ACTUALLY asks, not a similar-sounding version of the problem.

Return ONLY JSON:
{
  "branch_a_score": 1 to 10,
  "branch_b_score": 1 to 10,
  "branch_c_score": 1 to 10,
  "best_branch": "A" or "B" or "C",
  "evaluation_reason": "one sentence why the winning branch is best"
}`
      }]
    })
  });
  const evalData = await evalRes.json();
  if (evalData.error) throw new Error(evalData.error.message);
  const evalText = evalData.content?.map(b => b.text || "").join("\n") || "";
  const evalClean = evalText.replace(/```json|```/g, "").trim();
  const evalMatch = evalClean.match(/\{[\s\S]*\}/);
  const evaluation = JSON.parse(evalMatch[0]);

  // STEP 4: Commit to best branch, produce final answer
  const best = { A: expandedA, B: expandedB, C: expandedC }[evaluation.best_branch];
  const finalRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TARGET_MODEL,
      max_tokens: 500,
      system: "You are producing a clean final answer.",
      messages: [{
        role: "user",
        content: `Problem: ${question}

Best reasoning branch (branch ${evaluation.best_branch}):
${best}

Based on this reasoning, produce a clean, concise final answer. One or two sentences.`
      }]
    })
  });
  const finalData = await finalRes.json();
  if (finalData.error) throw new Error(finalData.error.message);
  const finalText = finalData.content?.map(b => b.text || "").join("\n") || "";

  return {
    branches,
    expanded: { A: expandedA, B: expandedB, C: expandedC },
    evaluation,
    final: finalText
  };
}

// =================================================================
// JUDGE
// =================================================================
async function judge(q, answer) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 500,
      system: "You are a strict, fair evaluator. Return only JSON.",
      messages: [{
        role: "user",
        content: `Evaluate if this answer is correct for a classic puzzle with altered conditions.

QUESTION: ${q.question}
CORRECT ANSWER: ${q.correct_answer}
REASONING: ${q.reasoning}
TRAP: ${q.trap}

ANSWER TO EVALUATE: ${answer}

Judge strictly. If it recites the classic puzzle's answer, INCORRECT. Must arrive at verified correct answer.

Return ONLY: {"correct": true or false, "fell_for_trap": true or false, "reason": "one sentence"}`
      }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.map(b => b.text || "").join("\n") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  return JSON.parse(match[0]);
}

// =================================================================
// UI
// =================================================================
export default function ThreeCoTBaselines() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [expandedMethod, setExpandedMethod] = useState({});
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

      const existing = results[q.id] || {};
      const needed = {
        standard: !existing.standard_judged,
        selfConsistency: !existing.sc_judged,
        tot: !existing.tot_judged
      };

      try {
        // STANDARD COT
        if (needed.standard) {
          setProgress(`#${q.id}: Standard CoT...`);
          const stdAnswer = await standardCoT(q.question);
          if (stopRef.current) break;
          setProgress(`#${q.id}: Standard CoT judging...`);
          const stdJudged = await judge(q, stdAnswer);
          setResults(prev => ({
            ...prev,
            [q.id]: {
              ...(prev[q.id] || {}),
              standard_answer: stdAnswer,
              standard_judged: stdJudged,
              standard_correct: stdJudged.correct
            }
          }));
        }
        if (stopRef.current) break;

        // SELF-CONSISTENCY COT
        if (needed.selfConsistency) {
          setProgress(`#${q.id}: Self-Consistency CoT (5 samples)...`);
          const sc = await selfConsistencyCoT(q.question, 5);
          if (stopRef.current) break;
          setProgress(`#${q.id}: Self-Consistency judging...`);
          const scJudged = await judge(q, sc.final);
          setResults(prev => ({
            ...prev,
            [q.id]: {
              ...(prev[q.id] || {}),
              sc_data: sc,
              sc_judged: scJudged,
              sc_correct: scJudged.correct
            }
          }));
        }
        if (stopRef.current) break;

        // TREE OF THOUGHTS
        if (needed.tot) {
          setProgress(`#${q.id}: Tree of Thoughts (branching)...`);
          const tot = await treeOfThoughts(q.question);
          if (stopRef.current) break;
          setProgress(`#${q.id}: Tree of Thoughts judging...`);
          const totJudged = await judge(q, tot.final);
          setResults(prev => ({
            ...prev,
            [q.id]: {
              ...(prev[q.id] || {}),
              tot_data: tot,
              tot_judged: totJudged,
              tot_correct: totJudged.correct
            }
          }));
        }
      } catch (e) {
        console.error("Error on", q.id, e);
        setResults(prev => ({
          ...prev,
          [q.id]: { ...(prev[q.id] || {}), error: e.message }
        }));
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
    const all = FAILED_QUESTIONS.map(q => ({ ...q, result: results[q.id] || null }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `three_cot_baselines.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const stdCount = FAILED_QUESTIONS.filter(q => results[q.id]?.standard_correct).length;
  const scCount = FAILED_QUESTIONS.filter(q => results[q.id]?.sc_correct).length;
  const totCount = FAILED_QUESTIONS.filter(q => results[q.id]?.tot_correct).length;

  const stdDone = FAILED_QUESTIONS.filter(q => results[q.id]?.standard_judged).length;
  const scDone = FAILED_QUESTIONS.filter(q => results[q.id]?.sc_judged).length;
  const totDone = FAILED_QUESTIONS.filter(q => results[q.id]?.tot_judged).length;

  const toggleMethod = (id, method) => {
    setExpandedMethod(prev => ({
      ...prev,
      [`${id}_${method}`]: !prev[`${id}_${method}`]
    }));
  };

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
          }}>Three CoT Baselines — proper SOTA controls</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            Standard CoT · Self-Consistency · Tree of Thoughts
          </h1>
          <div style={{ width: 60, height: 2,
            background: "linear-gradient(90deg, #E8927C, #E8D67C, #C47CE8)",
            marginTop: "0.5rem" }} />
          <div style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", lineHeight: 1.55 }}>
            <strong style={{ color: "#ccc" }}>Three established baselines from the literature:</strong><br/>
            <span style={{ color: "#E8D67C" }}>(1) Standard CoT</span> — "Let's think step by step" (Wei et al., 2022) — 1 API call.<br/>
            <span style={{ color: "#E8927C" }}>(2) Self-Consistency CoT</span> — 5 independent samples with temperature=0.7, majority vote on final answer (Wang et al., 2022) — 5 API calls per sample + 1 extraction.<br/>
            <span style={{ color: "#C47CE8" }}>(3) Tree of Thoughts</span> — 3 distinct branches, expanded independently, neutral evaluator picks best, final commit (Yao et al., 2023) — 6 API calls.
          </div>
        </div>

        {/* Full results comparison banner */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
          gap: "0.4rem", marginBottom: "1.25rem"
        }}>
          {[
            { label: "Baseline", val: "0/4", color: "#E8927C" },
            { label: "Std CoT", val: stdDone > 0 ? `${stdCount}/${stdDone}` : "?", color: "#E8D67C" },
            { label: "Self-Consist.", val: scDone > 0 ? `${scCount}/${scDone}` : "?", color: "#E8927C" },
            { label: "Tree of Th.", val: totDone > 0 ? `${totCount}/${totDone}` : "?", color: "#C47CE8" },
            { label: "CSEP v1", val: "1/4", color: "#7CC6E8" },
            { label: "CSEP v2", val: "4/4", color: "#9BE87C" }
          ].map((s, i) => (
            <div key={i} style={{
              background: "#111113",
              border: `1px solid ${s.color}33`,
              borderRadius: 8, padding: "0.55rem", textAlign: "center"
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.5rem", color: "#666",
                textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3
              }}>{s.label}</div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "1.1rem", fontWeight: 500, color: s.color
              }}>{s.val}</div>
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
          >{running ? "Running..." : "Run All 3 Baselines × 4 Questions"}</button>

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

          {Object.keys(results).length > 0 && (
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
            const r = results[q.id] || {};
            const isEx = expandedId === q.id;

            return (
              <div key={q.id} className="fade-in"
                style={{
                  background: isEx ? "#111113" : "#0d0d0e",
                  border: "1px solid #1a1a1e",
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
                    {r.standard_judged && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                        padding: "2px 5px", borderRadius: 3,
                        background: r.standard_correct ? "#1a2015" : "#2a1a15",
                        color: r.standard_correct ? "#E8D67C" : "#E8927C"
                      }}>Std{r.standard_correct ? "✓" : "✗"}</span>
                    )}
                    {r.sc_judged && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                        padding: "2px 5px", borderRadius: 3,
                        background: r.sc_correct ? "#152015" : "#2a1515",
                        color: r.sc_correct ? "#9BE87C" : "#E8927C"
                      }}>SC{r.sc_correct ? "✓" : "✗"}</span>
                    )}
                    {r.tot_judged && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.48rem",
                        padding: "2px 5px", borderRadius: 3,
                        background: r.tot_correct ? "#1a1a20" : "#2a151a",
                        color: r.tot_correct ? "#C47CE8" : "#E8927C"
                      }}>ToT{r.tot_correct ? "✓" : "✗"}</span>
                    )}
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
                    </div>

                    {/* Standard CoT */}
                    {r.standard_answer && (
                      <div style={{ marginTop: "0.7rem" }}>
                        <div
                          onClick={() => toggleMethod(q.id, 'std')}
                          style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem",
                            color: r.standard_correct ? "#9BE87C" : "#E8927C",
                            textTransform: "uppercase", letterSpacing: "0.1em",
                            cursor: "pointer", marginBottom: 4,
                            display: "flex", justifyContent: "space-between"
                          }}>
                          <span>▸ Standard CoT: {r.standard_correct ? "✓ TAČNO" : "✗ NETAČNO"}</span>
                          <span style={{ color: "#666" }}>{r.standard_judged?.reason?.slice(0, 80)}</span>
                        </div>
                        {expandedMethod[`${q.id}_std`] && (
                          <div style={{
                            background: "#0a0a0b", borderRadius: 6, padding: "0.6rem",
                            fontSize: "0.72rem", lineHeight: 1.55, color: "#bbb",
                            whiteSpace: "pre-wrap",
                            borderLeft: `2px solid ${r.standard_correct ? "#9BE87C44" : "#E8927C44"}`,
                            maxHeight: 300, overflow: "auto"
                          }}>{r.standard_answer}</div>
                        )}
                      </div>
                    )}

                    {/* Self-Consistency */}
                    {r.sc_data && (
                      <div style={{ marginTop: "0.7rem" }}>
                        <div
                          onClick={() => toggleMethod(q.id, 'sc')}
                          style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem",
                            color: r.sc_correct ? "#9BE87C" : "#E8927C",
                            textTransform: "uppercase", letterSpacing: "0.1em",
                            cursor: "pointer", marginBottom: 4,
                            display: "flex", justifyContent: "space-between"
                          }}>
                          <span>▸ Self-Consistency: {r.sc_correct ? "✓ TAČNO" : "✗ NETAČNO"}</span>
                          <span style={{ color: "#666" }}>
                            {r.sc_data.normalized_answers?.length || 0} samples → majority
                          </span>
                        </div>
                        {expandedMethod[`${q.id}_sc`] && (
                          <div style={{
                            background: "#0a0a0b", borderRadius: 6, padding: "0.6rem",
                            fontSize: "0.72rem", lineHeight: 1.55, color: "#bbb",
                            borderLeft: `2px solid ${r.sc_correct ? "#9BE87C44" : "#E8927C44"}`,
                            maxHeight: 400, overflow: "auto"
                          }}>
                            <div style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                              color: "#9BE87C", marginBottom: 6
                            }}>MAJORITY ANSWER</div>
                            <div style={{ marginBottom: 10 }}>{r.sc_data.majority_answer}</div>

                            <div style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                              color: "#888", marginBottom: 4
                            }}>VOTE COUNTS</div>
                            <div style={{ fontSize: "0.68rem", color: "#999", marginBottom: 10 }}>
                              {JSON.stringify(r.sc_data.vote_counts, null, 2)}
                            </div>

                            <div style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                              color: "#888", marginBottom: 4
                            }}>NORMALIZED ANSWERS (per sample)</div>
                            {r.sc_data.normalized_answers?.map((a, i) => (
                              <div key={i} style={{ fontSize: "0.68rem", color: "#999", marginBottom: 3 }}>
                                {i+1}. {a}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tree of Thoughts */}
                    {r.tot_data && (
                      <div style={{ marginTop: "0.7rem" }}>
                        <div
                          onClick={() => toggleMethod(q.id, 'tot')}
                          style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem",
                            color: r.tot_correct ? "#9BE87C" : "#E8927C",
                            textTransform: "uppercase", letterSpacing: "0.1em",
                            cursor: "pointer", marginBottom: 4,
                            display: "flex", justifyContent: "space-between"
                          }}>
                          <span>▸ Tree of Thoughts: {r.tot_correct ? "✓ TAČNO" : "✗ NETAČNO"}</span>
                          <span style={{ color: "#666" }}>
                            Winner: Branch {r.tot_data.evaluation?.best_branch}
                          </span>
                        </div>
                        {expandedMethod[`${q.id}_tot`] && (
                          <div style={{
                            background: "#0a0a0b", borderRadius: 6, padding: "0.6rem",
                            fontSize: "0.72rem", lineHeight: 1.55, color: "#bbb",
                            borderLeft: `2px solid ${r.tot_correct ? "#9BE87C44" : "#E8927C44"}`,
                            maxHeight: 500, overflow: "auto"
                          }}>
                            <div style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                              color: "#9BE87C", marginBottom: 4
                            }}>FINAL ANSWER</div>
                            <div style={{ marginBottom: 10 }}>{r.tot_data.final}</div>

                            <div style={{
                              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                              color: "#888", marginBottom: 4, marginTop: 10
                            }}>EVALUATION</div>
                            <div style={{ fontSize: "0.68rem", color: "#999", marginBottom: 10 }}>
                              A: {r.tot_data.evaluation?.branch_a_score}/10, B: {r.tot_data.evaluation?.branch_b_score}/10, C: {r.tot_data.evaluation?.branch_c_score}/10 — winner: {r.tot_data.evaluation?.best_branch} ({r.tot_data.evaluation?.evaluation_reason})
                            </div>

                            {['A', 'B', 'C'].map(letter => (
                              <div key={letter} style={{ marginBottom: 10 }}>
                                <div style={{
                                  fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                                  color: r.tot_data.evaluation?.best_branch === letter ? "#9BE87C" : "#888",
                                  marginBottom: 3
                                }}>BRANCH {letter} {r.tot_data.evaluation?.best_branch === letter ? "(winner)" : ""}</div>
                                <div style={{ fontSize: "0.68rem", color: "#999", whiteSpace: "pre-wrap", fontStyle: "italic", marginBottom: 3 }}>
                                  Opening: {r.tot_data.branches?.[`branch_${letter.toLowerCase()}`]}
                                </div>
                                <div style={{ fontSize: "0.68rem", color: "#bbb", whiteSpace: "pre-wrap" }}>
                                  {r.tot_data.expanded?.[letter]}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {r.error && (
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
