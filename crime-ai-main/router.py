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
    "station"
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
    Classify the natural language query into exactly one of ["sql", "graph", "hybrid", "forecast", "network"]
    using a single cheap model call.
    """
    try:
        from llm import client
        prompt = f"""
Classify the following natural language query from an investigator into exactly one of these five route categories:
- "forecast" (if it asks for prediction, trend projection, or future caseload estimate)
- "sql" (if it asks for a specific count, average, max, min, calculation, or direct database table values)
- "network" (if it asks about organized crime networks, gangs, criminal rings, crews, syndicates)
- "hybrid" (if it asks about repeat offenders, prior arrest history of individuals, or associates)
- "graph" (if it asks about similar cases, modus operandi connections, case narratives, or semantic searches)

Few-shot examples:
"What is the average age of accused persons in murder cases?" -> sql
"How many burglary cases were reported in Mysuru last month?" -> sql
"Show me the criminal network around Case CASE_541" -> graph
"Who are the repeat offenders in Belagavi district?" -> hybrid
"Predict theft trends for next month in Bengaluru" -> forecast
"Is there an organized crime network operating in Davanagere?" -> network
"What crimes is Liam Chacko associated with?" -> graph

Query: "{question}"

Return exactly one word (either "sql", "graph", "hybrid", "forecast", or "network") and absolutely nothing else.
"""
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        label = response.text.strip().lower().replace('"', '').replace("'", "")
        if label in ["sql", "graph", "hybrid", "forecast", "network"]:
            return label
    except Exception as e:
        print(f"LLM routing failed: {e}. Falling back to keyword router.", file=sys.stderr)
    return None

def route_question(question):
    # Try LLM router first (stretch goal, Fix 1)
    llm_route = route_question_llm(question)
    if llm_route:
        return llm_route

    q = question.lower()

    # 1. Forecast is checked first
    for word in FORECAST_KEYWORDS:
        if word in q:
            return "forecast"

    # 2. Aggregation / Statistical terms check immediately follows Forecast (Fix 1)
    # Aggregation questions must win over relational keywords like 'accused'/'associate' —
    # a question asking for a number should never be answered by narrative retrieval.
    for word in AGGREGATION_KEYWORDS:
        if word in q:
            return "sql"

    # 3. Network route keywords (Fix 2)
    for word in NETWORK_KEYWORDS:
        if word in q:
            return "network"

    # 4. Hybrid keywords
    for word in HYBRID_KEYWORDS:
        if word in q:
            return "hybrid"

    # 5. SQL keywords
    for word in SQL_KEYWORDS:
        if word in q:
            return "sql"

    # 6. Graph keywords
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