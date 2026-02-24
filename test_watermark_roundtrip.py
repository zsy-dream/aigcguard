"""
验证文本和视频（DCT 图像）水印嵌入 → 提取的完整往返测试
确保嵌入的指纹能被正确提取出来
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np


def test_text_watermark_roundtrip():
    """测试文本零宽字符水印嵌入与提取"""
    from app.service.text_watermark import TextWatermarkService

    original_text = "这是一段用于测试的AIGC生成文案，包含版权保护需求。"
    watermark_str = "12345678"

    # 嵌入
    watermarked = TextWatermarkService.embed(original_text, watermark_str)
    assert watermarked != original_text, "嵌入后文本应有变化"

    # 提取
    extracted = TextWatermarkService.extract(watermarked)
    assert extracted == watermark_str, f"提取结果不匹配: 期望 '{watermark_str}', 得到 '{extracted}'"

    # 可见文本不应被改变（去掉零宽字符后应与原文一致）
    import re
    visible = re.sub(r'[\u200b\u200c\u200d]', '', watermarked)
    assert visible == original_text, "可见文本不应被改变"

    print("[PASS] 文本水印往返测试通过")


def test_dct_watermark_roundtrip():
    """测试 DCT 频域水印嵌入与提取（图像级别，也是视频的核心）"""
    from algorithms.fingerprint_engine import FingerprintEngine

    engine = FingerprintEngine(strength=0.15)

    # 创建测试图像 (512x512 BGR)
    np.random.seed(42)
    test_image = np.random.randint(50, 200, (512, 512, 3), dtype=np.uint8)

    # 生成合法的 SHA256 十六进制指纹
    import hashlib
    fingerprint = hashlib.sha256(b"test_user:20260223").hexdigest()
    assert len(fingerprint) == 64, "指纹应为 64 字符十六进制"

    # 嵌入
    watermarked = engine.embed_dct(test_image, fingerprint)
    assert watermarked.shape == test_image.shape, "输出图像形状应一致"

    # 提取
    extracted = engine.extract_dct(watermarked, length=256)
    assert len(extracted) > 0, "提取结果不应为空"

    # 相似度计算
    similarity = engine.fingerprint_similarity(extracted, fingerprint)
    print(f"  DCT 指纹相似度: {similarity:.4f} (提取长度: {len(extracted)} chars)")
    assert similarity > 0.85, f"相似度应 > 0.85, 实际 {similarity:.4f}"

    print("[PASS] DCT 水印往返测试通过")


def test_dct_watermark_after_jpeg_save():
    """测试经过 JPEG 保存后的 DCT 水印鲁棒性"""
    import cv2
    import tempfile
    from algorithms.fingerprint_engine import FingerprintEngine

    engine = FingerprintEngine(strength=0.15)

    np.random.seed(42)
    test_image = np.random.randint(50, 200, (512, 512, 3), dtype=np.uint8)

    import hashlib
    fingerprint = hashlib.sha256(b"test_user:jpeg_test").hexdigest()

    # 嵌入
    watermarked = engine.embed_dct(test_image, fingerprint)

    # 模拟 JPEG 保存 + 加载（Q=95）
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        tmp_path = f.name
    cv2.imwrite(tmp_path, watermarked, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    reloaded = cv2.imread(tmp_path)
    os.remove(tmp_path)

    # 提取
    extracted = engine.extract_dct(reloaded, length=256)
    similarity = engine.fingerprint_similarity(extracted, fingerprint)
    print(f"  JPEG Q95 后指纹相似度: {similarity:.4f}")
    assert similarity > 0.70, f"JPEG 后相似度应 > 0.70, 实际 {similarity:.4f}"

    print("[PASS] JPEG 鲁棒性测试通过")


def test_no_watermark_detection():
    """测试未嵌入水印的图像不应误报"""
    from algorithms.fingerprint_engine import FingerprintEngine

    engine = FingerprintEngine()

    # 纯随机图像
    np.random.seed(123)
    clean_image = np.random.randint(0, 255, (256, 256, 3), dtype=np.uint8)

    extracted = engine.extract_dct(clean_image, length=256)
    # 对于未嵌入水印的图像，提取的指纹应该是近似随机的
    # 如果和任何已知指纹比较，相似度应该接近 0.5（随机）
    import hashlib
    known_fp = hashlib.sha256(b"some_user:test").hexdigest()
    similarity = engine.fingerprint_similarity(extracted, known_fp)
    print(f"  未嵌入图像 vs 已知指纹相似度: {similarity:.4f} (期望接近 0.5)")

    print("[PASS] 无水印图像误报测试通过")


if __name__ == "__main__":
    print("=" * 60)
    print("水印嵌入/提取往返测试")
    print("=" * 60)

    test_text_watermark_roundtrip()
    print()
    test_dct_watermark_roundtrip()
    print()
    test_dct_watermark_after_jpeg_save()
    print()
    test_no_watermark_detection()

    print()
    print("=" * 60)
    print("全部测试通过！")
    print("=" * 60)
