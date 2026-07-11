GRAPH_KEYWORDS = [

    "similar",
    "network",
    "connected",
    "associate",
    "relationship",
    "gang",
    "cluster",
    "modus",
    "mo",
    "pattern",
    "linked",
    "related",
    "criminal network"

]

SQL_KEYWORDS = [

    "count",
    "how many",
    "number",
    "average",
    "maximum",
    "minimum",
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
    "gang",
    "involved",
    "accused",
    "suspect",
    "who committed",
    "who was involved",
    "known associates"

]


def route_question(question):

    q = question.lower()

    # -----------------------------
    # Hybrid
    # -----------------------------

    for word in HYBRID_KEYWORDS:

        if word in q:

            return "hybrid"

    # -----------------------------
    # SQL
    # -----------------------------

    for word in SQL_KEYWORDS:

        if word in q:

            return "sql"

    # -----------------------------
    # Graph
    # -----------------------------

    for word in GRAPH_KEYWORDS:

        if word in q:

            return "graph"

    # Default

    return "graph"


if __name__ == "__main__":

    while True:

        q = input("Question : ")

        print(route_question(q))