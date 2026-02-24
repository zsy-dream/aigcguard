from app.utils.supabase import get_supabase_service_client
import json

def inspect_schema():
    sb = get_supabase_service_client()
    if not sb:
        print("Failed to get Supabase client")
        return
    
    print("--- Inspecting watermarked_assets table ---")
    try:
        # Get one row to see columns
        res = sb.table("watermarked_assets").select("*").limit(1).execute()
        if res.data:
            print("Columns found in existing data:")
            print(json.dumps(res.data[0], indent=2, ensure_ascii=False))
        else:
            print("No data found in watermarked_assets. Trying to fetch column names via RPC or just printing expected columns.")
    except Exception as e:
        print(f"Error inspecting watermarked_assets: {e}")
    
    print("\n--- Inspecting profiles table ---")
    try:
        res = sb.table("profiles").select("*").limit(1).execute()
        if res.data:
            print("Columns found in existing data:")
            print(json.dumps(res.data[0], indent=2, ensure_ascii=False))
        else:
            print("No data found in profiles.")
    except Exception as e:
        print(f"Error inspecting profiles: {e}")

if __name__ == "__main__":
    inspect_schema()
