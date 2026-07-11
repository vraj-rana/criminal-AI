import os
from dotenv import load_dotenv
from google import genai

# -----------------------------------------------------
# Load API Key
# -----------------------------------------------------

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)

# -----------------------------------------------------
# Generic Gemini Call
# -----------------------------------------------------

import time

def ask_gemini(prompt):

    print("=" * 80)
    print("Prompt length:", len(prompt))
    print("=" * 80)

    for i in range(5):

        try:

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt
            )

            return response.text.strip()

        except Exception as e:

            print(f"\nRetry {i+1}/5")
            print(type(e).__name__)
            print(e)

            time.sleep(3)

    raise Exception("Gemini unavailable after multiple retries.")


# -----------------------------------------------------
# SQL Result Summarization
# -----------------------------------------------------

def summarize_sql_result(question, sql, rows):

    prompt = f"""
You are an AI assistant helping users understand SQL query results.

User Question:
{question}

Generated SQL:
{sql}

SQL Result:
{rows}

Instructions:
- Answer the user's question naturally.
- If the result is empty, clearly say that no matching records were found.
- Do not mention SQL unless necessary.
- Keep the answer concise.
"""

    return ask_gemini(prompt)


# -----------------------------------------------------
# GraphRAG Result Summarization
# -----------------------------------------------------

def summarize_graph_result(question, context):

    prompt = f"""
You are an intelligent crime investigation assistant.

User Question:
{question}

Retrieved Context:
{context}

Instructions:
- Answer ONLY using the retrieved context.
- Mention important people, crimes, repeat offenders and patterns if present.
- If there is insufficient information, clearly say so.
- Do NOT invent facts.
- Keep the answer between 4 and 8 sentences.
"""

    return ask_gemini(prompt)


# -----------------------------------------------------
# Hybrid Result Summarization
# -----------------------------------------------------

def summarize_hybrid_result(question, context):

    if not context.strip():

        return "No matching cases were found for the query."

    prompt = f"""
You are an expert crime investigation assistant.

Use ONLY the supplied investigation context.

User Question:
{question}

Investigation Context:
{context}

Instructions:

- Never invent names.
- Never invent locations.
- Never invent crimes.
- If information is missing, explicitly state that.
- Mention repeat offenders.
- Mention recurring associates.
- Mention common crime patterns.
- Mention common police stations if relevant.
- Produce a concise investigation report.

Investigation Report:
"""

    return ask_gemini(prompt)