import httpx

def test_embed():
    url = "http://localhost:8000/api/embed"
    # Note: Replace with a real token if possible, but testing without should hit guest or fail auth
    # For a real test, we need the token from the user context, but I can't get that easily.
    # I'll try to use the credentials from .env to sign a mock token or just test the guest flow.
    
    files = {'image': ('test.jpg', b'dummy content', 'image/jpeg')}
    data = {'strength': '0.1', 'author_name': 'Test'}
    
    try:
        response = httpx.post(url, data=data, files=files, timeout=30.0)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_embed()
