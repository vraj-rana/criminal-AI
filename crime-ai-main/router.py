import os
import sys

FORECAST_KEYWORDS = [
    "predict",
    "forecast",
    "next month",
    "expected",
    "trend for"
]

AGGREGATION_KEYWORDS = [
    "average",
    "how many",
    "count",
    "maximum",
    "minimum",
    "sum",
    "total number",
    "percentage",
    "ratio"
]

CHAT_KEYWORDS = [
    "hey",
    "hello",
    "hi",
    "how are you",
    "who are you",
    "what are you doing",
    "what is your name",
    "what you doing",
    "help",
    "good morning",
    "good afternoon",
    "good evening",
    "sup",
    "greet",
    "what can you do",
    "what can u do",
    "what can i do",
    "what is this",
    "capabilities",
    "about",
    "how to use"
]

NETWORK_KEYWORDS = [
    "organized crime",
    "gang",
    "criminal ring",
    "network of",
    "crew",
    "syndicate"
]

GRAPH_KEYWORDS = [
    "similar",
    "network",
    "connected",
    "associate",
    "relationship",
    "cluster",
    "modus",
    "mo",
    "pattern",
    "linked",
    "related",
    "criminal network"
]

SQL_KEYWORDS = [
    "top",
    "highest",
    "lowest",
    "district",
    "station",
    "show",
    "list",
    "find",
    "get",
    "cases",
    "incidents",
    "records",
    "burglary",
    "theft",
    "murder",
    "robbery",
    "extortion",
    "assault",
    "kidnapping",
    "crime group",
    "crime type"
]

HYBRID_KEYWORDS = [
    "repeat offender",
    "repeat offenders",
    "prior cases",
    "history",
    "associate",
    "associates",
    "criminal network",
    "involved",
    "accused",
    "suspect",
    "who committed",
    "who was involved",
    "known associates"
]

def route_question_llm(question):
    """
    Classify the natural language query into exactly one of ["sql", "graph", "hybrid", "forecast", "network", "chat"]
    using our shared robust ask_gemini failover pool.
    """
    try:
        from llm import ask_gemini
        prompt = f"""
Classify the following natural language query from an investigator into exactly one of these six route categories:
- "forecast" (if it asks for prediction, trend projection, or future caseload estimate)
- "sql" (if it asks for a specific count, average, max, min, calculation, or direct database table values)
- "network" (if it asks about organized crime networks, gangs, criminal rings, crews, syndicates)
- "hybrid" (if it asks about repeat offenders, prior arrest history of individuals, or associates)
- "chat" (if it is a greeting, general greeting, hello, or conversational comment not related to crime files)
- "graph" (if it asks about similar cases, modus operandi connections, case narratives, or semantic searches)

Query: "{question}"

Return exactly one word (either "sql", "graph", "hybrid", "forecast", "network", or "chat") and absolutely nothing else.
"""
        response_text = ask_gemini(prompt)
        label = response_text.strip().lower().replace('"', '').replace("'", "")
        if label in ["sql", "graph", "hybrid", "forecast", "network", "chat"]:
            return label
    except Exception as e:
        print("[Router] LLM routing unavailable (Quota). Using keyword fallback.", file=sys.stderr)
    return None

def route_question(question):
    # Bypassed LLM routing to conserve API quota limits (saves 1 API request per query)
    # llm_route = route_question_llm(question)
    # if llm_route:
    #     return llm_route

    q = question.lower().strip()

    # Simple exact greeting match check
    if q in ["hey", "hello", "hi", "sup"]:
        return "chat"

    # 1. Forecast is checked first
    for word in FORECAST_KEYWORDS:
        if word in q:
            return "forecast"

    # 2. Aggregation / Statistical terms check immediately follows Forecast
    for word in AGGREGATION_KEYWORDS:
        if word in q:
            return "sql"

    # 3. Chat / Greeting keywords
    for word in CHAT_KEYWORDS:
        if word in q:
            return "chat"

    # 4. Network route keywords
    for word in NETWORK_KEYWORDS:
        if word in q:
            return "network"

    # 5. Hybrid keywords
    for word in HYBRID_KEYWORDS:
        if word in q:
            return "hybrid"

    # 6. SQL keywords
    for word in SQL_KEYWORDS:
        if word in q:
            return "sql"

    # 7. Graph keywords
    for word in GRAPH_KEYWORDS:
        if word in q:
            return "graph"

    # Default
    return "graph"

if __name__ == "__main__":
    while True:
        try:
            q = input("Question : ")
            if not q:
                break
            print(route_question(q))
        except KeyboardInterrupt:
            break