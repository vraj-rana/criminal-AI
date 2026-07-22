import json
import chromadb
from sentence_transformers import SentenceTransformer

# Load embedding model (downloads once)
model = SentenceTransformer("all-MiniLM-L6-v2")

# Create persistent Chroma database
client = chromadb.PersistentClient(path="./chromadb")

collection = client.get_or_create_collection(
    name="crime_documents"
)

with open("documents.jsonl", "r", encoding="utf8") as f:

    for i, line in enumerate(f):

        doc = json.loads(line)

        document = doc["narrative_text"]

        embedding = model.encode(document).tolist()

        collection.add(
            ids=[doc["doc_id"]],
            embeddings=[embedding],
            documents=[document]
        )

        if i % 500 == 0:
            print(f"{i} documents indexed")

print("Done!")