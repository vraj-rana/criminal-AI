from collections import Counter

from graph_utils import get_neighbors, get_case_details
from entity_lookup import get_entity


# ----------------------------------------------------
# Analyze one PERSON
# ----------------------------------------------------

def analyze_person(person_id):

    info = get_entity(person_id)

    if info is None:
        return None

    attrs = info["attributes"]

    analysis = {
        "name": attrs.get("name", person_id),
        "age": attrs.get("age"),
        "gender": attrs.get("gender"),
        "repeat_offender": attrs.get("is_repeat_offender", False),

        # Internal only. Never expose to Gemini.
        "gang": attrs.get("gang_id"),

        "cases": [],
        "crime_types": [],
        "stations": [],
        "associates": []
    }

    # ---------------------------------------
    # First-hop neighbours
    # ---------------------------------------

    neighbors = get_neighbors(person_id)

    for node in neighbors:

        if node.startswith("CASE_"):

            analysis["cases"].append(node)

        elif node.startswith("PERSON_"):

            associate = get_entity(node)

            if associate:

                analysis["associates"].append(
                    associate["attributes"].get("name", node)
                )

    # ---------------------------------------
    # Traverse all connected cases
    # ---------------------------------------

    for case in analysis["cases"]:

        case_nodes = get_case_details(case)

        for node in case_nodes:

            if node.startswith("CRIME_"):

                crime = get_entity(node)

                if crime:

                    analysis["crime_types"].append(
                        crime["attributes"].get("name", node)
                    )

            elif node.startswith("STATION_"):

                station = get_entity(node)

                if station:

                    analysis["stations"].append(
                        station["attributes"].get("name", node)
                    )

    # ---------------------------------------
    # Remove duplicates
    # ---------------------------------------

    analysis["crime_types"] = list(set(analysis["crime_types"]))
    analysis["stations"] = list(set(analysis["stations"]))
    analysis["associates"] = list(set(analysis["associates"]))

    # ---------------------------------------
    # Statistics
    # ---------------------------------------

    analysis["number_of_cases"] = len(analysis["cases"])
    analysis["number_of_associates"] = len(analysis["associates"])

    crime_counter = Counter(analysis["crime_types"])
    station_counter = Counter(analysis["stations"])

    analysis["top_crimes"] = crime_counter.most_common(3)
    analysis["top_stations"] = station_counter.most_common(3)

    return analysis


# ----------------------------------------------------
# Analyze one CASE
# ----------------------------------------------------

def analyze_case(case_id):

    analysis = {

        "case": case_id,

        "crime": None,

        "station": None,

        "officer": None,

        "persons": [],

        "total_accused": 0,

        "repeat_offenders": [],

        "repeat_offender_count": 0,

        "total_prior_cases": 0,

        "associate_pairs": [],

        "summary": {}
    }

    neighbors = get_case_details(case_id)

    # ---------------------------------------
    # Read case information
    # ---------------------------------------

    for node in neighbors:

        if node.startswith("CRIME_"):

            crime = get_entity(node)

            if crime:

                analysis["crime"] = crime["attributes"].get("name")

        elif node.startswith("STATION_"):

            station = get_entity(node)

            if station:

                analysis["station"] = station["attributes"].get("name")

        elif node.startswith("OFFICER_"):

            officer = get_entity(node)

            if officer:

                analysis["officer"] = officer["attributes"].get("name")

        elif node.startswith("PERSON_"):

            person = analyze_person(node)

            if person:

                analysis["persons"].append({

                    "name": person["name"],

                    "age": person["age"],

                    "gender": person["gender"],

                    "repeat_offender": person["repeat_offender"],

                    "prior_cases": person["number_of_cases"],

                    "known_associates": person["number_of_associates"],

                    # Internal field for graph computation
                    "_cases": person["cases"]

                })

    # ---------------------------------------
    # Investigation statistics
    # ---------------------------------------

    analysis["total_accused"] = len(analysis["persons"])

    for person in analysis["persons"]:

        if person["repeat_offender"]:

            analysis["repeat_offenders"].append(
                person["name"]
            )

        analysis["total_prior_cases"] += person["prior_cases"]

    analysis["repeat_offender_count"] = len(
        analysis["repeat_offenders"]
    )

    # ---------------------------------------
    # Associate Pair Analysis
    # ---------------------------------------

    people = analysis["persons"]

    for i in range(len(people)):

        for j in range(i + 1, len(people)):

            p1 = people[i]
            p2 = people[j]

            shared_cases = len(
                set(p1["_cases"]) &
                set(p2["_cases"])
            )

            analysis["associate_pairs"].append({

                "person1": p1["name"],

                "person2": p2["name"],

                "shared_cases": shared_cases

            })

    # Remove temporary field

    for person in analysis["persons"]:

        person.pop("_cases")

    # ---------------------------------------
    # Investigation Summary
    # ---------------------------------------

    analysis["summary"] = {

        "crime_type": analysis["crime"],

        "police_station": analysis["station"],

        "total_accused": analysis["total_accused"],

        "repeat_offenders": analysis["repeat_offender_count"],

        "total_prior_cases": analysis["total_prior_cases"]

    }

    return analysis


# ----------------------------------------------------
# Test
# ----------------------------------------------------

if __name__ == "__main__":

    from pprint import pprint

    pprint(analyze_case("CASE_6622"))