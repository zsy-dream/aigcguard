import sqlite3
import os
import random
from datetime import datetime, timedelta

def seed_db():
    db_path = 'watermark.db'
    if not os.path.exists(db_path):
        print(f"Database {db_path} not found. Start the backend first to initialize it.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Check if mock data exists
    cursor.execute("SELECT COUNT(*) FROM watermarked_assets")
    if cursor.fetchone()[0] > 0:
        print("Database already has data. Skipping seed.")
        conn.close()
        return

    print("Seeding database with mock data...")

    # 2. Insert Mock Authors
    authors = [('admin', 'DeepMind Lab'), ('user1', 'Creative Studio'), ('user2', 'Indie Artist')]
    cursor.executemany("INSERT OR IGNORE INTO authors (user_id, author_name) VALUES (?, ?)", authors)

    # 3. Insert Mock Assets (Metadata only, no real files)
    # This allows Dashboard to show stats without needing real images
    assets = []
    base_time = datetime.now()
    for i in range(15):
        t = base_time - timedelta(days=random.randint(0, 7), hours=random.randint(0, 23))
        ts_str = t.strftime('%Y%m%d_%H%M%S')
        assets.append((
            'admin', 
            f'demo_asset_{i+1}.jpg', 
            f'mock_fingerprint_{random.randint(1000,9999)}', 
            f'outputs/mock_{i}.jpg', 
            f'uploads/mock_{i}.jpg', 
            ts_str, 
            random.uniform(35.0, 50.0)
        ))
    
    cursor.executemany('''
        INSERT INTO watermarked_assets (user_id, filename, fingerprint, output_path, input_path, timestamp, psnr)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', assets)

    # 4. Insert Mock Infringements
    # Get some asset IDs
    cursor.execute("SELECT id, user_id FROM watermarked_assets LIMIT 5")
    rows = cursor.fetchall()
    infringements = []
    for row in rows:
        infringements.append((
            row[0], 
            f'http://pirate-site.com/images/{random.randint(100,999)}.jpg', 
            random.uniform(85.0, 99.0), 
            row[1]
        ))
    
    cursor.executemany('''
        INSERT INTO infringement_records (asset_id, source_url, similarity, matched_user_id)
        VALUES (?, ?, ?, ?)
    ''', infringements)

    conn.commit()
    print(f"Inserted {len(assets)} assets and {len(infringements)} infringement records.")
    conn.close()

if __name__ == "__main__":
    seed_db()
