from app.utils.supabase import get_supabase_service_client
import json

def check_db():
    sb = get_supabase_service_client()
    if not sb:
        print("Failed to get Supabase client")
        return
    
    print("--- Profiles ---")
    res = sb.table("profiles").select("*").limit(1).execute()
    print(json.dumps(res.data, indent=2, ensure_ascii=False))
    
    print("\n--- Watermarked Assets ---")
    res = sb.table("watermarked_assets").select("*").limit(1).execute()
    print(json.dumps(res.data, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    check_db()
