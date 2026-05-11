from api_client import call_api

_CLASS_PROMPT = """\
Before answering, consider what this question is really asking for. Is it looking for a calculation, a fact, an analysis, a creative response, or something else? Name the type, then respond in the way that best fits it.

Question: {question}"""

_DECOMP_PROMPT = """\
You are analyzing a question before answering it. Here is the question and its identified type:

Question: {question}
Question type: {class_output}

Follow these steps precisely:

Step 1: Identify the main concept that best describes the overall meaning of this question.

Step 2a: Describe this main concept in 3 sentences in the context of the question.
Step 2b: Answer three things about the question, one sentence each: what are the ideas, what are the goals, what needs to be solved.
Step 2c: List three specific facts you know about this concept that are directly relevant to the question.

Then answer: can you respond to this question without guessing? Yes or No.

For each of the 3 sentences from Step 2a, answer this: "Can you name a specific example that confirms this statement, and one that would disprove it? If you cannot do either, explain why."

If two or more sentences fail this check and the concept is essential for a meaningful answer: respond "I cannot reliably answer this question because I lack knowledge about X." and stop.

If two or more sentences fail this check but a meaningful answer is still possible: continue but mark this as a weak point and explain why.

Step 3: Identify sub-concepts of the question if any exist. For each sub-concept, repeat Steps 2a through 2c.

Step 4: If any sub-concept is complex enough to require further decomposition, repeat Step 3 on it. Maximum depth: 3 levels.

If the question is simple and has only one concept with no multi-step reasoning required, stop after Step 2c."""

_REINTEGRATE_ONLY = """\
You have analyzed a question through conceptual decomposition. Now generate your answer using all the context below.

Original question: {question}
Question type: {class_output}
Decomposition analysis: {decomp_output}

Using all of the above as context, including any weak points identified, generate your answer to the original question."""

_REINTEGRATE_WITH_ZS = """\
You have analyzed a question through conceptual decomposition. Now generate your answer using all the context below.

Original question: {question}
Original zero-shot answer: {zeroshot_answer}
Question type: {class_output}
Decomposition analysis: {decomp_output}

Using all of the above as context, including any weak points identified, generate your answer to the original question."""

_POLISH_PROMPT = """\
You have generated an answer to a question. Review and polish it now.

Original question: {question}
Main concept: {main_concept}
Your draft answer: {reintegration_output}

Is your answer consistent with the main concept? Are all weak points noted? Fix any inconsistencies and complete any parts that are incomplete. Provide your final polished answer."""


def _extract_main_concept(decomp: str) -> str:
    """Pull the first meaningful line after a 'Step 1' marker, or fallback to first sentence."""
    lines = decomp.splitlines()
    for i, line in enumerate(lines):
        ll = line.lower()
        if "step 1" in ll or "main concept" in ll:
            for j in range(i + 1, min(i + 5, len(lines))):
                candidate = lines[j].strip().lstrip("-:*• ")
                if len(candidate) > 10:
                    return candidate[:250]
    # Fallback: first non-empty sentence
    for sent in decomp.replace("\n", " ").split("."):
        s = sent.strip()
        if len(s) > 10:
            return s[:250]
    return decomp[:250]


def run_csep(model_id: str, question: str, zeroshot_answer: str = None) -> dict:
    """
    Execute the CSEP pipeline: Class → Decompose → Reintegrate → Polish.
    Pass zeroshot_answer to use Condition-4 variant of the Reintegration prompt.
    """
    # 1. Classify
    print("      CSEP class ", end="", flush=True)
    class_output = call_api(
        model_id,
        [{"role": "user", "content": _CLASS_PROMPT.format(question=question)}],
        call_type="csep_class",
    )
    print("ok")

    # 2. Decompose
    print("      CSEP decompose ", end="", flush=True)
    decomp_output = call_api(
        model_id,
        [{"role": "user", "content": _DECOMP_PROMPT.format(
            question=question,
            class_output=class_output,
        )}],
        call_type="csep_decomp",
    )
    print("ok")

    # 3. Reintegrate
    print("      CSEP reintegrate ", end="", flush=True)
    if zeroshot_answer:
        reint_prompt = _REINTEGRATE_WITH_ZS.format(
            question=question,
            zeroshot_answer=zeroshot_answer,
            class_output=class_output,
            decomp_output=decomp_output,
        )
    else:
        reint_prompt = _REINTEGRATE_ONLY.format(
            question=question,
            class_output=class_output,
            decomp_output=decomp_output,
        )
    reint_output = call_api(
        model_id,
        [{"role": "user", "content": reint_prompt}],
        call_type="csep_reintegrate",
    )
    print("ok")

    # 4. Polish
    print("      CSEP polish ", end="", flush=True)
    main_concept = _extract_main_concept(decomp_output)
    polish_output = call_api(
        model_id,
        [{"role": "user", "content": _POLISH_PROMPT.format(
            question=question,
            main_concept=main_concept,
            reintegration_output=reint_output,
        )}],
        call_type="csep_polish",
    )
    print("ok")

    return {
        "class_output": class_output,
        "decomp_output": decomp_output,
        "reintegration_output": reint_output,
        "polish_output": polish_output,
        "main_concept": main_concept,
        "final_response": polish_output,
    }
