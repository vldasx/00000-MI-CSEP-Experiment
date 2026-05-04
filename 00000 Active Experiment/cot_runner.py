from api_client import call_api

_COT_PASS = """\
You are answering a question using structured reasoning. Follow these steps carefully and completely.

Step 1 - Knowledge activation: Write down everything you know that is relevant to this question. Be specific, list facts and concepts, not vague impressions.

Step 2 - Problem decomposition: Break the question down into its core components. What exactly is being asked? What sub-problems need to be solved first?

Step 3 - Reasoning: Work through each sub-problem one at a time. Show every step. Do not jump to conclusions.

Step 4 - Synthesis: Form your conclusion using only what you derived above. Do not add anything new at this stage.

Step 5 - Verification: Challenge your conclusion as if you were a critic trying to disprove it. What is the strongest argument against your answer? If that argument holds, correct your reasoning before giving a final answer.

Question: {question}"""

_COT_SYNTHESIS = """\
You have answered the same question three times using independent reasoning. Here are your three attempts:

Attempt 1:
{attempt1}

Attempt 2:
{attempt2}

Attempt 3:
{attempt3}

Compare the three attempts. If they agree, state the final answer. If they disagree, identify exactly where and why they differ, resolve the conflict explicitly, and then state the final answer.

Final answer:"""


def run_cot(model_id: str, question: str) -> dict:
    """Execute the COT pipeline: 3 independent passes + 1 synthesis call."""
    passes = []
    for i in range(3):
        print(f"      COT pass {i + 1}/3 ", end="", flush=True)
        prompt = _COT_PASS.format(question=question)
        response = call_api(model_id, [{"role": "user", "content": prompt}], call_type="cot_pass")
        passes.append(response)
        print("ok")

    print("      COT synthesis ", end="", flush=True)
    synthesis_prompt = _COT_SYNTHESIS.format(
        attempt1=passes[0],
        attempt2=passes[1],
        attempt3=passes[2],
    )
    synthesis = call_api(
        model_id,
        [{"role": "user", "content": synthesis_prompt}],
        call_type="cot_synthesis",
    )
    print("ok")

    return {
        "pass1": passes[0],
        "pass2": passes[1],
        "pass3": passes[2],
        "synthesis": synthesis,
        "final_response": synthesis,
    }
