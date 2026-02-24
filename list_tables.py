from app.utils.supabase import get_supabase_service_client

def list_tables():
    sb = get_supabase_service_client()
    # Supabase Python client doesn't have a direct list_tables, but we can try to query common tables
    tables = ["profiles", "简介", "watermarked_assets", "水印资产", "watermarked_assets_enhanced"]
    for t in tables:
        try:
            res = sb.table(t).select("count").execute()
            print(f"Table '{t}' exists and has records.")
        except Exception as e:
            print(f"Table '{t}' does not exist or error: {e}")

if __name__ == "__main__":
    list_tables()
