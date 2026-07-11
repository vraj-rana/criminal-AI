import json

from sql_agent import english_to_sql
from database import run_sql
from case_lookup import get_case_id
from llm import summarize_hybrid_result
from graph_analysis import analyze_case
from context_builder import build_case_context
from reranker import rerank_cases

# ----------------------------------------------------
# Configuration
# ----------------------------------------------------

MAX_CASES = 5

# ----------------------------------------------------
# Build document lookup
# ----------------------------------------------------

doc_lookup = {}

with open("documents.jsonl", "r", encoding="utf8") as f:

    for line in f:

        doc = json.loads(line)

        doc_lookup[str(doc["crime_no"])] = doc

print("Loaded", len(doc_lookup), "documents")

# ----------------------------------------------------
# Hybrid Search
# ----------------------------------------------------

def hybrid_search(question):

    # ------------------------------------------------
    # Step 1 : Generate SQL
    # ------------------------------------------------

    sql = english_to_sql(
    question,
    mode="hybrid"
    )

    rows = run_sql(sql)
    print("Rows returned:", len(rows))
    # ------------------------------------------------
    # Step 2 : SQL Results -> Candidate Cases
    # ------------------------------------------------

    candidate_cases = []

    seen = set()

    for row in rows:

        crime_no = str(row[0])

        if crime_no in seen:
            continue

        seen.add(crime_no)

        case_id = get_case_id(crime_no)

        if case_id is None:
            continue

        if crime_no not in doc_lookup:
            continue

        candidate_cases.append({

            "case_id": case_id,

            "crime_no": crime_no,

            "narrative": doc_lookup[crime_no]["narrative_text"]

        })

    # ------------------------------------------------
    # Step 3 : Embedding Reranking
    # ------------------------------------------------

    best_cases = rerank_cases(

        question,

        candidate_cases,

        top_k=MAX_CASES

    )

    # ------------------------------------------------
    # Step 4 : Build Investigation Context
    # ------------------------------------------------

    context = ""

    context += "=" * 80 + "\n"

    context += (
        f"SQL returned {len(candidate_cases)} matching cases.\n"
    )

    context += (
        f"Showing investigation for the Top "
        f"{len(best_cases)} semantically relevant cases.\n\n"
    )

    # ------------------------------------------------
    # Step 5 : Investigation Engine
    # ------------------------------------------------

    for case in best_cases:

        analysis = analyze_case(case["case_id"])

        context += build_case_context(analysis)

        context += "\n"

        context += "=" * 80

        context += "\n\n"

    return sql, rows, context

# ----------------------------------------------------
# Main
# ----------------------------------------------------

if __name__ == "__main__":

    question = input("Ask : ")

    sql, rows, context = hybrid_search(question)

    print("\n================ GENERATED SQL ================\n")

    print(sql)

    print("\nReturned SQL Rows :", len(rows))

    print("\n================ INVESTIGATION CONTEXT ================\n")

    print(context)

    print("\n================ FINAL INVESTIGATION REPORT ================\n")

    print("Context length:", len(context))
    answer = summarize_hybrid_result(
        question,
        context
    )

    print(answer)