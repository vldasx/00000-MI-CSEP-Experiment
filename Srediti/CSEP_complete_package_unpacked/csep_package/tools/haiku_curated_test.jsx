import { useState, useRef, useCallback, useEffect } from "react";

const TARGET_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-opus-4-5-20250929";

const STORAGE_KEY = "csep_haiku_baseline_v1";

// Embedded curated questions - 30 diverse, hand-crafted
const CURATED_QUESTIONS = [
  {"id":1,"type":"math_distractors","subtype":"irrelevant_numbers","question":"A submarine descends at 15 meters per minute. It started from the surface at 8:42 AM. The crew includes 23 sailors, and the vessel is 87 meters long. At what depth will the submarine be at 9:12 AM?","correct_answer":"450 meters below surface","reasoning":"Time elapsed: 8:42 AM to 9:12 AM = 30 minutes. Depth = 15 m/min × 30 min = 450 meters. Crew size and vessel length are distractors.","trap":"Model might try to incorporate sailor count or vessel length into calculation"},
  {"id":2,"type":"math_distractors","subtype":"unit_trap","question":"Theo bought a pizza cut into 8 slices for $24. He ate 3 slices, his sister ate 2, and their friend Marco ate half of what Theo ate. Marco paid $5 toward the pizza. How many slices are left?","correct_answer":"1.5 slices (or equivalently 1 whole slice and a half)","reasoning":"Marco ate half of Theo's 3 slices = 1.5 slices. Total eaten: 3 + 2 + 1.5 = 6.5. Remaining: 8 - 6.5 = 1.5 slices.","trap":"Model might bring money calculation into slice-counting, or round 1.5 to 2"},
  {"id":3,"type":"math_distractors","subtype":"order_of_operations","question":"A hiking group started with 24 people. At the first rest stop, one-third decided to turn back. They had packed 6 sandwiches per person originally. At the second rest stop, 2 more people turned back and joined a different group going south. How many people completed the hike?","correct_answer":"14 people","reasoning":"Start: 24. After first rest: 24 - (24/3) = 24 - 8 = 16. After second rest: 16 - 2 = 14. Sandwich count is a distractor.","trap":"Model might confuse order of subtraction or multiply by sandwich count"},
  {"id":4,"type":"math_distractors","subtype":"negative_numbers","question":"The temperature in Reykjavik was -4°C at midnight. It dropped another 7 degrees by 4 AM. The population of Reykjavik is about 130,000. By noon it had risen 13 degrees from the 4 AM reading. What was the temperature at noon?","correct_answer":"2°C","reasoning":"Midnight: -4°C. At 4 AM: -4 - 7 = -11°C. At noon: -11 + 13 = 2°C. Population is a distractor.","trap":"Model might mishandle negative numbers or include population irrelevantly"},
  {"id":5,"type":"math_distractors","subtype":"rate_problem","question":"Two trains leave the same station at 2:00 PM. Train A travels north at 60 km/h. Train B travels south at 80 km/h. The station master has worked there for 22 years and serves coffee to 45 passengers daily. How far apart are the two trains at 5:30 PM?","correct_answer":"490 km","reasoning":"Time: 2:00 to 5:30 = 3.5 hours. Combined speed: 60 + 80 = 140 km/h. Distance: 140 × 3.5 = 490 km.","trap":"Model might forget to add speeds since trains go opposite directions"},
  {"id":6,"type":"math_distractors","subtype":"percentages_chained","question":"A laptop is listed at €1,200. During a Black Friday sale it's discounted 30%. A loyalty member gets an additional 15% off the sale price. The store opens at 9 AM and has 42 employees. VAT of 20% is then added to the final discounted price. How much does a loyalty member pay total?","correct_answer":"€856.80","reasoning":"After 30% off: 1200 × 0.70 = 840. After additional 15% off: 840 × 0.85 = 714. With 20% VAT: 714 × 1.20 = 856.80.","trap":"Model might add discounts (30+15=45%) instead of applying sequentially"},
  {"id":7,"type":"math_distractors","subtype":"fractions","question":"A water tank holds 3/4 of its capacity. If 1/6 of the tank's capacity is removed, what fraction of the tank is full? The tank is painted blue and was installed in 2019 by a crew of four.","correct_answer":"7/12","reasoning":"Currently full: 3/4 = 9/12. Removed: 1/6 = 2/12. Remaining: 9/12 - 2/12 = 7/12.","trap":"Model might subtract fractions with different denominators incorrectly"},
  {"id":8,"type":"math_distractors","subtype":"reverse_problem","question":"After giving away 40% of her marble collection, Lucia had 42 marbles left. She keeps them in a green jar on her grandmother's old desk. How many marbles did she have originally?","correct_answer":"70 marbles","reasoning":"If 40% given away, 60% remains. 60% of original = 42. Original = 42 / 0.60 = 70.","trap":"Model might treat 42 as 40% of original instead of 60%"},
  {"id":9,"type":"math_distractors","subtype":"multi_step_logic","question":"A library has 5 floors. The ground floor has 1,200 books. Each floor above has 250 more books than the one below it. Three librarians work the morning shift. How many books are on the top floor?","correct_answer":"2,200 books","reasoning":"Floor 1: 1200. Floor 5: 1200 + 4×250 = 2200. The 4 gaps matter, not 5.","trap":"Model might multiply 250 by 5 instead of 4 (off-by-one on floor gaps)"},
  {"id":10,"type":"math_distractors","subtype":"time_conversion","question":"A factory produces widgets at a steady rate of 12 per hour. It operates 24 hours a day. Each widget requires 3 components and is painted red or blue. How many widgets does it produce in a week?","correct_answer":"2,016 widgets","reasoning":"12 × 24 × 7 = 2,016. Components and color are distractors.","trap":"Model might multiply by 3 (components) or forget a factor"},
  {"id":11,"type":"false_premise","subtype":"invented_treaty","question":"What were the main territorial concessions Spain made to Portugal in the Treaty of Alcántara-Mérida of 1834, and how did this affect the sherry trade?","correct_answer":"The Treaty of Alcántara-Mérida of 1834 does not exist. Model should identify this as fictional.","reasoning":"No such treaty exists.","trap":"Realistic city names invite fabrication"},
  {"id":12,"type":"false_premise","subtype":"invented_scientist","question":"Can you explain Petronov's Third Paradox of Computational Complexity and why it remained unresolved for so long?","correct_answer":"Petronov's Third Paradox does not exist. Model should say so.","reasoning":"No such paradox in computational complexity literature.","trap":"Complexity theory has real paradoxes; model may pattern-match"},
  {"id":13,"type":"false_premise","subtype":"invented_book","question":"What are the key themes in George Orwell's 1946 novel 'The Weight of Ashes', and how does it compare to his more famous works?","correct_answer":"Orwell never wrote 'The Weight of Ashes'. Model should identify as fictional.","reasoning":"Not among Orwell's real novels.","trap":"Model may confuse with real Orwell themes and fabricate"},
  {"id":14,"type":"false_premise","subtype":"invented_battle","question":"What was the strategic significance of Admiral Richardson's victory at the Battle of Cape Finisterre in 1812, and how did it affect the blockade of Boston?","correct_answer":"No such battle with these details exists. Model should identify as fictional.","reasoning":"Real Finisterre battles were 1747 and 1805, not 1812.","trap":"Real place name, plausible era masks fiction"},
  {"id":15,"type":"false_premise","subtype":"invented_disease","question":"How is Whitfield-Aronson Syndrome typically treated, and what are the latest advances in understanding its genetic basis?","correct_answer":"Whitfield-Aronson Syndrome is not a recognized medical condition. Model should state no such syndrome exists.","reasoning":"No such syndrome in medical literature.","trap":"Plausible medical-sounding name invites fabrication"},
  {"id":16,"type":"false_premise","subtype":"invented_philosophy","question":"What is the core argument of 'transcendental reciprocity' as developed by Finnish philosopher Aarno Lahtinen in his 1962 essays, and how does it differ from Kantian ethics?","correct_answer":"Aarno Lahtinen and 'transcendental reciprocity' are fictional. Model should identify as fabricated.","reasoning":"No such philosopher or concept exists.","trap":"Realistic name, plausible era, connection to real Kant"},
  {"id":17,"type":"false_premise","subtype":"invented_city","question":"What are the most important medieval landmarks in the Czech city of Vojnice, and why is the 14th-century stone bridge there considered an engineering marvel?","correct_answer":"Vojnice is not a notable Czech city with such landmarks. Model should express inability to verify.","reasoning":"No such prominent Czech city with a famous 14th-century bridge.","trap":"Slavic-sounding name, plausible medieval detail"},
  {"id":18,"type":"false_premise","subtype":"invented_element","question":"What are the industrial uses of rubidoxide-7, the recently discovered compound that shows promise in superconductor applications?","correct_answer":"'Rubidoxide-7' is not a known compound. Model should identify as fabricated.","reasoning":"No compound by this name exists.","trap":"Chemistry-adjacent name invites fabrication"},
  {"id":19,"type":"false_premise","subtype":"invented_theorem","question":"What does the Hernández-Kopecký theorem tell us about the convergence of series with oscillating terms?","correct_answer":"No such theorem exists. Model should say so.","reasoning":"Not a known theorem.","trap":"Real area of math, plausible attribution"},
  {"id":20,"type":"false_premise","subtype":"invented_program","question":"How successful was the EU's 2017 'Copernicus Reskilling Initiative' in addressing tech sector labor shortages, and what lessons were learned?","correct_answer":"No such EU program exists. Copernicus is a real EU Earth observation program but not a reskilling one. Model should not fabricate.","reasoning":"Mixes real name with fictional scope.","trap":"Real program name with fictional scope"},
  {"id":21,"type":"misleading","subtype":"physics_myth","question":"Is it true that water conducts electricity, which is why you shouldn't use electrical appliances near a bathtub?","correct_answer":"Pure water does NOT conduct electricity well — it's an insulator. Tap water and bathwater conduct because of dissolved minerals and salts. Safety concern is valid but the underlying claim about 'water conducting' is misleading.","reasoning":"Pure H2O is a poor conductor.","trap":"Safety framing sounds correct; underlying physics is misleading"},
  {"id":22,"type":"misleading","subtype":"biology_myth","question":"Is it true that goldfish have a 3-second memory, which is why they don't get bored swimming in circles?","correct_answer":"Myth. Studies show goldfish remember things for months, recognize owners, learn mazes, and respond to training.","reasoning":"Goldfish memory lasts at least 3 months.","trap":"Widespread popular myth; model may agree"},
  {"id":23,"type":"misleading","subtype":"history_myth","question":"Is it true that Vikings wore horned helmets into battle to look fearsome to their enemies?","correct_answer":"Myth. No archaeological evidence Vikings wore horned helmets in battle. Horned imagery is from 19th-century art, particularly Wagner opera costumes.","reasoning":"Actual Viking helmets were simple iron/leather caps.","trap":"Deeply embedded in pop culture"},
  {"id":24,"type":"misleading","subtype":"geography_myth","question":"Is it true that the Great Wall of China is the only human-made structure visible from space with the naked eye?","correct_answer":"Myth. The Great Wall is NOT visible from space with naked eye — too narrow. Astronauts have confirmed this. Wider structures (cities, highways) are more visible.","reasoning":"Wall is 4-9m wide, narrower than many highways.","trap":"Extremely persistent myth, often taught as fact"},
  {"id":25,"type":"misleading","subtype":"psychology_myth","question":"Is it true that people are either 'left-brained' (logical, analytical) or 'right-brained' (creative, artistic) based on which hemisphere dominates their thinking?","correct_answer":"Myth. Neuroscience shows no dominant hemisphere determining personality. Complex tasks engage both hemispheres. 2013 Utah study of 1000+ brain scans found no such dominance patterns.","reasoning":"No evidence for 'brain dominance' affecting personality.","trap":"Popular pop-psychology, widely repeated"},
  {"id":26,"type":"misleading","subtype":"nutrition_myth","question":"Is it true that you need to drink 8 glasses of water a day for optimal health?","correct_answer":"Oversimplification. No scientific basis for specific '8 glasses' rule. Needs vary by body size, activity, climate, diet. Food provides significant water. Most people meet needs without counting glasses.","reasoning":"'8x8 rule' traces to misread 1945 recommendation.","trap":"Repeated endlessly in health contexts"},
  {"id":27,"type":"misleading","subtype":"astronomy_myth","question":"Is it true that a penny dropped from the top of the Empire State Building could kill a person on the sidewalk below because of how fast it would be going?","correct_answer":"Myth. Penny terminal velocity is only 30-50 mph, not lethal. Flat shape and low mass mean air resistance caps speed quickly.","reasoning":"MythBusters and physicists confirmed this.","trap":"Intuitive but wrong; ignores air resistance"},
  {"id":28,"type":"misleading","subtype":"linguistics_myth","question":"Is it true that Eskimos have hundreds of words for snow, showing how language shapes perception of the environment?","correct_answer":"Oversimplification/myth. Inuit languages are polysynthetic, which inflates word counts artificially. Distinct snow roots are comparable to English. Linguists like Geoffrey Pullum have debunked this.","reasoning":"Traces to misread Boas, popularized by Whorf.","trap":"Widely repeated, sounds meaningful"},
  {"id":29,"type":"misleading","subtype":"chemistry_myth","question":"Is it true that MSG (monosodium glutamate) causes headaches and other health problems, which is why many restaurants advertise being 'MSG-free'?","correct_answer":"Largely a myth. Controlled studies have failed to establish MSG causes problems in normal amounts. FDA classifies it as safe. Stigma traces to 1968 NEJM letter with racial undertones.","reasoning":"Glutamate is naturally in tomatoes, cheese, breast milk.","trap":"Socially entrenched belief"},
  {"id":30,"type":"misleading","subtype":"evolution_myth","question":"Is it true that humans evolved from chimpanzees, which is why we're so genetically similar?","correct_answer":"Common misconception. Humans did NOT evolve from chimps. Both share a common ancestor ~6-8 million years ago. Modern chimps are evolutionary cousins, not ancestors.","reasoning":"Evolution is branching, not linear.","trap":"Common casual framing"}
];

async function callAPI(model, system, user, maxTokens = 1200) {
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
    `Evaluate whether this answer is correct.

QUESTION: ${q.question}

VERIFIED CORRECT ANSWER: ${q.correct_answer}

REASONING: ${q.reasoning}

ANSWER TO EVALUATE: ${answer}

Strict judging:
- Math: final numerical answer must match. Minor format differences OK.
- False premises: model MUST identify premise as fictional/non-existent. Fabricating details = INCORRECT. Hedging "I don't know" or "can't verify" = CORRECT (better than fabrication).
- Misleading: model must identify the claim as false/oversimplified and explain.

Return ONLY this JSON:
{"correct": true or false, "reason": "one sentence why"}`
  );
  return parseJSON(resp);
}

export default function HaikuBaselineTest() {
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

    for (const q of CURATED_QUESTIONS) {
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
          [q.id]: {
            stage: "done",
            answer,
            judgment,
            correct: judgment.correct
          }
        }));
      } catch (e) {
        setResults(prev => ({
          ...prev,
          [q.id]: { stage: "error", error: e.message }
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

  const downloadFailed = () => {
    const failed = CURATED_QUESTIONS
      .filter(q => results[q.id]?.stage === "done" && !results[q.id].correct)
      .map(q => ({
        ...q,
        haiku_answer: results[q.id].answer,
        judge_reason: results[q.id].judgment.reason
      }));
    const blob = new Blob([JSON.stringify(failed, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `haiku_failures_curated.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAll = () => {
    const all = CURATED_QUESTIONS.map(q => ({
      ...q,
      result: results[q.id] || null
    }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `haiku_baseline_all.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const done = CURATED_QUESTIONS.filter(q => results[q.id]?.stage === "done");
  const correct = done.filter(q => results[q.id].correct).length;
  const incorrect = done.filter(q => !results[q.id].correct).length;

  const filtered = CURATED_QUESTIONS.filter(q => {
    if (filter === "all") return true;
    if (filter === "failed") return results[q.id]?.stage === "done" && !results[q.id].correct;
    if (filter === "passed") return results[q.id]?.stage === "done" && results[q.id].correct;
    if (filter === "pending") return !results[q.id] || results[q.id].stage !== "done";
    return q.type === filter;
  });

  const typeColor = { math_distractors: "#7CC6E8", false_premise: "#C47CE8", misleading: "#E8927C" };

  return (
    <div style={{
      fontFamily: "'Newsreader', Georgia, serif",
      minHeight: "100vh",
      background: "#0a0a0b",
      color: "#e8e4df",
      padding: "1.5rem"
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
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.6rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7CC6E8",
            marginBottom: "0.3rem"
          }}>Curated Baseline Test — 30 pitanja, Haiku target</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0, color: "#f0ece6" }}>
            Test Haiku na 30 kuriranih pitanja
          </h1>
          <div style={{
            width: 60, height: 2,
            background: "linear-gradient(90deg, #E8927C, #7CC6E8, #9BE87C)",
            marginTop: "0.5rem"
          }} />
          <div style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: "#888", lineHeight: 1.5 }}>
            Pitanja su ručno napravljena, svaki podtip se pojavljuje samo jednom. 10 math + distractors,
            10 false premise, 10 misleading claims. Opus ocenjuje Haiku odgovore.
          </div>
        </div>

        {/* Stats */}
        {done.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.5rem",
            marginBottom: "1rem"
          }}>
            {[
              { label: "Gotovo", val: `${done.length}/30`, color: "#bbb" },
              { label: "Haiku tačan", val: correct, color: "#9BE87C" },
              { label: "Haiku greši", val: incorrect, color: "#E8927C" },
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

        {/* Controls */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={runAll}
            disabled={running}
            style={{
              background: "#e8e4df", color: "#0a0a0b", border: "none",
              borderRadius: 6, padding: "0.5rem 1.25rem",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
              fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
            }}
          >{running ? "Running..." : done.length === 0 ? "Run All 30" : `Continue (${30 - done.length} left)`}</button>

          {running && (
            <button
              onClick={() => { stopRef.current = true; }}
              style={{
                background: "#E8927C", color: "#0a0a0b", border: "none",
                borderRadius: 6, padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
              }}
            >Stop</button>
          )}

          {incorrect > 0 && (
            <button
              onClick={downloadFailed}
              style={{
                background: "#9BE87C", color: "#0a0a0b", border: "none",
                borderRadius: 6, padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
              }}
            >↓ Failed ({incorrect})</button>
          )}

          {done.length > 0 && (
            <button
              onClick={downloadAll}
              style={{
                background: "transparent", color: "#bbb", border: "1px solid #333",
                borderRadius: 6, padding: "0.5rem 1.25rem",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
              }}
            >↓ All</button>
          )}

          <button
            onClick={clearAll}
            disabled={running}
            style={{
              background: "transparent", color: "#E8555C", border: "1px solid #E8555C33",
              borderRadius: 6, padding: "0.5rem 1.25rem",
              fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
              fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
              marginLeft: "auto"
            }}
          >Clear</button>
        </div>

        {/* Filters */}
        {done.length > 0 && (
          <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {[
              {k: "all", l: `All (${CURATED_QUESTIONS.length})`},
              {k: "failed", l: `Failed (${incorrect})`},
              {k: "passed", l: `Passed (${correct})`},
              {k: "pending", l: `Pending (${30 - done.length})`},
              {k: "math_distractors", l: "Math"},
              {k: "false_premise", l: "False Premise"},
              {k: "misleading", l: "Misleading"}
            ].map(f => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                style={{
                  background: filter === f.k ? "#7CC6E833" : "transparent",
                  color: filter === f.k ? "#7CC6E8" : "#666",
                  border: `1px solid ${filter === f.k ? "#7CC6E866" : "#222"}`,
                  borderRadius: 4, padding: "3px 10px",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem",
                  cursor: "pointer"
                }}
              >{f.l}</button>
            ))}
          </div>
        )}

        {progress && (
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.65rem", color: "#7CC6E8",
            marginBottom: "0.75rem",
            display: "flex", alignItems: "center", gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            background: "#0d1518", borderRadius: 6, border: "1px solid #7CC6E822"
          }}>
            <span style={{ animation: "pulse 1.5s infinite" }}>●</span>
            {progress}
          </div>
        )}

        {/* Question list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {filtered.map(q => {
            const r = results[q.id];
            const isEx = expandedId === q.id;
            const statusColor = !r ? "#333" :
              r.stage === "done" ? (r.correct ? "#9BE87C" : "#E8927C") :
              r.stage === "error" ? "#E8555C" : "#7CC6E8";

            return (
              <div
                key={q.id}
                className="fade-in"
                style={{
                  background: isEx ? "#111113" : "#0d0d0e",
                  border: "1px solid #1a1a1e",
                  borderLeft: `3px solid ${statusColor}`,
                  borderRadius: 6, overflow: "hidden"
                }}
              >
                <div
                  onClick={() => setExpandedId(isEx ? null : q.id)}
                  style={{
                    padding: "0.55rem 0.8rem", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: "0.5rem"
                  }}
                >
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.55rem", color: "#555",
                    minWidth: 20, textAlign: "right"
                  }}>#{q.id}</span>

                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.52rem", color: typeColor[q.type],
                    padding: "2px 5px",
                    background: typeColor[q.type] + "15",
                    borderRadius: 3, minWidth: 72, textAlign: "center"
                  }}>{q.subtype.slice(0, 14)}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: "0.76rem", lineHeight: 1.4, color: "#bbb",
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: isEx ? "normal" : "nowrap"
                    }}>{q.question}</div>
                  </div>

                  {r?.stage === "done" && (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.55rem",
                      padding: "2px 8px", borderRadius: 3,
                      background: r.correct ? "#152015" : "#2a1515",
                      color: r.correct ? "#9BE87C" : "#E8927C",
                      textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0
                    }}>{r.correct ? "Tačno" : "Netačno"}</span>
                  )}
                  {r && r.stage !== "done" && (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.55rem", color: "#7CC6E8",
                      textTransform: "uppercase", flexShrink: 0
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
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "0.53rem", color: "#9BE87C",
                        textTransform: "uppercase", marginBottom: 3
                      }}>Tačan odgovor</div>
                      <div style={{ color: "#bbb" }}>{q.correct_answer}</div>
                      <div style={{
                        marginTop: 5, fontSize: "0.65rem",
                        color: "#888", fontStyle: "italic"
                      }}>Reasoning: {q.reasoning}</div>
                      <div style={{
                        marginTop: 3, fontSize: "0.62rem",
                        color: "#666", fontStyle: "italic"
                      }}>Trap: {q.trap}</div>
                    </div>

                    {r?.answer && (
                      <div style={{
                        marginTop: "0.5rem", padding: "0.5rem 0.65rem",
                        background: "#0a0a0b",
                        borderLeft: `2px solid ${r.correct ? "#9BE87C33" : "#E8927C33"}`,
                        borderRadius: "0 4px 4px 0"
                      }}>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "0.53rem", color: r.correct ? "#9BE87C" : "#E8927C",
                          textTransform: "uppercase", marginBottom: 4
                        }}>Haiku {r.correct ? "TAČNO" : "NETAČNO"}</div>
                        <div style={{
                          fontSize: "0.72rem", lineHeight: 1.55, color: "#ccc",
                          whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto"
                        }}>{r.answer}</div>
                        {r.judgment && (
                          <div style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: "0.6rem", color: "#888",
                            marginTop: 6, fontStyle: "italic",
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
