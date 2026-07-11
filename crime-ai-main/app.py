from sql_agent import english_to_sql
from database import run_sql
from llm import summarize_sql_result

question = input("Ask: ")

sql = english_to_sql(question)

print("\nGenerated SQL:\n")
print(sql)

rows = run_sql(sql)

print("\nResults:\n")
for row in rows:
    print(row)

print("\nFinal Answer:\n")
answer = summarize_sql_result(question, sql, rows)
print(answer)