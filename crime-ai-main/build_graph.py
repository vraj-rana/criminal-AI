import json
import networkx as nx
import pickle

G = nx.Graph()

# ------------------------
# Load entities
# ------------------------

with open("entities.jsonl", "r", encoding="utf8") as f:
    for line in f:
        entity = json.loads(line)

        G.add_node(
            entity["id"],
            **entity
        )

print("Entities loaded:", G.number_of_nodes())

# ------------------------
# Load relationships
# ------------------------

with open("relationships.jsonl", "r", encoding="utf8") as f:
    for line in f:
        relation = json.loads(line)

        G.add_edge(
            relation["source"],
            relation["target"],
            relation=relation["relation_type"]
        )

print("Relationships loaded:", G.number_of_edges())

# ------------------------
# Save graph
# ------------------------

with open("crime_graph.pkl", "wb") as f:
    pickle.dump(G, f)

print("Graph saved successfully!")