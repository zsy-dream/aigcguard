import os
from dotenv import load_dotenv
from supabase import create_client, Client

def check_admin():
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not url or not service_key:
        print("Missing credentials")
        return

    sb_service = create_client(url, service_key)
    res = sb_service.table("profiles").select("*").eq("username", "zsypioneer@snapguard.com").single().execute()
    
    if res.data:
        p = res.data
        print(f"--- Profile Details for {p.get('username')} ---")
        print(f"Role: {p.get('role')}")
        print(f"Plan: {p.get('plan')}")
        print(f"Quota Total: {p.get('quota_total')}")
        print(f"Display Name: {p.get('display_name')}")
    else:
        print("User not found")

if __name__ == "__main__":
    check_admin()
