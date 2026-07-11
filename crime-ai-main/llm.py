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
        lang_inst = "\n- IMPORTANT: Respond in Kannada (ಕನ್ನಡ) language only. Translate your final answer completely to Kannada."

    prompt = f"""
You are an expert AI intelligence analyst helping users understand SQL query results.

{history_str}

User Question:
{question}

Generated SQL:
{sql}

SQL Result:
{rows}

Instructions:
- Provide a detailed and thorough analysis of the SQL query results.
- Break down any numbers or counts, and list key statistical details.
- Explain the significance of the result records in a structured manner.
- Do not mention SQL syntax unless necessary.
- Provide a detailed, multi-paragraph report.{lang_inst}
"""

    return ask_gemini(prompt)


# -----------------------------------------------------
# GraphRAG Result Summarization
# -----------------------------------------------------

def summarize_graph_result(question, context, history=None, language="en"):
    history_str = format_history(history)
    lang_inst = ""
    if language == "kn":
        lang_inst = "\n- IMPORTANT: Respond in Kannada (ಕನ್ನಡ) language only. Translate your final answer completely to Kannada."

    prompt = f"""
You are an intelligent criminal investigation network analyst.

{history_str}

User Question:
{question}

Retrieved Context:
{context}

Instructions:
- Provide a detailed intelligence summary of the crime graph connections.
- List all important people, case IDs, crimes, repeat offenders, and relational patterns.
- Do NOT invent facts. Explain the relationships in a highly structured, comprehensive manner.
- Provide a detailed, multi-paragraph report.{lang_inst}
"""

    return ask_gemini(prompt)


# -----------------------------------------------------
# Hybrid Result Summarization
# -----------------------------------------------------

def summarize_hybrid_result(question, context, history=None, language="en"):
    if not context.strip():
        if language == "kn":
            return "ಪ್ರಶ್ನೆಗೆ ಹೊಂದಿಕೆಯಾಗುವ ಯಾವುದೇ ಪ್ರಕರಣಗಳು ಕಂಡುಬಂದಿಲ್ಲ."
        return "No matching cases were found for the query."

    history_str = format_history(history)
    lang_inst = ""
    if language == "kn":
        lang_inst = "\n- IMPORTANT: Respond in Kannada (ಕನ್ನಡ) language only. Translate your final investigation report completely to Kannada."

    prompt = f"""
You are a senior criminal intelligence investigator.

{history_str}

Use ONLY the supplied investigation context.

User Question:
{question}

Investigation Context:
{context}

Instructions:
- Never invent names, locations, or crimes.
- Detail the history, suspect relations, and patterns in a thorough manner.
- Highlight repeat offenders, recurring associates, common crime patterns, and local police station jurisdictions.
- Produce a detailed, structured, multi-paragraph investigation report.{lang_inst}

Investigation Report:
"""

    return ask_gemini(prompt)