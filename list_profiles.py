import os
from dotenv import load_dotenv
from supabase import create_client
load_dotenv()
url = os.environ.get("SUPABASE_URL")
service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
sb = create_client(url, service_key)
res = sb.table("profiles").select("id, username").execute()
for p in res.data:
    print(f"ID: {p['id']}, Username: {p['username']}")
