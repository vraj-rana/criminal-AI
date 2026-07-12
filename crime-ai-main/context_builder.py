# ----------------------------------------------------
# Build Investigation Context for Gemini
# ----------------------------------------------------

def build_case_context(case_analysis):

    context = ""

    context += "=" * 70 + "\n"

    context += f"Case ID : {case_analysis['case']}\n"

    context += f"Crime Type : {case_analysis['crime']}\n"

    context += f"Police Station : {case_analysis['station']}\n"

    if case_analysis["officer"]:

        context += f"Investigating Officer : {case_analysis['officer']}\n"

    context += "\n"

    # ----------------------------------------------------
    # Investigation Summary
    # ----------------------------------------------------

    context += "Investigation Summary\n"

    context += "-" * 70 + "\n"

    context += f"Total Accused : {case_analysis['summary']['total_accused']}\n"

    context += (
        f"Repeat Offenders : "
        f"{case_analysis['summary']['repeat_offenders']}\n"
    )

    context += (
        f"Total Prior Cases : "
        f"{case_analysis['summary']['total_prior_cases']}\n"
    )

    context += "\n"

    # ----------------------------------------------------
    # Associate Analysis
    # ----------------------------------------------------

    if case_analysis["associate_pairs"]:

        context += "Known Associate Pairs\n"

        context += "-" * 70 + "\n"

        for pair in case_analysis["associate_pairs"]:

            context += (
                f"{pair['person1']} ↔ "
                f"{pair['person2']} "
                f"(Shared Cases : {pair['shared_cases']})\n"
            )

        context += "\n"

    # ----------------------------------------------------
    # Accused Details
    # ----------------------------------------------------

    context += "Accused Persons\n"

    context += "-" * 70 + "\n"

    for person in case_analysis["persons"]:

        context += f"Name : {person['name']}\n"

        context += f"Age : {person['age']}\n"

        context += f"Gender : {person['gender']}\n"

        context += (
            f"Repeat Offender : "
            f"{'Yes' if person['repeat_offender'] else 'No'}\n"
        )

        context += f"Prior Cases : {person['prior_cases']}\n"

        context += (
            f"Known Associates : "
            f"{person['known_associates']}\n"
        )
        if "risk_score" in person:
            context += f"Risk Score : {person['risk_score']} ({person['risk_band']})\n"

        context += "\n"

    return context


# ----------------------------------------------------
# Test
# ----------------------------------------------------

if __name__ == "__main__":

    from graph_analysis import analyze_case

    analysis = analyze_case("CASE_6622")

    context = build_case_context(analysis)

    print(context)