import json

import os

crime_to_case = {}
case_to_crime = {}

_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_dir, "documents.jsonl"), "r", encoding="utf8") as f:

    for line in f:

        doc = json.loads(line)

        crime_to_case[doc["crime_no"]] = doc["doc_id"]
        case_to_crime[doc["doc_id"]] = doc["crime_no"]


def get_case_id(crime_no):
    return crime_to_case.get(crime_no)


def get_crime_no(case_id):
    return case_to_crime.get(case_id)


if __name__ == "__main__":

    print(get_case_id("104510053202600001"))
    print(get_crime_no("CASE_20"))