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

    # Multi-model pool to handle free-tier daily quota exhaustion
    models_to_try = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
    last_error = None

    for model_name in models_to_try:
        try:
            print(f"Attempting query with model: {model_name}...")
            response = client.models.generate_content(
                model=model_name,
                contents=prompt
            )
            return response.text.strip()
        except Exception as e:
            last_error = e
            print(f"Model {model_name} failed (possibly quota exhausted): {e}")
            # Try next model immediately
            continue

    # If all models in the pool failed, raise error to trigger safety mock fallback
    print(f"All models in fallback pool exhausted. Last error: {last_error}")
    raise last_error

    raise Exception("Gemini unavailable after multiple retries.")


# -----------------------------------------------------
# Helper: Format Conversation History
# -----------------------------------------------------

def format_history(history):
    if not history:
        return ""
    history_str = "\nRecent Conversation History:\n"
    for turn in history:
        role = "User" if turn.get("role") == "user" else "Assistant"
        content = turn.get("content", "")
        history_str += f"{role}: {content}\n"
    return history_str

# -----------------------------------------------------
# Helper: Translate Kannada to English
# -----------------------------------------------------

def translate_to_english(question):
    prompt = f"Translate the following Kannada crime query into clear standard English for database querying. Return ONLY the English translation with no other text. Keep name spellings phonetic. If the text is already in English, return it unchanged:\n{question}"
    try:
        return ask_gemini(prompt)
    except Exception as e:
        print(f"Translation error: {e}. Using original question.")
        return question

# -----------------------------------------------------
# SQL Result Summarization
# -----------------------------------------------------

def summarize_sql_result(question, sql, rows, history=None, language="en"):
    history_str = format_history(history)
    lang_inst = ""
    if language == "kn":
        lang_inst = "\n- IMPORTANT: Respond in Kannada (Kannada) language only. Translate your final answer completely to Kannada."

    prompt = f"""
You are an expert crime data analyst.

{history_str}

User Question:
{question}

Generated SQL:
{sql}

SQL Result:
{rows}

Instructions:
- Summarize the SQL result in a clean, visual, and highly structured manner.
- Keep the overall length moderate (mid-length, under 150 words).
- Use clear headers, bold keywords, and bullet points (e.g. **Total Cases**, **Investigative Breakdown**).
- Do not explain SQL syntax unless relevant. Keep it clean and highly readable.{lang_inst}
"""

    return ask_gemini(prompt)


# -----------------------------------------------------
# GraphRAG Result Summarization
# -----------------------------------------------------

def summarize_graph_result(question, context, history=None, language="en"):
    history_str = format_history(history)
    lang_inst = ""
    if language == "kn":
        lang_inst = "\n- IMPORTANT: Respond in Kannada (Kannada) language only. Translate your final answer completely to Kannada."

    prompt = f"""
You are an expert criminal network intelligence analyst.

{history_str}

User Question:
{question}

Retrieved Context:
{context}

Instructions:
- Summarize the graph associations in a clean, visual, and highly structured format.
- Keep the response mid-length (under 150 words).
- Group key details under clear bold headings (e.g. **Suspect Profile**, **Relational Links**, **Modus Operandi**).
- Use clean bullet points. Avoid wall-of-text paragraphs.{lang_inst}
"""

    return ask_gemini(prompt)


# -----------------------------------------------------
# Hybrid Result Summarization
# -----------------------------------------------------

def summarize_hybrid_result(question, context, history=None, language="en"):
    if not context.strip():
        if language == "kn":
            return "No matching cases were found for the query."
        return "No matching cases were found for the query."

    history_str = format_history(history)
    lang_inst = ""
    if language == "kn":
        lang_inst = "\n- IMPORTANT: Respond in Kannada (Kannada) language only. Translate your final investigation report completely to Kannada."

    prompt = f"""
You are a senior criminal intelligence investigator.

{history_str}

Use ONLY the supplied investigation context.

User Question:
{question}

Investigation Context:
{context}

Instructions:
- Write a clean, visual, and structured mid-length (under 150 words) investigation brief.
- Never invent names or details.
- Use bullet points and bold section headers (e.g. **Key Suspects**, **Case Narrative**, **Next Steps**).
- Ensure the layout is highly readable at a glance. Avoid long paragraphs.{lang_inst}

Investigation Report:
"""

    return ask_gemini(prompt)