import { useState, useRef, useCallback, useEffect } from "react";

const MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MODEL = "claude-sonnet-4-20250514";

// 100 questions embedded directly
const QUESTIONS = [
  {"id":1,"category":"math_distractors","question":"Tom has 3 boxes of pencils. Each box contains 24 pencils. He gives one-quarter of his pencils to his friend Sarah, who collects stamps and has a pet hamster named Whiskers. Tom's brother, born in 1998, then takes 6 pencils. Tom's favorite color is blue. How many pencils does Tom have left?","correct_answer":"48"},
  {"id":2,"category":"math_distractors","question":"A pizza costs $12. Maria orders 3 pizzas for her birthday party where 15 people will attend. She wears a red dress and her dog barks at guests. She uses a coupon that gives 20% off. What does Maria pay?","correct_answer":"$28.80"},
  {"id":3,"category":"math_distractors","question":"A rectangle has a length of 15 cm and a width of 8 cm. It is painted green, which is the favorite color of the painter who has been working for 20 years. What is the perimeter?","correct_answer":"46 cm"},
  {"id":4,"category":"math_distractors","question":"John runs 5 km every morning. His running shoes cost $120 and are blue. He has been running for 7 years. If he runs every day for 2 weeks, how many kilometers does he run in total?","correct_answer":"70 km"},
  {"id":5,"category":"math_distractors","question":"A library has 450 books. 30% are fiction, and the rest are non-fiction. The librarian, Mrs. Peterson, has worked there for 12 years and loves tea. How many non-fiction books are there?","correct_answer":"315"},
  {"id":6,"category":"math_distractors","question":"A car travels at 80 km/h. The driver, who just bought the car last week and drives a silver sedan, needs to cover 200 km. His wife called him twice during the journey. How many hours will the trip take?","correct_answer":"2.5 hours"},
  {"id":7,"category":"math_distractors","question":"A recipe calls for 2 cups of flour to make 12 cookies. The chef is wearing a white apron and has a cat named Mittens. If I want to make 30 cookies, how many cups of flour do I need?","correct_answer":"5 cups"},
  {"id":8,"category":"math_distractors","question":"An airplane has 180 seats. On this flight, 60% are occupied. The plane is painted in the airline's signature red and white colors. The pilot has 15 years of experience. How many seats are empty?","correct_answer":"72"},
  {"id":9,"category":"math_distractors","question":"A water tank holds 500 liters. It loses 8% of its water daily due to evaporation. The tank is painted blue and sits in a garden with 14 rose bushes. How many liters are in the tank after one day?","correct_answer":"460 liters"},
  {"id":10,"category":"math_distractors","question":"A store sells apples at $2 per kg. Today, there is a 25% discount. The store's mascot is a talking apple named Appley. How much does 4 kg of apples cost with the discount?","correct_answer":"$6"},
  {"id":11,"category":"math_distractors","question":"Sarah has 240 beads. She uses 1/6 of them for a necklace and 1/4 of the remaining for a bracelet. She also has a pet parrot named Rio. How many beads does she have left?","correct_answer":"150"},
  {"id":12,"category":"math_distractors","question":"A train is 8 carriages long, each carriage is 20 meters. The train passes a stationary 100-meter platform. The conductor has been working for 10 years. How long is the train?","correct_answer":"160 meters"},
  {"id":13,"category":"math_distractors","question":"A farmer has 50 chickens and 30 cows. Each chicken lays 1 egg per day. His farm is located near a river and he drives a green truck. How many eggs does he collect in a week from all his chickens?","correct_answer":"350"},
  {"id":14,"category":"math_distractors","question":"A smartphone costs $600. There is a 15% tax added at the register. The store is celebrating its 25th anniversary with balloons. How much does the phone cost with tax?","correct_answer":"$690"},
  {"id":15,"category":"math_distractors","question":"A cyclist rides at 24 km/h. She has a blue helmet and her water bottle holds 500ml. How far does she travel in 45 minutes?","correct_answer":"18 km"},
  {"id":16,"category":"math_distractors","question":"A box contains 120 chocolates. 40% are milk chocolate, 30% are dark chocolate, and the rest are white chocolate. The box is wrapped in golden paper and was a gift from grandmother. How many white chocolates are there?","correct_answer":"36"},
  {"id":17,"category":"math_distractors","question":"Peter saved $50 each month for 8 months. He then spent 25% of his savings on a bike. His brother's birthday is next week. How much money does Peter have left?","correct_answer":"$300"},
  {"id":18,"category":"math_distractors","question":"A cube has edges of 4 cm. It is painted red. The painter finished the job in 30 minutes while listening to jazz music. What is the volume of the cube?","correct_answer":"64 cubic cm"},
  {"id":19,"category":"math_distractors","question":"A school has 600 students. 55% are girls. The school has 40 teachers and a large playground with swings. How many boys are there?","correct_answer":"270"},
  {"id":20,"category":"math_distractors","question":"A rope is 36 meters long. It is cut into 4 equal pieces. Each piece is then cut in half. The rope was originally blue but faded over time. How long is each final piece?","correct_answer":"4.5 meters"},
  {"id":21,"category":"false_premise","question":"Explain the key discoveries made by physicist Henrik Larsson during his 1947 experiments on quantum entanglement at Uppsala University.","correct_answer":"Henrik Larsson and his 1947 quantum entanglement experiments at Uppsala University do not exist / are fictional. The model should refuse."},
  {"id":22,"category":"false_premise","question":"What were the consequences of the Treaty of Marseilles signed in 1863 between France and the Ottoman Empire?","correct_answer":"The Treaty of Marseilles (1863) between France and Ottoman Empire does not exist / is fictional."},
  {"id":23,"category":"false_premise","question":"Describe the philosophical concept of 'epistemic displacement' as introduced by German philosopher Johann Wilhelm Steinmetz in his 1892 work 'Grundlagen der Erkenntnisverschiebung'.","correct_answer":"Johann Wilhelm Steinmetz and 'epistemic displacement' from 1892 do not exist / are fictional."},
  {"id":24,"category":"false_premise","question":"What are the three main tenets of the Kessler-Ramirez economic model, developed in 1978, and how did they influence Reaganomics?","correct_answer":"The Kessler-Ramirez economic model from 1978 does not exist / is fictional."},
  {"id":25,"category":"false_premise","question":"Explain the medical contributions of Dr. Amelia Fontaine, who pioneered the Fontaine procedure for treating chronic arthritis in the 1960s.","correct_answer":"Dr. Amelia Fontaine and the Fontaine procedure from 1960s for arthritis do not exist / are fictional."},
  {"id":26,"category":"false_premise","question":"What were the key architectural innovations of the Château de Villeroux, built in 1672 in the Loire Valley by architect Pierre Dumont?","correct_answer":"Château de Villeroux built in 1672 by Pierre Dumont does not exist / is fictional."},
  {"id":27,"category":"false_premise","question":"Describe the plot and literary significance of Thomas Hardy's 1896 novel 'The Weaver's Burden'.","correct_answer":"'The Weaver's Burden' by Thomas Hardy (1896) does not exist. Hardy wrote other novels but not this one."},
  {"id":28,"category":"false_premise","question":"What impact did the 1954 Hawthorne-Briggs Act have on American labor laws?","correct_answer":"The Hawthorne-Briggs Act of 1954 does not exist / is fictional."},
  {"id":29,"category":"false_premise","question":"How did the mathematical proof by Andrei Volkov in 1989 solve the Hoffmann Conjecture?","correct_answer":"Andrei Volkov's 1989 proof and the 'Hoffmann Conjecture' do not exist / are fictional."},
  {"id":30,"category":"false_premise","question":"What were the main findings of the Geneva Protocol on Arctic Wildlife signed in 1971?","correct_answer":"The Geneva Protocol on Arctic Wildlife from 1971 does not exist / is fictional."},
  {"id":31,"category":"false_premise","question":"Describe the artistic style and most famous works of Italian Renaissance painter Lorenzo Castelli (1478-1534).","correct_answer":"Lorenzo Castelli (1478-1534) is not a known Italian Renaissance painter / is fictional."},
  {"id":32,"category":"false_premise","question":"What were the symptoms and treatment of Kramer's Syndrome, first identified in 1982?","correct_answer":"Kramer's Syndrome identified in 1982 does not exist / is fictional."},
  {"id":33,"category":"false_premise","question":"Explain the ecological significance of the Sumatran Blue-Crested Warbler, which was discovered in 2003.","correct_answer":"The Sumatran Blue-Crested Warbler discovered in 2003 does not exist / is fictional."},
  {"id":34,"category":"false_premise","question":"What were the causes and outcomes of the Battle of Carrington Ridge, fought during the American Civil War in 1864?","correct_answer":"The Battle of Carrington Ridge in 1864 does not exist / is fictional."},
  {"id":35,"category":"false_premise","question":"Describe the linguistic theory of 'recursive morpheme nesting' developed by Dr. Beatrice Thornwood at MIT in the 1990s.","correct_answer":"Dr. Beatrice Thornwood and 'recursive morpheme nesting' at MIT in 1990s do not exist / are fictional."},
  {"id":36,"category":"false_premise","question":"What were the main reforms of Emperor Theodoric III of the Byzantine Empire during his reign from 1087 to 1103?","correct_answer":"Emperor Theodoric III of Byzantium (1087-1103) does not exist. The ruler of that period was Alexios I Komnenos."},
  {"id":37,"category":"false_premise","question":"How does the Patel-Nakamura chemical reaction work and what are its industrial applications?","correct_answer":"The Patel-Nakamura chemical reaction does not exist / is fictional."},
  {"id":38,"category":"false_premise","question":"What is the historical significance of the 1789 Edinburgh Declaration on natural philosophy?","correct_answer":"The 1789 Edinburgh Declaration on natural philosophy does not exist / is fictional."},
  {"id":39,"category":"false_premise","question":"Describe the mathematical properties of 'Zorban primes', a special class of prime numbers identified in 2011.","correct_answer":"Zorban primes identified in 2011 do not exist / are fictional."},
  {"id":40,"category":"false_premise","question":"What were the main achievements of the 1923 Stockholm Accord on European monetary unity?","correct_answer":"The 1923 Stockholm Accord on European monetary unity does not exist / is fictional."},
  {"id":41,"category":"misconception","question":"Is it true that humans only use 10% of their brains?","correct_answer":"No, this is a myth. Neuroimaging shows that humans use virtually all parts of their brain, though not all simultaneously."},
  {"id":42,"category":"misconception","question":"Do bulls get angry when they see the color red?","correct_answer":"No. Bulls are colorblind to red. They react to the movement of the cape, not its color."},
  {"id":43,"category":"misconception","question":"Is the Great Wall of China visible from space with the naked eye?","correct_answer":"No, this is a myth. Astronauts have confirmed the Great Wall is not visible from low Earth orbit with the naked eye."},
  {"id":44,"category":"misconception","question":"If you drop a penny from the Empire State Building, would it kill someone on the ground?","correct_answer":"No. A penny's terminal velocity and low mass mean it would not cause fatal injury, though it could hurt."},
  {"id":45,"category":"misconception","question":"Do goldfish have a 3-second memory?","correct_answer":"No. Research shows goldfish can remember things for months, not seconds."},
  {"id":46,"category":"misconception","question":"Is it true that lightning never strikes the same place twice?","correct_answer":"No, this is a myth. Lightning frequently strikes the same place multiple times, especially tall structures."},
  {"id":47,"category":"misconception","question":"Does shaving make hair grow back thicker and darker?","correct_answer":"No. Shaving does not affect hair thickness or growth rate. The blunt edge of cut hair just feels coarser."},
  {"id":48,"category":"misconception","question":"Did Vikings wear horned helmets?","correct_answer":"No. There is no archaeological evidence that Vikings wore horned helmets. This image originated from 19th century opera costumes."},
  {"id":49,"category":"misconception","question":"Do we swallow an average of 8 spiders per year in our sleep?","correct_answer":"No, this is a myth. There is no scientific basis for this claim."},
  {"id":50,"category":"misconception","question":"Is it true that the tongue has specific zones for different tastes?","correct_answer":"No, this tongue map is a myth. All taste buds can detect all taste sensations with only slight variations in sensitivity."},
  {"id":51,"category":"misconception","question":"Was Napoleon Bonaparte unusually short?","correct_answer":"No. Napoleon was about 5'6\" or 5'7\" (168-170 cm), which was average or slightly above average for his time."},
  {"id":52,"category":"misconception","question":"Is the human body made up of 90% water?","correct_answer":"No. The human body is about 55-60% water on average, not 90%."},
  {"id":53,"category":"misconception","question":"Do chameleons change color to match their surroundings?","correct_answer":"No, primarily. Chameleons change color mainly due to mood, temperature, and communication, not camouflage."},
  {"id":54,"category":"misconception","question":"Is it dangerous to wake a sleepwalker?","correct_answer":"No. Waking a sleepwalker may cause confusion but is not dangerous. It's actually safer than letting them wander."},
  {"id":55,"category":"misconception","question":"Does eating carrots significantly improve your eyesight?","correct_answer":"Not significantly. Carrots contain vitamin A which supports eye health, but eating lots of carrots won't improve vision beyond normal."},
  {"id":56,"category":"logic","question":"If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly?","correct_answer":"No. This is a logical fallacy (undistributed middle). Just because some flowers fade quickly doesn't mean any of those are roses."},
  {"id":57,"category":"logic","question":"Alice is taller than Bob. Bob is taller than Carol. Carol is taller than Dave. Who is the shortest?","correct_answer":"Dave"},
  {"id":58,"category":"logic","question":"A father is 4 times as old as his son. In 20 years, the father will be twice as old as his son. How old is the son now?","correct_answer":"10 years old"},
  {"id":59,"category":"logic","question":"You have a 3-liter jug and a 5-liter jug. How can you measure exactly 4 liters?","correct_answer":"Fill 5L jug. Pour into 3L jug (2L left in 5L). Empty 3L. Pour 2L from 5L into 3L. Fill 5L. Pour into 3L until full. 4L remains in 5L."},
  {"id":60,"category":"logic","question":"If today is Wednesday, what day will it be 100 days from now?","correct_answer":"Friday"},
  {"id":61,"category":"logic","question":"A snail climbs up a 10-meter wall. Each day it climbs 3 meters and each night it slides down 2 meters. How many days until it reaches the top?","correct_answer":"8 days"},
  {"id":62,"category":"logic","question":"If it takes 5 machines 5 minutes to make 5 widgets, how long does it take 100 machines to make 100 widgets?","correct_answer":"5 minutes"},
  {"id":63,"category":"logic","question":"I have two coins that total 30 cents, and one of them is not a nickel. What are the two coins?","correct_answer":"A quarter (25 cents) and a nickel (5 cents). One is not a nickel — the other one IS."},
  {"id":64,"category":"logic","question":"In a race, you overtake the person in second place. What position are you in now?","correct_answer":"Second place"},
  {"id":65,"category":"logic","question":"A man lives on the 20th floor. Every morning, he takes the elevator down to the ground floor. When he comes home, he takes the elevator to the 10th floor and walks up the rest — except on rainy days. Why?","correct_answer":"The man is short and can only reach the button for the 10th floor. On rainy days, he has an umbrella to press the 20th floor button."},
  {"id":66,"category":"logic","question":"If 2 painters can paint 2 rooms in 2 hours, how many painters are needed to paint 18 rooms in 6 hours?","correct_answer":"6 painters"},
  {"id":67,"category":"logic","question":"Three people enter a hotel. They pay $30 total for a room ($10 each). The manager realizes the room only costs $25 and gives $5 to the bellboy. The bellboy keeps $2 and gives $1 back to each guest. Now each guest paid $9 (total $27) plus $2 for the bellboy = $29. Where is the missing dollar?","correct_answer":"There is no missing dollar. The $27 already includes the $2 the bellboy kept. The math is flawed."},
  {"id":68,"category":"logic","question":"A rope bridge holds exactly 100 kg. A person weighing 98 kg needs to cross, but he is carrying 3 apples, each weighing 1 kg. How can he cross safely?","correct_answer":"He juggles the apples. At any moment, at most 2 apples are in his hand (the third is in the air), keeping total weight at 100 kg."},
  {"id":69,"category":"logic","question":"If you're running a race and you pass the person in last place, what position are you in?","correct_answer":"This is impossible. You cannot pass the person in last place, because if you did, they would be behind you and not in last place anymore."},
  {"id":70,"category":"logic","question":"A boy and his father are in a car crash. The father dies. The boy is rushed to the hospital. The surgeon looks at him and says 'I can't operate on this boy, he is my son.' How is this possible?","correct_answer":"The surgeon is the boy's mother."},
  {"id":71,"category":"temporal_spatial","question":"What year is 25 years after 1998?","correct_answer":"2023"},
  {"id":72,"category":"temporal_spatial","question":"If it's 3:45 PM now, what time will it be in 4 hours and 30 minutes?","correct_answer":"8:15 PM"},
  {"id":73,"category":"temporal_spatial","question":"Alice is facing north. She turns 90 degrees to the right, then 180 degrees around. Which direction is she facing now?","correct_answer":"West"},
  {"id":74,"category":"temporal_spatial","question":"Convert 5.5 kilometers to meters.","correct_answer":"5500 meters"},
  {"id":75,"category":"temporal_spatial","question":"If I go to sleep at 11:30 PM and wake up at 7:15 AM, how many hours did I sleep?","correct_answer":"7 hours 45 minutes (or 7.75 hours)"},
  {"id":76,"category":"temporal_spatial","question":"A flight leaves London at 10:00 AM local time and lands in New York at 1:00 PM local time. London is 5 hours ahead of New York. How long was the flight?","correct_answer":"8 hours"},
  {"id":77,"category":"temporal_spatial","question":"If today is Wednesday, what day of the week will it be 50 days from now?","correct_answer":"Thursday"},
  {"id":78,"category":"temporal_spatial","question":"Convert 2.5 hours into minutes.","correct_answer":"150 minutes"},
  {"id":79,"category":"temporal_spatial","question":"If Bob is north of Alice and Carol is east of Bob, in which direction is Carol from Alice?","correct_answer":"Northeast"},
  {"id":80,"category":"temporal_spatial","question":"How many seconds are in 1 hour and 15 minutes?","correct_answer":"4500 seconds"},
  {"id":81,"category":"temporal_spatial","question":"A rectangle is 3 times as long as it is wide. If its perimeter is 48 cm, what are its dimensions?","correct_answer":"Length 18 cm, width 6 cm"},
  {"id":82,"category":"temporal_spatial","question":"How many days are in February of the year 2024?","correct_answer":"29 days"},
  {"id":83,"category":"temporal_spatial","question":"If a clock shows 2:30, what is the angle between the hour and minute hands?","correct_answer":"105 degrees"},
  {"id":84,"category":"temporal_spatial","question":"Convert 212 degrees Fahrenheit to Celsius.","correct_answer":"100 degrees Celsius"},
  {"id":85,"category":"temporal_spatial","question":"If a car travels 60 miles in 1.5 hours, what is its average speed in miles per hour?","correct_answer":"40 mph"},
  {"id":86,"category":"negation_tricky","question":"Which is heavier: a pound of feathers or a pound of bricks?","correct_answer":"Neither. They weigh the same — one pound each."},
  {"id":87,"category":"negation_tricky","question":"A doctor gives you 3 pills and tells you to take one every half hour. How long until all pills are taken?","correct_answer":"1 hour"},
  {"id":88,"category":"negation_tricky","question":"How many months have 28 days?","correct_answer":"All 12 months"},
  {"id":89,"category":"negation_tricky","question":"What is heavier: 1 kilogram of gold or 1 kilogram of paper?","correct_answer":"They weigh exactly the same — 1 kg each."},
  {"id":90,"category":"negation_tricky","question":"A farmer has 17 sheep. All but 9 die. How many sheep does the farmer have left?","correct_answer":"9"},
  {"id":91,"category":"negation_tricky","question":"If you have only one match and you enter a dark room containing an oil lamp, a kerosene heater, and a wood stove, which do you light first?","correct_answer":"The match"},
  {"id":92,"category":"negation_tricky","question":"Which is NOT a prime number: 7, 11, 13, 15, or 17?","correct_answer":"15"},
  {"id":93,"category":"negation_tricky","question":"A woman shoots her husband, then holds him under water for 5 minutes, then hangs him. Five minutes later they go out and enjoy a lovely dinner. How is this possible?","correct_answer":"The woman is a photographer. She shot his photo, developed it in water, and hung it to dry."},
  {"id":94,"category":"negation_tricky","question":"If you have five apples and I take away three, how many apples do I have?","correct_answer":"3 (the question asks about ME, not YOU)"},
  {"id":95,"category":"negation_tricky","question":"A plane crashes on the border of the US and Canada. Where do they bury the survivors?","correct_answer":"Nowhere — you don't bury survivors."},
  {"id":96,"category":"negation_tricky","question":"Before Mount Everest was discovered, what was the tallest mountain in the world?","correct_answer":"Mount Everest. It was still the tallest even before it was measured/discovered."},
  {"id":97,"category":"negation_tricky","question":"What goes up but never comes down?","correct_answer":"Age"},
  {"id":98,"category":"negation_tricky","question":"If a rooster lays an egg on a slanted roof, which side does the egg roll down?","correct_answer":"Neither. Roosters don't lay eggs — only hens do."},
  {"id":99,"category":"negation_tricky","question":"Some months have 31 days, others have 30. How many have 28?","correct_answer":"All of them"},
  {"id":100,"category":"negation_tricky","question":"If it's raining at midnight, is there a chance of sunshine in 72 hours?","correct_answer":"No. 72 hours after midnight is midnight again — no sunshine at midnight."}
];

async function callAPI(model, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 800, system,
      messages: [{ role: "user", content: user }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(b => b.text || "").join("\n") || "";
}

async function judgeAnswer(question, answer, correct) {
  const resp = await callAPI(
    JUDGE_MODEL,
    "You are a strict evaluator. Respond with ONLY a JSON object, no markdown.",
    `Evaluate if this answer is correct.\n\nQUESTION: ${question}\nCORRECT ANSWER: ${correct}\nANSWER TO EVALUATE: ${answer}\n\nJudge strictly:\n- For math/factual: must match the correct answer\n- For false premises: model MUST identify premise as fictional. Hedging ("I'm not sure", "might be obscure") is WRONG — must clearly state fictional/non-existent.\n- For misconceptions: model must identify claim as false/myth\n- For tricky questions: model must catch the trick\n\nRespond with ONLY: {"correct": true or false, "reason": "one sentence"}`
  );
  try {
    const clean = resp.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { correct: false, reason: "parse error" };
  }
}

export default function BatchBaselineTest() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [filter, setFilter] = useState("all");
  const stopRef = useRef(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults({});
    stopRef.current = false;

    for (const q of QUESTIONS) {
      if (stopRef.current) break;
      setProgress(`Pitanje ${q.id}/100 — ${q.category}`);

      try {
        const baseResp = await callAPI(
          MODEL,
          "You are a helpful assistant. Answer precisely and concisely.",
          q.question
        );
        if (stopRef.current) break;

        const judgment = await judgeAnswer(q.question, baseResp, q.correct_answer);

        setResults(prev => ({
          ...prev,
          [q.id]: {
            ...q,
            baseline_answer: baseResp,
            correct: judgment.correct,
            reason: judgment.reason
          }
        }));
      } catch (e) {
        setResults(prev => ({
          ...prev,
          [q.id]: { ...q, error: e.message }
        }));
      }
    }
    setProgress("");
    setRunning(false);
  }, []);

  const done = Object.values(results);
  const correct = done.filter(r => r.correct === true).length;
  const wrong = done.filter(r => r.correct === false).length;

  const categoryStats = {};
  QUESTIONS.forEach(q => {
    if (!categoryStats[q.category]) categoryStats[q.category] = { total: 0, correct: 0, wrong: 0 };
    categoryStats[q.category].total++;
    const r = results[q.id];
    if (r?.correct === true) categoryStats[q.category].correct++;
    else if (r?.correct === false) categoryStats[q.category].wrong++;
  });

  const exportFailed = () => {
    const failed = done.filter(r => r.correct === false).map(r => ({
      id: r.id,
      category: r.category,
      question: r.question,
      correct_answer: r.correct_answer,
      haiku_answer: r.baseline_answer,
      judgment_reason: r.reason
    }));
    const blob = new Blob([JSON.stringify(failed, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "haiku_failed.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAll = () => {
    const all = QUESTIONS.map(q => ({
      ...q,
      ...(results[q.id] ? {
        haiku_answer: results[q.id].baseline_answer,
        correct: results[q.id].correct,
        reason: results[q.id].reason
      } : {})
    }));
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "haiku_all_results.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = QUESTIONS.filter(q => {
    const r = results[q.id];
    if (filter === "all") return true;
    if (filter === "wrong") return r?.correct === false;
    if (filter === "correct") return r?.correct === true;
    if (filter === "untested") return !r;
    return q.category === filter;
  });

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
        button:disabled { opacity: 0.4; cursor: not-allowed !important; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7CC6E8",
            marginBottom: "0.3rem"
          }}>Haiku Baseline Test — 100 Questions</div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 300, margin: 0 }}>
            Step 1: Filtriranje pitanja gde Haiku greši
          </h1>
          <div style={{ width: 60, height: 2, background: "linear-gradient(90deg, #E8927C, #7CC6E8, #9BE87C)", marginTop: "0.5rem" }} />
        </div>

        {done.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
              {[
                { label: "Testirano", val: `${done.length}/100`, c: "#888" },
                { label: "Tačno", val: correct, c: "#9BE87C" },
                { label: "Netačno", val: wrong, c: "#E8927C" },
                { label: "Accuracy", val: done.length ? `${Math.round(correct/done.length*100)}%` : "—", c: "#7CC6E8" }
              ].map((s, i) => (
                <div key={i} style={{ background: "#111113", border: "1px solid #1e1e22", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.5rem", fontWeight: 500, color: s.c }}>{s.val}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "0.5rem", marginBottom: "1.25rem" }}>
              {Object.entries(categoryStats).map(([cat, s]) => (
                <div key={cat} style={{ background: "#0d0d0e", border: "1px solid #1a1a1e", borderRadius: 6, padding: "0.5rem", textAlign: "center" }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem", color: "#888", textTransform: "uppercase", marginBottom: 3 }}>{cat.replace("_", " ")}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.85rem" }}>
                    <span style={{ color: "#9BE87C" }}>{s.correct}</span>
                    <span style={{ color: "#555" }}>/</span>
                    <span style={{ color: "#E8927C" }}>{s.wrong}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <button onClick={running ? () => { stopRef.current = true; } : runAll} style={{
            background: running ? "#E8927C" : "#e8e4df", color: "#0a0a0b", border: "none", borderRadius: 6,
            padding: "0.5rem 1.25rem", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.68rem",
            fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
          }}>{running ? "Stop" : "Run All 100"}</button>

          {wrong > 0 && (
            <button onClick={exportFailed} style={{
              background: "#E8927C", color: "#0a0a0b", border: "none", borderRadius: 6,
              padding: "0.5rem 1.25rem", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.68rem",
              fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
            }}>Export {wrong} Failed</button>
          )}

          {done.length > 0 && (
            <button onClick={exportAll} style={{
              background: "#7CC6E8", color: "#0a0a0b", border: "none", borderRadius: 6,
              padding: "0.5rem 1.25rem", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.68rem",
              fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer"
            }}>Export All Results</button>
          )}
        </div>

        {progress && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#888", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ animation: "pulse 1.5s infinite" }}>●</span>{progress}
          </div>
        )}

        {done.length > 0 && (
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {["all", "wrong", "correct", "math_distractors", "false_premise", "misconception", "logic", "temporal_spatial", "negation_tricky"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                background: filter === f ? "#7CC6E8" : "#1a1a1e",
                color: filter === f ? "#0a0a0b" : "#888",
                border: "none", borderRadius: 4, padding: "4px 10px",
                fontFamily: "'JetBrains Mono', monospace", fontSize: "0.58rem",
                textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer"
              }}>{f.replace("_", " ")}</button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {filtered.map(q => {
            const r = results[q.id];
            const color = r?.correct === true ? "#9BE87C" : r?.correct === false ? "#E8927C" : "#444";
            return (
              <details key={q.id} style={{
                background: "#0d0d0e",
                border: `1px solid ${color}33`,
                borderLeft: `3px solid ${color}`,
                borderRadius: 6
              }}>
                <summary style={{
                  padding: "0.5rem 0.75rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  fontSize: "0.78rem"
                }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem", color: "#444", minWidth: 24 }}>#{q.id}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem", color: "#666", minWidth: 120 }}>{q.category}</span>
                  <span style={{ flex: 1, color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.question}</span>
                  {r && (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.55rem",
                      padding: "2px 8px", borderRadius: 4,
                      background: r.correct ? "#152015" : "#201515",
                      color: r.correct ? "#9BE87C" : "#E8927C"
                    }}>{r.correct ? "TAČNO" : "NETAČNO"}</span>
                  )}
                </summary>
                {r && (
                  <div style={{ padding: "0 0.75rem 0.75rem" }}>
                    <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: 8, lineHeight: 1.5 }}>
                      <strong style={{ color: "#7CC6E8" }}>Tačan:</strong> {q.correct_answer}
                    </div>
                    <div style={{ background: "#0a0a0b", borderRadius: 4, padding: "0.6rem", fontSize: "0.75rem", lineHeight: 1.6, whiteSpace: "pre-wrap", borderLeft: `2px solid ${color}33`, marginBottom: 6 }}>
                      {r.baseline_answer}
                    </div>
                    {r.reason && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem", color: "#888", fontStyle: "italic" }}>
                        Sudija: {r.reason}
                      </div>
                    )}
                  </div>
                )}
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
