from sentence_transformers import SentenceTransformer
from sentence_transformers.util import cos_sim

# Load once
model = SentenceTransformer("all-MiniLM-L6-v2")


def rerank_cases(question, candidate_cases, top_k=5):
    """
    candidate_cases is a list like:

    [
        {
            "case_id": "...",
            "crime_no": "...",
            "narrative": "..."
        }
    ]
    """

    if len(candidate_cases) <= top_k:
        return candidate_cases

    question_embedding = model.encode(question, convert_to_tensor=True)

    narratives = [
        case["narrative"]
        for case in candidate_cases
    ]

    narrative_embeddings = model.encode(
        narratives,
        convert_to_tensor=True
    )

    similarities = cos_sim(
        question_embedding,
        narrative_embeddings
    )[0]

    scored = []

    for score, case in zip(similarities, candidate_cases):

        scored.append((float(score), case))

    scored.sort(reverse=True, key=lambda x: x[0])

    return [
        case
        for _, case in scored[:top_k]
    ]