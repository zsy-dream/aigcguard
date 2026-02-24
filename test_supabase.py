import os
from dotenv import load_dotenv
from supabase import create_client, Client
import traceback

def test():
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    print(f"URL: {url}")
    print(f"Key starts with: {key[:10] if key else 'None'}...")
    print(f"Service Key starts with: {service_key[:10] if service_key else 'None'}...")
    
    if not url or not key:
        print("Missing credentials")
        return

    try:
        print("\nTesting with SUPABASE_KEY (Anon):")
        sb = create_client(url, key)
        res = sb.table("profiles").select("count", count="exact").limit(1).execute()
        print(f"Success! Record count: {getattr(res, 'count', 'unknown')}")
    except Exception as e:
        print(f"Anon Login Failed: {e}")
        traceback.print_exc()

    if service_key:
        try:
            print("\nTesting with SUPABASE_SERVICE_ROLE_KEY:")
            sb_service = create_client(url, service_key)
            res = sb_service.table("profiles").select("*").limit(5).execute()
            print(f"Success! Found {len(res.data)} profiles.")
            print("Sample profiles:", [p.get("username") for p in res.data])
        except Exception as e:
            print(f"Service Role Login Failed: {e}")
            traceback.print_exc()

if __name__ == "__main__":
    test()
