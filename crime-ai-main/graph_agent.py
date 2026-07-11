import json
import chromadb
from sentence_transformers import SentenceTransformer

from graph_analysis import analyze_case
from context_builder import build_case_context
from llm import summarize_graph_result

# -----------------------------------------------------
# Configuration
# -----------------------------------------------------

TOP_K = 5

# -----------------------------------------------------
# Load embedding model
# -----------------------------------------------------

model = SentenceTransformer("all-MiniLM-L6-v2")

# -----------------------------------------------------
# Load ChromaDB
# -----------------------------------------------------

client = chromadb.PersistentClient(path="./chromadb")

collection = client.get_collection("crime_documents")

# -----------------------------------------------------
# Build document lookup
# -----------------------------------------------------

doc_lookup = {}

with open("documents.jsonl", "r", encoding="utf8") as f:

    for line in f:

        doc = json.loads(line)

        doc_lookup[doc["doc_id"]] = doc

print("Loaded", len(doc_lookup), "documents")

# -----------------------------------------------------
# Retrieve similar cases
# -----------------------------------------------------

def retrieve_similar_cases(question):

    embedding = model.encode(question).tolist()

    results = collection.query(
        query_embeddings=[embedding],
        n_results=TOP_K
    )

    retrieved = []

    for doc_id in results["ids"][0]:

        if doc_id in doc_lookup:

            retrieved.append(doc_lookup[doc_id])

    return retrieved

# -----------------------------------------------------
# GraphRAG Retrieval
# -----------------------------------------------------

def graph_rag(question):

    return retrieve_similar_cases(question)

# -----------------------------------------------------
# Build Context
# -----------------------------------------------------

def build_context(docs):

    context = ""

    context += "=" * 80 + "\n"

    context += (
        f"Retrieved the Top {len(docs)} most relevant FIRs "
        f"using semantic search.\n"
    )

    context += (
        "The following investigation summaries are only "
        "the retrieved sample, not the complete database.\n\n"
    )

    for index, doc in enumerate(docs, start=1):

        context += "=" * 80 + "\n"

        context += f"Retrieved Case #{index}\n\n"

        context += f"Crime Number : {doc['crime_no']}\n\n"

        context += "Original FIR Narrative\n\n"

        context += doc["narrative_text"]

        context += "\n\n"

        # ----------------------------------
        # Find CASE node
        # ----------------------------------

        case_id = None

        for entity in doc["linked_entity_ids"]:

            if entity.startswith("CASE_"):

                case_id = entity

                break

        # ----------------------------------
        # Investigation Analysis
        # ----------------------------------

        if case_id is not None:

            analysis = analyze_case(case_id)

            context += build_case_context(analysis)

        context += "\n\n"

    return context

# -----------------------------------------------------
# Main
# -----------------------------------------------------

if __name__ == "__main__":

    question = input("Ask : ")

    docs = graph_rag(question)

    context = build_context(docs)

    print("\n================ CONTEXT ================\n")

    print(context)

    print("\n============== FINAL ANSWER =============\n")

    answer = summarize_graph_result(question, context)

    print(answer)