import itertools
from collections import Counter
import networkx as nx
from networkx.algorithms.community import greedy_modularity_communities

from graph_utils import G, get_neighbors, get_case_details
from entity_lookup import get_entity, get_name

# ----------------------------------------------------
# Pre-calculate Max Raw Risk Score at Module Load
# ----------------------------------------------------
def _compute_max_raw_risk():
    max_raw = 1.0  # Avoid division by zero
    for node_id in G.nodes():
        if node_id.startswith("PERSON_"):
            neighbors = list(G.neighbors(node_id))
            num_cases = sum(1 for n in neighbors if n.startswith("CASE_"))
            num_associates = sum(1 for n in neighbors if n.startswith("PERSON_"))
            
            info = get_entity(node_id)
            repeat_offender = False
            if info:
                repeat_offender = info.get("attributes", {}).get("is_repeat_offender", False)
                
            raw_score = (num_cases * 2) + (num_associates * 1.5) + (10 if repeat_offender else 0)
            if raw_score > max_raw:
                max_raw = raw_score
    return max_raw

MAX_RAW_RISK = min(_compute_max_raw_risk(), 70.0)
print(f"Calculated MAX_RAW_RISK (capped for normalisation): {MAX_RAW_RISK}")


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

    # ---------------------------------------
    # Risk Score & Band (Fix 3)
    # ---------------------------------------
    raw_score = (
        (analysis["number_of_cases"] * 2) +
        (analysis["number_of_associates"] * 1.5) +
        (10 if analysis["repeat_offender"] else 0)
    )
    analysis["risk_score"] = min(round((raw_score / MAX_RAW_RISK) * 100), 100)
    
    if analysis["risk_score"] < 33:
        analysis["risk_band"] = "Low"
    elif analysis["risk_score"] < 66:
        analysis["risk_band"] = "Medium"
    else:
        analysis["risk_band"] = "High"

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
                    "risk_score": person["risk_score"],
                    "risk_band": person["risk_band"],
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
# Automatic Criminal Network / Gang Detection (Fix 2)
# ----------------------------------------------------

def detect_criminal_clusters(min_shared_cases=3, min_cluster_size=3):
    """
    Community detection on the co-accused subgraph to surface organized crime
    clusters automatically — must NOT read the ground-truth gang_id field;
    detect structure from behavior.
    """
    # 1. Build a subgraph of Person nodes connected by CO_ACCUSED_WITH edges only
    person_nodes = [node for node in G.nodes() if node.startswith("PERSON_")]
    sub_G = nx.Graph()
    sub_G.add_nodes_from(person_nodes)

    for u, v, data in G.edges(data=True):
        if u.startswith("PERSON_") and v.startswith("PERSON_"):
            if data.get("relation") == "CO_ACCUSED_WITH":
                sub_G.add_edge(u, v)

    # 2. Run greedy_modularity_communities community detection
    communities = greedy_modularity_communities(sub_G)
    
    clusters = []
    cluster_counter = 1

    for comm in communities:
        members_list = list(comm)
        size = len(members_list)
        if size < min_cluster_size:
            continue

        # Fetch names for member IDs
        member_names = [get_name(m) for m in members_list]

        # 4. Compute metrics
        total_prior_cases = 0
        distinct_stations = set()
        
        for m in members_list:
            info = get_entity(m)
            is_repeat = False
            if info:
                is_repeat = info.get("attributes", {}).get("is_repeat_offender", False)
            
            # Cases neighbor count
            cases = [n for n in G.neighbors(m) if n.startswith("CASE_")]
            if is_repeat:
                total_prior_cases += len(cases)

            # Police Stations traversed from cases
            for case_id in cases:
                for c_node in G.neighbors(case_id):
                    if c_node.startswith("STATION_"):
                        station_entity = get_entity(c_node)
                        if station_entity:
                            distinct_stations.add(station_entity["attributes"].get("name", c_node))

        # Average pairwise shared cases count
        pair_shared = []
        for m1, m2 in itertools.combinations(members_list, 2):
            cases1 = set(n for n in G.neighbors(m1) if n.startswith("CASE_"))
            cases2 = set(n for n in G.neighbors(m2) if n.startswith("CASE_"))
            pair_shared.append(len(cases1 & cases2))
            
        avg_shared_cases = sum(pair_shared) / len(pair_shared) if pair_shared else 0.0

        clusters.append({
            "cluster_id": cluster_counter,
            "members": member_names,
            "size": size,
            "total_prior_cases": total_prior_cases,
            "distinct_stations": len(distinct_stations),
            "avg_shared_cases": round(avg_shared_cases, 2)
        })
        cluster_counter += 1

    # 5. Return sorted by size descending
    clusters.sort(key=lambda x: x["size"], reverse=True)
    
    # Re-map cluster_id based on sorted position
    for idx, c in enumerate(clusters, start=1):
        c["cluster_id"] = idx

    return clusters


# ----------------------------------------------------
# Test
# ----------------------------------------------------

if __name__ == "__main__":
    from pprint import pprint
    print("\n--- PERSON_1 Analysis ---")
    pprint(analyze_person("PERSON_1"))
    
    print("\n--- Community Detection ---")
    cls = detect_criminal_clusters()
    print(f"Total Clusters Detected: {len(cls)}")
    if cls:
        pprint(cls[0])