import pickle
import networkx as nx

# Load graph once
with open("crime_graph.pkl", "rb") as f:
    G = pickle.load(f)

print("Graph Loaded")
print("Nodes:", G.number_of_nodes())
print("Edges:", G.number_of_edges())


def get_neighbors(node):
    """
    Return all immediate neighbors of a node.
    """

    if node not in G:
        return []

    return list(G.neighbors(node))


def get_two_hop(node):
    """
    Return all nodes within two hops.
    """

    if node not in G:
        return []

    visited = set()

    for neighbor in G.neighbors(node):

        visited.add(neighbor)

        for second_neighbor in G.neighbors(neighbor):
            visited.add(second_neighbor)

    return list(visited)


def node_exists(node):
    """
    Check if a node exists in the graph.
    """

    return node in G


def get_graph():
    """
    Return the loaded graph object.
    """

    return G

def get_case_details(case_id):
    """
    Return all neighbors of a case node.
    """

    if case_id not in G:
        return []

    return list(G.neighbors(case_id))