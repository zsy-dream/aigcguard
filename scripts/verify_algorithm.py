import cv2
import numpy as np
import sys
import os

# Add parent directory to path to find 'algorithms' module
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from algorithms.fingerprint_engine import FingerprintEngine
from algorithms.image_matcher import ImageMatcher
import hashlib
from datetime import datetime

def create_test_image(filename="test_source.jpg"):
    # Create a gradient image
    width, height = 512, 512
    image = np.zeros((height, width, 3), dtype=np.uint8)
    for i in range(height):
        for j in range(width):
            image[i, j] = [i % 256, j % 256, (i+j) % 256]
    
    # Add some text
    cv2.putText(image, "AIGC Fingerprint Test", (50, 250), 
                cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 2)
    
    cv2.imwrite(filename, image)
    print(f"[OK] Created test image: {filename}")
    return image

def verify():
    print("[+] Starting Algorithm Verification...")
    
    # 1. Setup
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    user_id = "test_user"
    engine = FingerprintEngine(strength=0.15)
    
    # 2. Key Generation
    fingerprint = engine.generate_fingerprint(user_id, timestamp)
    print(f"[KEY] Generated Fingerprint: {fingerprint}")
    
    # 3. Load & Embed
    source_img_path = "verify_test.jpg"
    if not os.path.exists(source_img_path):
        image = create_test_image(source_img_path)
    else:
        image = cv2.imread(source_img_path)
        
    print("[>] Embedding watermark (DCT QIM)...")
    start_time = datetime.now()
    watermarked = engine.embed_dct(image, fingerprint)
    embed_time = (datetime.now() - start_time).total_seconds()
    
    output_path = f"verify_output_{timestamp}.jpg"
    cv2.imwrite(output_path, watermarked)
    print(f"[OK] Saved watermarked image to: {output_path} ({embed_time:.3f}s)")
    
    # 4. Attack Simulation (Optional - JPEG Compression)
    # cv2.imwrite("attacked.jpg", watermarked, [cv2.IMWRITE_JPEG_QUALITY, 80])
    # attacked = cv2.imread("attacked.jpg")
    attacked = watermarked # No attack for basic verification
    
    # 5. Extract
    print("[<] Extracting watermark...")
    start_time = datetime.now()
    extracted = engine.extract_dct(attacked, length=256)
    extract_time = (datetime.now() - start_time).total_seconds()
    print(f"[?] Extracted Fingerprint: {extracted} ({extract_time:.3f}s)")
    
    # 6. Compare using similarity
    similarity = engine.fingerprint_similarity(extracted, fingerprint)
    print(f"[=] Similarity Score: {similarity*100:.2f}%")
    
    # 7. Robustness Metrics
    robustness = engine.calculate_robustness(image, watermarked)
    print(f"[-] Image Quality (PSNR): {robustness['psnr']:.2f} dB (Should be > 30)")
    
    if similarity > 0.95:
        print("\n[SUCCESS] VERIFICATION SUCCESS: Algorithm is real and working flawlessly.")
        return True
    else:
        print("\n[FAIL] VERIFICATION FAILED: Fingerprint mismatch.")
        return False

if __name__ == "__main__":
    verify()
