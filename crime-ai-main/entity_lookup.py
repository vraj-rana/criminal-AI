import json

import os

entity_lookup = {}

_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_dir, "entities.jsonl"), "r", encoding="utf8") as f:

    for line in f:

        entity = json.loads(line)

        entity_lookup[entity["id"]] = entity


def get_entity(entity_id):
    return entity_lookup.get(entity_id)


def get_name(entity_id):

    entity = entity_lookup.get(entity_id)

    if entity is None:
        return entity_id

    return entity["attributes"].get("name", entity_id)


def get_type(entity_id):

    entity = entity_lookup.get(entity_id)

    if entity is None:
        return "Unknown"

    return entity["type"]