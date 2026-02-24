import os
from dotenv import load_dotenv
from supabase import create_client
load_dotenv()
url = os.environ.get("SUPABASE_URL")
service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
sb = create_client(url, service_key)
res = sb.table("watermarked_assets").select("*").order("created_at", desc=True).limit(5).execute()
for a in res.data:
    print(f"ID: {a['id']}, Filename: {a['filename']}, UserID: {a['user_id']}")
