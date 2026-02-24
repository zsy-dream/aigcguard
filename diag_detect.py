"""
诊断脚本：测试对指定水印图片的指纹提取
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import cv2
import numpy as np
from algorithms.fingerprint_engine import FingerprintEngine

engine = FingerprintEngine()

# 1. 加载用户提到的水印图片
img_path = os.path.join("outputs", "20260222_140646_watermarked.jpg")
print(f"=== 诊断: {img_path} ===")
print(f"文件大小: {os.path.getsize(img_path)} bytes")

img = cv2.imread(img_path)
if img is None:
    print("ERROR: 无法加载图片")
    sys.exit(1)

print(f"图片尺寸: {img.shape} (h={img.shape[0]}, w={img.shape[1]})")

# 2. 旧版提取 (Q=30, 复现问题)
extracted_old = engine.extract_dct(img, length=256)
strength_old = sum(1 for c in extracted_old if c != '0')
print(f"\n旧版提取 (Q=30): 指纹强度={strength_old}, 前16字符={extracted_old[:16]}")

# 3. 修复后: 自适应提取
extracted, used_q = engine.extract_dct_adaptive(img, length=256)
fingerprint_strength = sum(1 for c in extracted if c != '0')
print(f"自适应提取: 指纹强度={fingerprint_strength}, QIM_STEP={used_q}, 前16字符={extracted[:16]}")

# 4. 检查快速预检阈值
QUICK_CHECK_THRESHOLD = 15
MIN_FINGERPRINT_STRENGTH = 10
print(f"\n快速预检阈值: {QUICK_CHECK_THRESHOLD}")
print(f"  fingerprint_strength < {QUICK_CHECK_THRESHOLD} ? → {'是 (会被判定为无水印!)' if fingerprint_strength < QUICK_CHECK_THRESHOLD else '否 (通过)'}")
print(f"最小指纹强度: {MIN_FINGERPRINT_STRENGTH}")
print(f"  fingerprint_strength >= {MIN_FINGERPRINT_STRENGTH} ? → {'是 (has_strong_fingerprint=True)' if fingerprint_strength >= MIN_FINGERPRINT_STRENGTH else '否 (has_strong_fingerprint=False)'}")

# 5. 对比：在内存中嵌入一个新指纹，然后提取，验证算法正确性
print(f"\n=== 对比测试: 新嵌入 → 提取 ===")
import hashlib
test_fp = hashlib.sha256(b"test_diag:check").hexdigest()
print(f"嵌入指纹: {test_fp}")

test_img = np.random.randint(50, 200, (512, 512, 3), dtype=np.uint8)
watermarked = engine.embed_dct(test_img, test_fp)

# 保存为JPEG再读取（模拟实际流程）
import tempfile
with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
    tmp = f.name
cv2.imwrite(tmp, watermarked, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
reloaded = cv2.imread(tmp)
os.remove(tmp)

extracted_new = engine.extract_dct(reloaded, length=256)
sim = engine.fingerprint_similarity(extracted_new, test_fp)
print(f"新嵌入提取后相似度: {sim:.4f}")
strength_new = sum(1 for c in extracted_new if c != '0')
print(f"新嵌入提取后指纹强度: {strength_new}")

# 6. 尝试用提取的旧指纹与数据库中的指纹做匹配
# 先看看 block_positions 数量
h, w = img.shape[:2]
bs = 8
positions = engine._block_positions(h, w, bs, 256)
print(f"\n=== 块位置分析 ===")
print(f"图像: {h}x{w}, 块大小: {bs}")
print(f"请求 256 个块, 实际可用: {len(positions)}")
if len(positions) < 256:
    print(f"⚠️ 块数不足! 只有 {len(positions)} 个块，需要 256 个块才能提取完整指纹")

# 7. 尝试不同的 QIM_STEP 提取
print(f"\n=== QIM_STEP 敏感性测试 ===")
print(f"当前 QIM_STEP = {engine.QIM_STEP}")
for q in [8, 15, 20, 30, 50]:
    old_q = engine.QIM_STEP
    engine.QIM_STEP = q
    ext = engine.extract_dct(img, length=256)
    strength = sum(1 for c in ext if c != '0')
    engine.QIM_STEP = old_q
    print(f"  Q={q:3d}: 指纹强度={strength:3d}, 前16字符={ext[:16]}")
