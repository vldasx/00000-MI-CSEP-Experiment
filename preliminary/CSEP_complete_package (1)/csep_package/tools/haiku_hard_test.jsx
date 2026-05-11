import { useState, useRef, useCallback, useEffect } from "react";

const TARGET_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-opus-4-5-20250929";
const STORAGE_KEY = "csep_hard_baseline_v1";

// 20 altered-classic questions — documented failure modes from RoR-Bench, BrainBench,
// altered-riddles dataset, "Easy Problems LLMs Get Wrong", and similar literature.
// Each question is a classic puzzle with ONE key detail changed so the classic answer is wrong.
const HARD_QUESTIONS = [
  {"id":1,"type":"altered_classic","subtype":"surgeon_explicit_father","question":"A man and his son are in a car accident. They are rushed to the hospital. The surgeon looks at the boy and says, 'I can operate on this boy — he is my son!' The surgeon is the boy's father. How is this possible?","correct_answer":"It is straightforwardly possible — the father is a surgeon and is confirming he can perform the operation on his son. There is no puzzle or twist. Fathers can be surgeons; the question explicitly states the surgeon IS the father.","reasoning":"Altered 'surgeon is the mother' riddle. The altered version explicitly says the surgeon IS the father. Models often recite 'the surgeon is the mother' anyway.","trap":"Model recites classic riddle answer despite explicit contrary information","source":"altered-riddles dataset, multiple papers"},
  {"id":2,"type":"altered_classic","subtype":"monty_hall_ignorant","question":"You are on a game show with three doors. Behind one is a car, behind the other two are goats. You pick door 1. The host, who CANNOT see behind the doors and does not know where the car is, opens door 3, revealing a goat. He offers you the chance to switch to door 2. Should you switch to maximize your chance of winning the car?","correct_answer":"It does not matter. Since the host does NOT know where the car is, his reveal is random luck — it gives you no information. Both remaining doors have equal probability (1/2 each). This is different from the classic Monty Hall where the host knowingly avoids the car.","reasoning":"Classic Monty Hall: host knows, switching gives 2/3. If host is ignorant ('Monty Fall'), both doors are 1/2.","trap":"Model recites classic 'switch, 2/3' despite host being ignorant","source":"Easy Problems That LLMs Get Wrong (arxiv 2405.19616)"},
  {"id":3,"type":"altered_classic","subtype":"river_big_boat","question":"A farmer needs to cross a river with a wolf, a goat, and a cabbage. He has a boat that can hold himself and as many items as he wants at the same time. The wolf would eat the goat if left alone together, and the goat would eat the cabbage if left alone together. What is the minimum number of trips required?","correct_answer":"One trip. The boat can hold everything at once, so the farmer takes all three across in a single trip. The wolf-goat-cabbage constraints never apply because nothing is ever left alone.","reasoning":"Classic puzzle has boat holding farmer + 1 item. This version removes constraint.","trap":"Model recites classic multi-trip solution despite altered capacity","source":"Altered reasoning puzzles"},
  {"id":4,"type":"altered_classic","subtype":"roulette_one_bullet","question":"You are playing Russian roulette with a six-shooter revolver. Your opponent puts in ONE bullet (not five — just one), spins the chambers and fires at himself, but no bullet comes out. He gives you the choice of whether or not he should spin the chambers again before firing at you. Should he spin again?","correct_answer":"Yes, spin again. With ONE bullet, after one empty fire, 5 chambers remain with 1 bullet still in them. Not spinning: 1/5 chance of death. Spinning: 1/6 chance of death. Spinning is safer.","reasoning":"Classic has five bullets, where not spinning is safer. With one bullet the logic flips.","trap":"Model recites classic 'don't spin' without recomputing for reversed bullets","source":"Easy Problems That LLMs Get Wrong"},
  {"id":5,"type":"altered_classic","subtype":"bat_ball_direct","question":"A bat and a ball cost $1.10 in total. The bat costs $1.00. How much does the ball cost?","correct_answer":"$0.10 (ten cents). $1.00 + $0.10 = $1.10.","reasoning":"Altered CRT. Original says 'bat costs $1.00 MORE than ball' with answer 5 cents. Here the bat price is given directly, so ball is simply 10 cents.","trap":"Model recites classic 5 cents despite direct price","source":"Cognitive Reflection Test — altered"},
  {"id":6,"type":"altered_classic","subtype":"rental_car","question":"I need to return my rental car today. The rental agency is just across the street from where I'm standing. Should I walk over, or drive?","correct_answer":"Drive. The rental car itself needs to be returned to the agency — you can't leave it behind. Walking would mean leaving the car where it is. The distance is irrelevant because the car has to come with you.","reasoning":"Models treat this as distance optimization and miss the physical constraint.","trap":"Model optimizes on distance, ignores that car must be delivered","source":"Opper AI Car Wash Test, BrainBench"},
  {"id":7,"type":"altered_classic","subtype":"no_boat_wade","question":"A man has a wolf, a goat, and a cabbage. He needs to get all of them across a river. There is no boat. The river is shallow enough to wade through. The wolf would eat the goat if left alone with it, and the goat would eat the cabbage if left alone with it. How does he get them across?","correct_answer":"He simply walks through the shallow river bringing all three with him at once. Since he never leaves any pair alone, the eating constraints never apply. No boat means no capacity constraint.","reasoning":"No boat removes capacity constraint entirely. Model should recognize it's trivial.","trap":"Model recites classic solution despite no boat","source":"Altered reasoning puzzles"},
  {"id":8,"type":"altered_classic","subtype":"two_guards_one_truth","question":"You come to a fork in the road. One path leads to freedom, the other to death. There is ONE guard. The guard always tells the truth. What single question should you ask to find the safe path?","correct_answer":"Any direct question works. Ask 'Which path leads to freedom?' The guard, being truthful, will simply tell you. No complex meta-question needed.","reasoning":"Classic has two guards (one lies, one truth). With one truthful guard, no meta-question needed.","trap":"Model recites classic meta-question despite one truthful guard","source":"Classic logic puzzle — altered"},
  {"id":9,"type":"altered_classic","subtype":"chicken_same_side","question":"A chicken is on one side of a road. It wants to get to a pile of seeds on the same side it's already on. Why does the chicken cross the road?","correct_answer":"The chicken does NOT need to cross the road — the seeds are on its current side. The premise of the question ('why does the chicken cross') is false.","reasoning":"Classic joke has goal on OTHER side. Here goal is on SAME side — no crossing needed.","trap":"Model recites classic joke answer despite false premise","source":"Common joke — altered"},
  {"id":10,"type":"altered_classic","subtype":"frog_net_zero","question":"A frog is at the bottom of a 10-meter well. Each day it climbs up 3 meters, and each night it slips down 3 meters. How many days until the frog escapes the well?","correct_answer":"The frog will NEVER escape. It climbs 3m up by day and slips 3m down by night — net progress is zero. It stays at the bottom forever.","reasoning":"Classic has asymmetric climb/slip (e.g., 3 up, 2 down) with net +1. Altered: symmetric = zero progress.","trap":"Model recites classic formula (days = depth/net) despite zero net","source":"Classic math puzzle — altered"},
  {"id":11,"type":"altered_classic","subtype":"theseus_unchanged","question":"A ship has been on display in a museum for 50 years. No parts have ever been replaced. Is it the same ship that was originally put on display?","correct_answer":"Yes, obviously. It's trivially the same ship — nothing has been changed. The Ship of Theseus paradox requires PART REPLACEMENT to be interesting; without replacement there's no paradox.","reasoning":"Classic paradox requires replacement of parts. Without replacement, trivial yes.","trap":"Model launches philosophical musings despite trivial answer","source":"Altered philosophical puzzle"},
  {"id":12,"type":"altered_classic","subtype":"elevator_normal","question":"A man lives in a tall apartment building on the 20th floor. Every morning he takes the elevator all the way down to the ground floor to go to work. Every evening when he comes home, he takes the elevator back up to the 20th floor. He does this every single day without exception, even on rainy days, weekdays and weekends alike. Why?","correct_answer":"There is no puzzle here. He lives on the 20th floor and goes to work — he takes the elevator normally. Nothing unusual is described.","reasoning":"Classic has inconsistent elevator use (down to ground, up only to 10th floor except rainy days). Altered removes inconsistency — no puzzle.","trap":"Model invents puzzle-like answer despite no anomaly","source":"Classic lateral thinking — altered"},
  {"id":13,"type":"altered_classic","subtype":"zebra_trivial","question":"There are five houses in a row, each painted a different color. Five people of different nationalities live in these houses. Each person drinks a different beverage, smokes a different brand of cigarettes, and keeps a different pet. The Norwegian lives in the first house. The Norwegian drinks water. The Norwegian smokes Dunhill. The Norwegian keeps fish. What pet does the Norwegian keep?","correct_answer":"Fish. The question explicitly states the Norwegian keeps fish.","reasoning":"Mimics Einstein's Zebra Puzzle form but answer is explicitly given. No solving needed.","trap":"Model attempts to solve complex classic ignoring given answer","source":"Einstein's Zebra Puzzle — altered"},
  {"id":14,"type":"altered_classic","subtype":"pigeons_equal","question":"If you have 10 pigeons and 10 holes, and every pigeon goes into a different hole, can you guarantee that at least one hole contains more than one pigeon?","correct_answer":"No. With 10 pigeons in 10 holes, each going into a different hole, no hole contains more than one pigeon — each has exactly one.","reasoning":"Classic pigeonhole: n+1 pigeons in n holes guarantees sharing. Equal counts — principle doesn't apply.","trap":"Model recites pigeonhole principle despite equal counts","source":"Classic combinatorics — altered"},
  {"id":15,"type":"altered_classic","subtype":"trolley_empty","question":"A trolley is heading down a track. The track is empty — there is nobody on either track. You have the option to pull a lever that would switch the trolley to another empty track. Is it ethical to pull the lever?","correct_answer":"There is no ethical dilemma. Both tracks are empty — no one gets hurt either way. The question is morally trivial; pull the lever or don't, it doesn't matter ethically.","reasoning":"Classic has 5 vs 1 people. Altered: nobody — no dilemma.","trap":"Model launches trolley problem analysis despite no stakes","source":"Trolley problem — altered"},
  {"id":16,"type":"altered_classic","subtype":"bridges_zero","question":"In a certain city, there are zero bridges connecting its parts. A tourist wants to take a walk that crosses every bridge in the city exactly once. Is this possible?","correct_answer":"Yes, trivially. With zero bridges, 'crossing every bridge exactly once' is vacuously satisfied by any walk (including not walking at all). The condition is empty.","reasoning":"Königsberg bridges has no solution. With zero bridges, condition is vacuous.","trap":"Model recites Euler's theorem despite no bridges","source":"Königsberg bridges — altered"},
  {"id":17,"type":"altered_classic","subtype":"surgeon_control","question":"A man and his son are in a serious car accident. The father is killed instantly. The son is rushed to the hospital. At the hospital, the surgeon looks at the boy and says 'I cannot operate on this boy — he is my son.' How is this possible?","correct_answer":"The surgeon is the boy's mother. The riddle exploits the assumption that surgeons are male.","reasoning":"Original classic riddle. Expected answer IS mother. Control question to verify model handles classic correctly.","trap":"Control question — model should get this right","source":"Classic riddle"},
  {"id":18,"type":"altered_classic","subtype":"three_boxes_safe","question":"Colin has three boxes in front of Bob. Colin tells Bob: one box contains $5, one box is empty, and one box contains a bomb that will kill him. Bob can choose to open any box or no box at all. What should Bob do to guarantee his survival?","correct_answer":"Bob should simply not open any box. This guarantees survival. Opening any box has 1/3 chance of death. The question asks what GUARANTEES survival — the answer is: don't open anything.","reasoning":"Looks like probability puzzle but is trivial. 'Guarantee' means not opening.","trap":"Model overthinks with probability instead of obvious safe option","source":"Easy Problems That LLMs Get Wrong"},
  {"id":19,"type":"altered_classic","subtype":"bridge_solo","question":"One person needs to cross a bridge at night. They have a torch. The bridge can only hold one person at a time. The torch is needed to cross. How long will it take if the person walks at 3 minutes per crossing?","correct_answer":"3 minutes. One person crosses once — 3 minutes total. No round trips or coordination needed.","reasoning":"Classic bridge/torch puzzle has 4 people with different speeds, complex optimization. Altered: one person, one crossing. Trivial.","trap":"Model may attempt multi-trip optimization despite single person","source":"Bridge-and-torch puzzle — altered"},
  {"id":20,"type":"altered_classic","subtype":"dead_locked_room","question":"A man is found dead in a locked room. There is a puddle of water on the floor and a broken piece of glass. The room has no windows and the door was locked from the inside. The coroner rules the death was NOT caused by drowning, NOT caused by glass injury, NOT caused by poisoning, and NOT caused by heart attack. How did he die?","correct_answer":"There is not enough information to determine the cause of death. The puzzle has ruled out every commonly-cited cause including the classic answer (hanging from melted ice). Without more evidence, the cause is unknown.","reasoning":"Classic solution is hanging from melted ice block. Altered explicitly rules out all common answers — insufficient info.","trap":"Model recites classic 'ice cube hanging' despite no hanging evidence and explicit rulings out","source":"Classic lateral thinking — altered"}
];

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

async function testBaseline(q) {
  return await callAPI(
    TARGET_MODEL,
    "You are a helpful assistant. Answer precisely and concisely.",
    q.question
  );
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
- The model must address the ACTUAL question, not a classic version. If it recites the classic puzzle's answer instead of responding to the altered conditions, that is INCORRECT.
- Partial credit: if the model notices the alteration but still gives the classic answer, it's still INCORRECT.
- The model must arrive at the VERIFIED CORRECT ANSWER in substance. Exact wording not required.
- If the model gives multiple possible answers including the correct one but also includes the recited wrong answer prominently, that is INCORRECT (confused response).

Return ONLY this JSON:
{"correct": true or false, "fell_for_trap": true or false, "reason": "one sentence explanation"}`
  );
  return parseJSON(resp);
}

export default function HardTest() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState("all");
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

    for (const q of HARD_QUESTIONS) {
      if (stopRef.current) break;
      if (results[q.id]?.stage === "done") continue;

      try {
        setProgress(`#${q.id} (${q.subtype}): Haiku...`);
        setResults(prev => ({ ...prev, [q.id]: { stage: "testing" } }));

        const answer = await testBaseline(q);

        setProgress(`#${q.id} (${q.subtype}): judging...`);
        setResults(prev => ({ ...prev, [q.id]: { stage: "judging", answer } }));

        const judgment = await judge(q, answer);

        setResults(prev => ({
          ...prev,
          [q.id]: { stage: "done", answer, judgment, correct: judgment.correct }
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

  const downloadFailed = () => {
    const failed = HARD_QUESTIONS
      .filter(q => results[q.id]?.stage === "done" && !results[q.id].correct)
      .map(q => ({ ...q,
        haiku_answer: results[q.id].answer,
        judge_reason: results[q.id].judgment.reason,
        fell_for_trap: results[q.id].judgment.fell_for_trap
      }));
    const blob = new Blob([JSON.stringify(failed, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `haiku_hard_failures.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    const all = HARD_QUESTIONS.map(q => ({ ...q, result: results[q.id] || null }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `haiku_hard_all.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const done = HARD_QUESTIONS.filter(q => results[q.id]?.stage === "done");
  const correct = done.filter(q => results[q.id].correct).length;
  const incorrect = done.filter(q => !results[q.id].correct).length;
  const trapped = done.filter(q => results[q.id].judgment?.fell_for_trap).length;

  const filtered = HARD_QUESTIONS.filter(q => {
    if (filter === "all") return true;
    if (filter === "failed") return results[q.id]?.stage === "done" && !results[q.id].correct;
    if (filter === "passed") return results[q.id]?.stage === "done" && results[q.id].correct;
    if (filter === "pending") return !results[q.id] || results[q.id].stage !== "done";
    if (filter === "trapped") return results[q.id]?.judgment?.fell_for_trap;
    return true;
  });

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
            color: "#E8927C", marginBottom: "0.3rem"
          }}>Hard Test — Altered Classics</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            Klasike sa izmenjenim uslovima — 20 pitanja
          </h1>
          <div style={{ width: 60, height: 2,
            background: "linear-gradient(90deg, #E8927C, #7CC6E8, #9BE87C)",
            marginTop: "0.5rem" }} />
          <div style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", lineHeight: 1.55 }}>
            Dokumentovani failure modes iz RoR-Bench, BrainBench, altered-riddles dataset-a.
            Svako pitanje je klasika (Monty Hall, surgeon riddle, Ship of Theseus...) sa jednim
            ključnim detaljem izmenjenim. Model recituje staro rešenje umesto da reaguje na promenu.
            Top modeli padaju 50-60% na ovakvim pitanjima.
          </div>
        </div>

        {done.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
            gap: "0.5rem", marginBottom: "1rem"
          }}>
            {[
              { label: "Gotovo", val: `${done.length}/20`, color: "#bbb" },
              { label: "Tačno", val: correct, color: "#9BE87C" },
              { label: "Netačno", val: incorrect, color: "#E8927C" },
              { label: "Palo u zamku", val: trapped, color: "#C47CE8" },
              { label: "Tačnost", val: done.length > 0 ? `${Math.round(correct/done.length*100)}%` : "-", color: "#7CC6E8" }
            ].map((s, i) => (
              <div key={i} style={{
                background: "#111113", border: "1px solid #1e1e22",
                borderRadius: 8, padding: "0.6rem", textAlign: "center"
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "1.3rem", fontWeight: 500, color: s.color
                }}>{s.val}</div>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.5rem", color: "#666",
                  textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 3
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
          >{running ? "Running..." : done.length === 0 ? "Run All 20" : `Continue (${20 - done.length})`}</button>

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

          {incorrect > 0 && (
            <button onClick={downloadFailed}
              style={{
                background: "#9BE87C", color: "#0a0a0b", border: "none",
                borderRadius: 6, padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
              }}
            >↓ Failed ({incorrect})</button>
          )}

          {done.length > 0 && (
            <button onClick={downloadAll}
              style={{
                background: "transparent", color: "#bbb", border: "1px solid #333",
                borderRadius: 6, padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
              }}
            >↓ All</button>
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

        {done.length > 0 && (
          <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {[
              {k: "all", l: `All (${HARD_QUESTIONS.length})`},
              {k: "failed", l: `Failed (${incorrect})`},
              {k: "passed", l: `Passed (${correct})`},
              {k: "trapped", l: `In Trap (${trapped})`},
              {k: "pending", l: `Pending (${20 - done.length})`}
            ].map(f => (
              <button key={f.k} onClick={() => setFilter(f.k)}
                style={{
                  background: filter === f.k ? "#7CC6E833" : "transparent",
                  color: filter === f.k ? "#7CC6E8" : "#666",
                  border: `1px solid ${filter === f.k ? "#7CC6E866" : "#222"}`,
                  borderRadius: 4, padding: "3px 10px",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem", cursor: "pointer"
                }}
              >{f.l}</button>
            ))}
          </div>
        )}

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

        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {filtered.map(q => {
            const r = results[q.id];
            const isEx = expandedId === q.id;
            const statusColor = !r ? "#333" :
              r.stage === "done" ? (r.correct ? "#9BE87C" : (r.judgment?.fell_for_trap ? "#C47CE8" : "#E8927C")) :
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
                    padding: "0.55rem 0.8rem", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: "0.5rem"
                  }}
                >
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem",
                    color: "#555", minWidth: 20, textAlign: "right"
                  }}>#{q.id}</span>

                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: "0.5rem",
                    color: "#7CC6E8",
                    padding: "2px 5px",
                    background: "#7CC6E815",
                    borderRadius: 3, minWidth: 90, textAlign: "center"
                  }}>{q.subtype.slice(0, 18)}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "0.76rem", lineHeight: 1.4, color: "#bbb",
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: isEx ? "normal" : "nowrap"
                    }}>{q.question}</div>
                  </div>

                  {r?.stage === "done" && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {r.judgment?.fell_for_trap && (
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.5rem",
                          padding: "2px 6px", borderRadius: 3,
                          background: "#2a1a2a", color: "#C47CE8",
                          textTransform: "uppercase", letterSpacing: "0.05em"
                        }}>trap</span>
                      )}
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem",
                        padding: "2px 8px", borderRadius: 3,
                        background: r.correct ? "#152015" : "#2a1515",
                        color: r.correct ? "#9BE87C" : "#E8927C",
                        textTransform: "uppercase", letterSpacing: "0.05em"
                      }}>{r.correct ? "Tačno" : "Netačno"}</span>
                    </div>
                  )}
                  {r && r.stage !== "done" && (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem",
                      color: "#7CC6E8", textTransform: "uppercase", flexShrink: 0
                    }}>{r.stage}</span>
                  )}
                </div>

                {isEx && (
                  <div className="fade-in" style={{
                    padding: "0 0.8rem 0.7rem", borderTop: "1px solid #1a1a1e"
                  }}>
                    <div style={{
                      marginTop: "0.5rem", padding: "0.4rem 0.65rem",
                      background: "#0d1a0d", borderLeft: "2px solid #9BE87C33",
                      borderRadius: "0 4px 4px 0", fontSize: "0.7rem", lineHeight: 1.5
                    }}>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.53rem",
                        color: "#9BE87C", textTransform: "uppercase", marginBottom: 3
                      }}>Tačan odgovor</div>
                      <div style={{ color: "#bbb" }}>{q.correct_answer}</div>
                      <div style={{
                        marginTop: 5, fontSize: "0.65rem",
                        color: "#888", fontStyle: "italic"
                      }}>Reasoning: {q.reasoning}</div>
                      <div style={{
                        marginTop: 3, fontSize: "0.62rem",
                        color: "#C47CE8", fontStyle: "italic"
                      }}>Zamka: {q.trap}</div>
                      <div style={{
                        marginTop: 3, fontSize: "0.6rem",
                        color: "#555", fontStyle: "italic"
                      }}>Izvor: {q.source}</div>
                    </div>

                    {r?.answer && (
                      <div style={{
                        marginTop: "0.5rem", padding: "0.5rem 0.65rem",
                        background: "#0a0a0b",
                        borderLeft: `2px solid ${r.correct ? "#9BE87C33" : "#E8927C33"}`,
                        borderRadius: "0 4px 4px 0"
                      }}>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace", fontSize: "0.53rem",
                          color: r.correct ? "#9BE87C" : "#E8927C",
                          textTransform: "uppercase", marginBottom: 4
                        }}>Haiku {r.correct ? "TAČNO" : "NETAČNO"}{r.judgment?.fell_for_trap ? " — u zamci" : ""}</div>
                        <div style={{
                          fontSize: "0.72rem", lineHeight: 1.55, color: "#ccc",
                          whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto"
                        }}>{r.answer}</div>
                        {r.judgment && (
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                            color: "#888", marginTop: 6, fontStyle: "italic",
                            paddingTop: 4, borderTop: "1px solid #1a1a1e"
                          }}>Sudija: {r.judgment.reason}</div>
                        )}
                      </div>
                    )}

                    {r?.error && (
                      <div style={{
                        marginTop: "0.5rem", padding: "0.4rem 0.65rem",
                        fontSize: "0.7rem", color: "#E8555C",
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
