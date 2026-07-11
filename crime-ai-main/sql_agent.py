from llm import ask_gemini

# -----------------------------------------------------
# Load Database Schema
# -----------------------------------------------------

with open("Schema_AI.txt", "r", encoding="utf-16") as f:
    schema = f.read()


# -----------------------------------------------------
# Prompt Builder
# -----------------------------------------------------

def build_prompt(question, mode):

    prompt = f"""
You are an expert SQLite database engineer.

Database Schema:
{schema}

Your task is to convert the user's question into ONE valid SQLite query.

Rules:

1. Return ONLY the SQL query.
2. Never use markdown.
3. Never explain anything.
4. Use ONLY tables and columns present in the schema.
5. Prefer CrimeHead / CrimeSubHead tables for crime-type filtering.
6. Use CaseCategory ONLY for FIR, NCR, PAR etc. Never use it for crime names.
7. Use proper JOINs whenever required.
8. If the question cannot be answered using the schema, return exactly:

CANNOT_GENERATE_SQL

==================================================

IMPORTANT SCHEMA NOTES

• Police stations are stored in the Unit table.
• CaseMaster.PoliceStationID references Unit.UnitID.
• Whenever the user asks about police stations, ALWAYS use the Unit table.
• Never use District when the user asks about police stations.
• Use District only when the user explicitly asks about districts.
• Crime names are stored in CrimeSubHead.CrimeHeadName.
• Crime groups are stored in CrimeHead.CrimeGroupName.
• Repeat offenders are identified using PersonIdentity.IsRepeatOffender.
• Never use GangID in any generated SQL query.

==================================================
Example 1

Question:
Show motor vehicle theft cases

SQL:

SELECT
    CM.CrimeNo,
    CM.CaseNo,
    CM.CrimeRegisteredDate,
    CS.CrimeHeadName,
    CM.BriefFacts
FROM CaseMaster CM
JOIN CrimeSubHead CS
ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID
WHERE CS.CrimeHeadName LIKE '%Motor Vehicle Theft%';

==================================================
Example 2

Question:
How many murder cases occurred?

SQL:

SELECT COUNT(*)
FROM CaseMaster CM
JOIN CrimeSubHead CS
ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID
WHERE CS.CrimeHeadName LIKE '%Murder%';

==================================================
Example 3

Question:
Top 10 police stations by FIR count

SQL:

SELECT
    U.UnitName,
    COUNT(*) AS TotalCases
FROM CaseMaster CM
JOIN Unit U
ON CM.PoliceStationID = U.UnitID
GROUP BY
    U.UnitName
ORDER BY
    TotalCases DESC
LIMIT 10;

==================================================
Example 4

Question:
Show theft cases in Bengaluru

SQL:

SELECT
    CM.CrimeNo,
    CM.CaseNo,
    U.UnitName,
    CS.CrimeHeadName,
    CM.BriefFacts
FROM CaseMaster CM
JOIN CrimeSubHead CS
ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID
JOIN Unit U
ON CM.PoliceStationID = U.UnitID
WHERE
CS.CrimeHeadName LIKE '%Theft%'
AND U.UnitName LIKE '%Bengaluru%';

==================================================
Example 5

Question:
Show repeat offenders involved in robbery

SQL:

SELECT DISTINCT
    PI.FullName,
    PI.AgeYear,
    PI.GenderID
FROM Accused A
JOIN PersonIdentity PI
ON A.PersonIdentityID = PI.PersonIdentityID
JOIN CaseMaster CM
ON A.CaseMasterID = CM.CaseMasterID
JOIN CrimeSubHead CS
ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID
WHERE
PI.IsRepeatOffender = 1
AND CS.CrimeHeadName LIKE '%Robbery%';

==================================================

User Question:

{question}
"""

    if mode == "hybrid":

        prompt += """

==================================================

IMPORTANT FOR HYBRID MODE

This SQL will be used for graph traversal.

Therefore:

• ALWAYS include CM.CrimeNo as the FIRST selected column.
• NEVER omit CM.CrimeNo.
• Return CM.CrimeNo before every other selected column.
• If using DISTINCT, write:

SELECT DISTINCT
    CM.CrimeNo,
    ...

Examples:

Question:
Show repeat offenders involved in motor vehicle theft

Correct SQL:

SELECT DISTINCT
    CM.CrimeNo,
    PI.FullName,
    PI.AgeYear,
    PI.GenderID
FROM Accused A
JOIN CaseMaster CM
ON A.CaseMasterID = CM.CaseMasterID
JOIN CrimeSubHead CS
ON CM.CrimeMinorHeadID = CS.CrimeSubHeadID
JOIN PersonIdentity PI
ON A.PersonIdentityID = PI.PersonIdentityID
WHERE
CS.CrimeHeadName LIKE '%Motor Vehicle Theft%'
AND PI.IsRepeatOffender = 1;

Remember:

CM.CrimeNo MUST be the FIRST selected column.
"""

    return prompt


# -----------------------------------------------------
# English -> SQL
# -----------------------------------------------------

def english_to_sql(question, mode="sql"):

    prompt = build_prompt(question, mode)

    sql = ask_gemini(prompt)

    # ---------------------------------------------
    # Clean Output
    # ---------------------------------------------

    sql = sql.replace("```sql", "")
    sql = sql.replace("```sqlite", "")
    sql = sql.replace("```", "")
    sql = sql.strip()

    if sql.upper().startswith("SQL"):
        sql = sql[3:].strip(":").strip()

    # ---------------------------------------------
    # Validation
    # ---------------------------------------------

    if sql == "CANNOT_GENERATE_SQL":
        raise ValueError("Gemini could not generate SQL.")

    if mode == "hybrid":

        sql_upper = sql.upper()

        select_pos = sql_upper.find("SELECT")
        from_pos = sql_upper.find("FROM")

        if select_pos == -1 or from_pos == -1:
            raise ValueError("Generated SQL is invalid.")

        select_clause = sql_upper[select_pos:from_pos]

        # Retry once if CrimeNo is missing
        if "CM.CRIMENO" not in select_clause:

            print("Hybrid SQL missing CrimeNo. Regenerating...")

            prompt += """

IMPORTANT

You forgot to include CM.CrimeNo.

Regenerate the SQL.

CM.CrimeNo MUST be the FIRST selected column.
"""

            sql = ask_gemini(prompt)

            sql = sql.replace("```sql", "")
            sql = sql.replace("```sqlite", "")
            sql = sql.replace("```", "")
            sql = sql.strip()

            sql_upper = sql.upper()

            select_pos = sql_upper.find("SELECT")
            from_pos = sql_upper.find("FROM")

            if select_pos == -1 or from_pos == -1:
                raise ValueError("Generated SQL is invalid.")

            select_clause = sql_upper[select_pos:from_pos]

            if "CM.CRIMENO" not in select_clause:
                raise ValueError(
                    "Hybrid SQL still does not contain CM.CrimeNo."
                )

    return sql


if __name__ == "__main__":

    question = input("Ask: ")

    sql = english_to_sql(question)

    print("\nGenerated SQL:\n")
    print(sql)