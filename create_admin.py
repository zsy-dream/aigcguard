import sys
import os

# Add project root to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.repository.user import UserRepository
from app.utils.security import get_password_hash
from app.repository.database import get_connection

def create_admin(username="admin", password="admin123"):
    print(f"--- Setting up Admin: {username} ---")
    
    try:
        existing = UserRepository.get_by_username(username)
        hashed = get_password_hash(password)
        
        if existing:
            print(f"User '{username}' already exists. Promoting to Admin...")
            conn = get_connection()
            cursor = conn.cursor()
            # Update role and password
            cursor.execute("UPDATE users SET role = 'admin', password_hash = ? WHERE username = ?", (hashed, username))
            conn.commit()
            conn.close()
            print(f"Success: User '{username}' is now an Admin (Password updated).")
        else:
            print(f"Creating new Admin user '{username}'...")
            uid = UserRepository.create(username, hashed, role='admin')
            if uid:
                print(f"Success: Admin user '{username}' created.")
            else:
                print("Error: Failed to create user.")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    user = sys.argv[1] if len(sys.argv) > 1 else "admin"
    pwd = sys.argv[2] if len(sys.argv) > 2 else "admin123"
    create_admin(user, pwd)
