from router import route_question

# ---------------- SQL ----------------

from sql_agent import english_to_sql
from database import run_sql
from llm import summarize_sql_result

# ---------------- Graph ----------------

from graph_agent import graph_rag
from graph_agent import build_context
from llm import summarize_graph_result


while True:

    question = input("\nAsk : ")

    route = route_question(question)

    print("\nChosen Route :", route)

    # ==========================================
    # SQL
    # ==========================================

    if route == "sql":

        try:

            sql = english_to_sql(question)

            print("\nGenerated SQL\n")
            print(sql)

            rows = run_sql(sql)

            print("\nSQL Results\n")

            for row in rows:
                print(row)

            answer = summarize_sql_result(
                question,
                sql,
                rows
            )

            print("\nFinal Answer\n")
            print(answer)

        except Exception as e:

            print(e)

    # ==========================================
    # GraphRAG
    # ==========================================

    elif route == "graph":

        docs = graph_rag(question)

        context = build_context(docs)

        print("\nRetrieved Context\n")
        print(context)

        answer = summarize_graph_result(
            question,
            context
        )

        print("\nFinal Answer\n")
        print(answer)

    # ==========================================
    # Hybrid
    # ==========================================

    else:

        print("Hybrid pipeline coming next...")