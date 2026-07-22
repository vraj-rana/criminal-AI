from router import route_question

cases = {
    "What is Ramesh Kumar's criminal history?": {"hybrid", "graph"},
    "How many gang members are active in Mysuru district?": {"network"},
    "Show me all burglary cases reported in Mandya last month": {"sql"},
    "Is there a criminal network operating in Bengaluru?": {"network"},
    "Predict the crime hotspots for next month in Mysuru": {"forecast"},
    "What is the average age of accused persons in theft cases?": {"sql"},
    "Tell me about common modus operandi in robbery cases": {"graph"},
    "List repeat offenders linked to Hebbal police station": {"hybrid"},
    "Who are the associates of the accused in KA-19-2026-00456?": {"hybrid"},
    "Good morning, what can this platform do?": {"chat"},
}

passed_count = 0
for q, allowed in cases.items():
    got = route_question(q)
    assert got in allowed, f"FAIL: '{q}' -> {got}, expected one of {allowed}"
    print(f"PASS: '{q}' -> {got}")
    passed_count += 1

print(f"\nAll {passed_count} router tests passed successfully.")
