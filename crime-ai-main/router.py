import os
import sys
import re

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
    "total number",
    "percentage",
    "ratio"
]

CHAT_KEYWORDS = [
    "hey",
    "hello",
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
    "how to use"
]

NETWORK_KEYWORDS = [
    "organized crime",
    "gang",
    "criminal ring",
    "network of",
    "crew",
    "syndicate",
    "criminal network"
]

GRAPH_KEYWORDS = [
    "similar",
    "network",
    "connected",
    "associate",
    "relationship",
    "cluster",
    "modus",
    "pattern",
    "linked",
    "related"
]

SQL_KEYWORDS = [
    "highest",
    "lowest",
    "district",
    "station",
    "show",
    "list",
    "find",
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
    "involved",
    "accused",
    "suspect",
    "who committed",
    "who was involved",
    "known associates"
]

def _has_keyword(q: str, phrase: str) -> bool:
    pattern = r"\b" + r"\s+".join(re.escape(w) for w in phrase.split()) + r"\b"
    return re.search(pattern, q) is not None

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
    q = question.lower().strip()
    if q in ["hey", "hello", "hi", "sup"]:
        return "chat"

    matched_categories = []
    
    categories = [
        ("forecast", FORECAST_KEYWORDS),
        ("network", NETWORK_KEYWORDS),
        ("hybrid", HYBRID_KEYWORDS),
        ("sql", AGGREGATION_KEYWORDS + SQL_KEYWORDS),
        ("chat", CHAT_KEYWORDS),
        ("graph", GRAPH_KEYWORDS)
    ]
    
    for category, keywords in categories:
        if any(_has_keyword(q, w) for w in keywords):
            matched_categories.append(category)

    # Confident single match -> use it directly, no API call
    if len(matched_categories) == 1:
        return matched_categories[0]

    # If multiple matches, handle specific override constraints
    if len(matched_categories) > 1:
        # Override: modus/pattern search should go to graph even if sql keywords are present
        if "graph" in matched_categories:
            if any(w in q for w in ["modus", "pattern", "relationship", "similar"]):
                return "graph"
        # Override: gang/crew/network keyword queries should go to network even if SQL is present
        if "network" in matched_categories:
            if any(w in q for w in ["gang", "criminal network", "organized crime"]):
                return "network"
        # Override: aggregation SQL query should go to sql unless gang/network is mentioned
        if "sql" in matched_categories:
            if any(_has_keyword(q, w) for w in AGGREGATION_KEYWORDS):
                if not any(w in q for w in ["gang", "criminal network", "organized crime"]):
                    return "sql"
                
        specific = [c for c in ["forecast", "network", "hybrid"] if c in matched_categories]
        if len(specific) == 1:
            return specific[0]

    # Ambiguous (0 matches, or multiple conflicting categories) -> ask the LLM once
    llm_route = route_question_llm(question)
    if llm_route:
        # Double check gang override if LLM misclassifies
        if "gang" in q or "criminal network" in q or "organized crime" in q:
            if "network" in matched_categories:
                return "network"
        return llm_route

    # LLM unavailable (quota/offline) -> fall back to first match in priority order, else "graph"
    priority_order = ["forecast", "network", "hybrid", "sql", "chat", "graph"]
    for cat in priority_order:
        if cat in matched_categories:
            return cat

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