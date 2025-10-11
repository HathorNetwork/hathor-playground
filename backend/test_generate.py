#!/usr/bin/env python3
"""Quick test for dApp generation"""
import requests
import json

url = "http://localhost:8000/api/ai/generate-dapp"

payload = {
    "description": "Create a simple counter app with increment and decrement buttons",
    "project_id": "test-counter"
}

print("🚀 Testing dApp generation...")
print(f"Description: {payload['description']}")
print()

response = requests.post(url, json=payload)

if response.status_code == 200:
    data = response.json()
    if data.get("success"):
        files = data.get("files", [])
        print(f"✅ Success! Generated {len(files)} files:")
        for file in files:
            print(f"  - {file['path']}")
    else:
        print(f"❌ Error: {data.get('error')}")
else:
    print(f"❌ HTTP Error: {response.status_code}")
    print(response.text)
