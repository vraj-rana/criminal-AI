import os
import time
import sys
from dotenv import load_dotenv
from google import genai

# -----------------------------------------------------
# Lazy Client Loader
# -----------------------------------------------------

load_dotenv()

_client = None

def get_client():
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("No GEMINI_API_KEY found in the environment configurations.")
        _client = genai.Client(api_key=api_key)
    return _client

# -----------------------------------------------------
# Generic Gemini Call (Fix Quota Failover)
# -----------------------------------------------------

def ask_gemini(prompt):
    print("=" * 80)
    print("Prompt length:", len(prompt))
    print("=" * 80)

    # Multi-model pool to handle free-tier daily quota exhaustion
    # Prioritize 2.0-flash and 1.5-flash (gemini-flash-latest) because they offer
    # 1,500 requests per day on free tier, unlike 2.5 models which are capped at 20 RPD.
    models_to_try = [
        "gemini-2.0-flash",
        "gemini-flash-latest",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-pro-latest"
    ]
    last_error = None

    for model_name in models_to_try:
        try:
            print(f"Attempting query with model: {model_name}...")
            client = get_client()
            response = client.models.generate_content(
                model=model_name,
                contents=prompt
            )
            return response.text.strip()
        except Exception as e:
            last_error = e
            print(f"Model {model_name} not available (quota/auth check).", file=sys.stderr)
            continue

    print(f"All models in fallback pool exhausted. Last error: {last_error}", file=sys.stderr)
    raise last_error

# -----------------------------------------------------
# Translation Helpers
# -----------------------------------------------------

def translate_to_english(text):
    prompt = f"""
Translate the following Kannada text into plain English. 
Return ONLY the English translation, no other conversational filler.

Text to translate:
{text}
"""
    return ask_gemini(prompt)

# -----------------------------------------------------
# History Formatter
# -----------------------------------------------------

def format_history(history):
    if not history:
        return ""
    
    formatted = "Conversation History Context:\n"
    for turn in history:
        role_label = "Investigator" if turn.get("role") == "user" else "Assistant"
        formatted += f"{role_label}: {turn.get('content')}\n"
    formatted += "\n"
    return formatted

# -----------------------------------------------------
# Structured Prompt Template Builder
# -----------------------------------------------------

STRUCTURED_INSTRUCTIONS = """
Your response MUST strictly follow this exact Markdown format. Do not wrap the entire response in a code fence:

**Summary:** <one or two sentence plain-language answer>

**Key Findings:**
- **[Name of Suspect / Case ID / Metric Category]**: <specific details about this category, with critical metrics/numbers explicitly **bolded**>
- **[Next Suspect / Next Category]**: <details with critical metrics/numbers explicitly **bolded**>
- Up to 4 structured bullets max. Do not write generic sentences without stats/counts.

**Investigative Leads:**
- <1-2 concrete action items for next steps, e.g. checking specific phone logs, interviewing associates, or auditing financial transaction flows>

**Chronological Timeline:** (Include only if case dates/incident dates are present in the context, otherwise omit this section entirely)
- **[YYYY-MM-DD]**: <Brief description of crime or arrest event>

Rules:
- Be professional, concise, and actionable. Keep the total word count under 280 words.
- Do not repeat the user's question back. Do not write a closing summary paragraph.
- Every claim must carry its number, percentage, count, name, or metric inline. Do not use generic phrases.
"""

KANNADA_STRUCTURED_INSTRUCTIONS = """
Your response MUST strictly follow this exact Kannada Markdown format. Do not wrap the entire response in a code fence:

**ಸಾರಾಂಶ:** <ಒಂದು ಅಥವಾ ಎರಡು ವಾಕ್ಯಗಳಲ್ಲಿ ಸರಳ ಉತ್ತರ>

**ಮುಖ್ಯಾಂಶಗಳು:**
- **[ಆರೋಪಿಯ ಹೆಸರು / ಪ್ರಕರಣ ಸಂಖ್ಯೆ / ವರ್ಗ]**: <ನಿರ್ದಿಷ್ಟ ವಿವರಗಳು, ಮುಖ್ಯ ಸಂಖ್ಯೆಗಳು ಮತ್ತು ಹೆಸರುಗಳನ್ನು **ದಪ್ಪ ಅಕ್ಷರಗಳಲ್ಲಿ (bold)** ಬರೆಯಿರಿ>
- **[ಮುಂದಿನ ಆರೋಪಿ / ಮುಂದಿನ ಪ್ರಕರಣ]**: <ವಿವರಗಳು, ಮುಖ್ಯ ಸಂಖ್ಯೆಗಳನ್ನು **ದಪ್ಪ ಅಕ್ಷರಗಳಲ್ಲಿ (bold)** ಬರೆಯಿರಿ>
- ಗರಿಷ್ಠ 4 ಬುಲೆಟ್‌ಗಳು ಮಾತ್ರ.

**ತನಿಖಾ ಸುಳಿವುಗಳು:**
- <1-2 ಪ್ರಮುಖ ತನಿಖಾ ಹೆಜ್ಜೆಗಳು, ಉದಾಹರಣೆಗೆ ಸಹಚರರನ್ನು ವಿಚಾರಣೆ ಮಾಡುವುದು ಅಥವಾ ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆಯನ್ನು ಪರಿಶೀಲಿಸುವುದು>

**ಕಾಲಾನುಕ್ರಮದ ದಾಖಲೆ:** (ಪ್ರಕರಣದ ದಿನಾಂಕಗಳು ಲಭ್ಯವಿದ್ದರೆ ಮಾತ್ರ ಈ ವಿಭಾಗವನ್ನು ಸೇರಿಸಿ, ಇಲ್ಲದಿದ್ದರೆ ಇದನ್ನು ಸಂಪೂರ್ಣವಾಗಿ ಬಿಟ್ಟುಬಿಡಿ)
- **[ವರ್ಷ-ತಿಂಗಳು-ದಿನಾಂಕ]**: <ಸಣ್ಣ ವಿವರಣೆ>

Rules:
- Keep the total word count under 280 words.
- Respond completely in Kannada.
- Every claim must carry its number, percentage, count, name, or metric inline.
"""

# -----------------------------------------------------
# SQL Result Summarization
# -----------------------------------------------------

def summarize_sql_result(question, sql, rows, history=None, language="en"):
    history_str = format_history(history)
    struct_inst = KANNADA_STRUCTURED_INSTRUCTIONS if language == "kn" else STRUCTURED_INSTRUCTIONS

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
{struct_inst}
"""

    return ask_gemini(prompt)

# -----------------------------------------------------
# GraphRAG Result Summarization
# -----------------------------------------------------

def summarize_graph_result(question, context, history=None, language="en"):
    history_str = format_history(history)
    struct_inst = KANNADA_STRUCTURED_INSTRUCTIONS if language == "kn" else STRUCTURED_INSTRUCTIONS

    prompt = f"""
You are an expert criminal network intelligence analyst.

{history_str}

User Question:
{question}

Retrieved Context:
{context}

Instructions:
{struct_inst}
"""

    return ask_gemini(prompt)

# -----------------------------------------------------
# Hybrid Result Summarization
# -----------------------------------------------------

def summarize_hybrid_result(question, context, history=None, language="en"):
    if not context.strip():
        if language == "kn":
            return "**ಸಾರಾಂಶ:** ಪ್ರಕರಣ ಕಂಡುಬಂದಿಲ್ಲ."
        return "**Summary:** No matching cases were found."

    history_str = format_history(history)
    struct_inst = KANNADA_STRUCTURED_INSTRUCTIONS if language == "kn" else STRUCTURED_INSTRUCTIONS

    prompt = f"""
You are a senior criminal intelligence investigator.

{history_str}

Use ONLY the supplied investigation context.

User Question:
{question}

Investigation Context:
{context}

Instructions:
{struct_inst}
"""

    return ask_gemini(prompt)

# -----------------------------------------------------
# Network Result Summarization (Fix 2)
# -----------------------------------------------------

def summarize_network_result(question, context, history=None, language="en"):
    history_str = format_history(history)
    struct_inst = KANNADA_STRUCTURED_INSTRUCTIONS if language == "kn" else STRUCTURED_INSTRUCTIONS

    prompt = f"""
You are a senior analyst mapping organized crime communities and gangs.

{history_str}

User Question:
{question}

Community Detection Clusters Context:
{context}

Instructions:
{struct_inst}
- Cite specific cluster numbers, counts of members, distinct stations, and prior cases.
"""

    return ask_gemini(prompt)