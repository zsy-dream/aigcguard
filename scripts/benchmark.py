#!/usr/bin/env python3
"""
算法性能基准测试 - 与商业计划书指标对比
可真实运行的性能验证脚本
"""
import sys
import os
import time
import cv2
import numpy as np

# 添加项目根目录
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from algorithms.fingerprint_engine import FingerprintEngine
from algorithms.image_matcher import ImageMatcher


def create_test_image(size=(512, 512)):
    """创建测试图像 - 混合纹理与平滑区域"""
    img = np.zeros((*size, 3), dtype=np.uint8)
    # 渐变背景
    for i in range(size[0]):
        for j in range(size[1]):
            img[i, j] = [
                int(128 + 50 * np.sin(i/20) * np.cos(j/20)),
                int(150 + 30 * np.sin((i+j)/30)),
                int(100 + 40 * np.cos(i/25))
            ]
    # 添加一些噪声纹理
    noise = np.random.randint(-20, 20, img.shape, dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return img


def run_benchmark(test_image_path=None):
    """
    运行完整性能基准测试
    返回与商业计划书对标的指标
    """
    engine = FingerprintEngine(strength=0.1)
    matcher = ImageMatcher()
    results = {}
    
    # 1. 准备测试图像
    if test_image_path and os.path.exists(test_image_path):
        image = cv2.imread(test_image_path)
    else:
        image = create_test_image()
    
    h, w = image.shape[:2]
    results['image_size'] = f'{w}x{h}'
    
    # 2. 嵌入水印 - 计时
    user_id, ts = 'bench_user', time.strftime('%Y%m%d_%H%M%S')
    fingerprint = engine.generate_fingerprint(user_id, ts)
    
    t0 = time.perf_counter()
    watermarked = engine.embed_dct(image, fingerprint)
    t_embed = time.perf_counter() - t0
    results['embed_time_sec'] = round(t_embed, 3)
    
    # 3. PSNR（商业计划书: 38-45dB, 行业>35dB）
    robustness = engine.calculate_robustness(image, watermarked)
    results['psnr_db'] = round(robustness['psnr'], 2)
    results['psnr_pass'] = robustness['psnr'] > 35
    
    # 4. 直接提取（无攻击）相似度 - 应接近100%
    t0 = time.perf_counter()
    extracted = engine.extract_dct(watermarked, length=256)
    t_extract = time.perf_counter() - t0
    results['extract_time_sec'] = round(t_extract, 3)
    
    sim_direct = engine.fingerprint_similarity(extracted, fingerprint)
    results['direct_similarity_pct'] = round(sim_direct * 100, 2)
    results['direct_extract_pass'] = sim_direct >= 0.85
    
    # 5. JPEG 压缩鲁棒性（商业计划书: 质量60%可提取）
    jpeg_results = []
    for quality in [95, 80, 70, 60, 50]:
        _, enc = cv2.imencode('.jpg', watermarked, [cv2.IMWRITE_JPEG_QUALITY, quality])
        dec = cv2.imdecode(enc, cv2.IMREAD_COLOR)
        ext = engine.extract_dct(dec, length=256)
        sim = engine.fingerprint_similarity(ext, fingerprint)
        jpeg_results.append({'quality': quality, 'similarity_pct': round(sim*100, 2), 'pass': sim >= 0.75})
    
    results['jpeg_robustness'] = jpeg_results
    results['jpeg_60_pass'] = next((r['pass'] for r in jpeg_results if r['quality'] == 60), False)
    
    # 6. 总处理时间（商业计划书: <2秒/张）
    results['total_time_sec'] = round(results['embed_time_sec'] + results['extract_time_sec'], 3)
    results['speed_pass'] = results['total_time_sec'] < 2.0
    
    return results


def print_report(results):
    """打印与商业计划书对比的报告"""
    print("\n" + "="*70)
    print("  AIGC 水印算法 - 性能基准测试报告")
    print("  对照: 商业计划书 / 项目介绍 技术指标")
    print("="*70)
    
    print(f"\n【测试图像】 {results['image_size']}")
    
    print("\n【1. 不可见性 - PSNR】")
    print(f"    实测: {results['psnr_db']} dB")
    print(f"    商业计划书: 38-45 dB | 行业标准: >35 dB")
    print(f"    结果: {'✅ 达标' if results['psnr_pass'] else '❌ 未达标'}")
    
    print("\n【2. 直接提取准确率】")
    print(f"    指纹相似度: {results['direct_similarity_pct']}%")
    print(f"    商业计划书: 指纹匹配准确率 >90%")
    print(f"    结果: {'✅ 达标' if results['direct_extract_pass'] else '❌ 未达标'}")
    
    print("\n【3. JPEG 压缩鲁棒性】")
    for r in results['jpeg_robustness']:
        status = "✅" if r['pass'] else "❌"
        print(f"    质量 {r['quality']}%: 相似度 {r['similarity_pct']}% {status}")
    print(f"    商业计划书: 质量60%可提取")
    print(f"    结果: {'✅ 达标' if results['jpeg_60_pass'] else '❌ 未达标'}")
    
    print("\n【4. 处理速度】")
    print(f"    嵌入: {results['embed_time_sec']}s | 提取: {results['extract_time_sec']}s")
    print(f"    总计: {results['total_time_sec']}s/张")
    print(f"    商业计划书: <2秒/张 | 项目介绍: <2秒/张")
    print(f"    结果: {'✅ 达标' if results['speed_pass'] else '❌ 未达标'}")
    
    passed = sum([results['psnr_pass'], results['direct_extract_pass'], 
                  results['jpeg_60_pass'], results['speed_pass']])
    print("\n" + "="*70)
    print(f"  综合: {passed}/4 项达标")
    print("="*70 + "\n")


if __name__ == '__main__':
    img_path = sys.argv[1] if len(sys.argv) > 1 else None
    results = run_benchmark(img_path)
    print_report(results)
