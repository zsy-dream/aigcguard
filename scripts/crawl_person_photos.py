"""
人物照片批量爬取脚本
用于指纹嵌入与检测功能的批量验证

使用方式:
  方式1 - Pexels API (推荐，照片质量高):
    python scripts/crawl_person_photos.py --source pexels --api-key YOUR_KEY --count 50

  方式2 - Bing 图片搜索 (无需 API Key):
    python scripts/crawl_person_photos.py --source bing --count 50

  方式3 - 混合模式 (Pexels 为主, Bing 补充):
    python scripts/crawl_person_photos.py --source pexels --api-key YOUR_KEY --count 50 --fallback-bing

获取 Pexels API Key:
  1. 访问 https://www.pexels.com/api/
  2. 免费注册，即可获取 API Key (每月 20000 次请求)
"""

import argparse
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import List, Optional, Set
from urllib.parse import quote_plus

import httpx


@dataclass
class CrawlConfig:
    count: int = 50
    out_dir: str = os.path.join("scripts", "test_images", "portraits")
    width: int = 512
    height: int = 680
    timeout_s: float = 30.0
    min_file_size: int = 5000  # 小于 5KB 的丢弃
    delay: float = 0.3  # 每次下载间隔 (秒)


@dataclass
class CrawlResult:
    downloaded: int = 0
    failed: int = 0
    skipped: int = 0
    paths: List[str] = field(default_factory=list)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _download_one(
    client: httpx.Client,
    url: str,
    save_path: str,
    min_size: int = 5000,
) -> bool:
    """下载单张图片，返回是否成功"""
    try:
        r = client.get(url)
        r.raise_for_status()

        content_type = r.headers.get("content-type", "").lower()
        if "image" not in content_type:
            return False

        with open(save_path, "wb") as f:
            f.write(r.content)

        if os.path.getsize(save_path) < min_size:
            os.remove(save_path)
            return False

        return True
    except Exception:
        if os.path.exists(save_path):
            os.remove(save_path)
        return False


# ──────────────────────────────────────────────
#  Pexels API 爬取
# ──────────────────────────────────────────────

PEXELS_QUERIES = [
    "portrait person face",
    "headshot portrait photography",
    "young person portrait",
    "business portrait headshot",
    "woman portrait photo",
    "man portrait photo",
]


def crawl_pexels(cfg: CrawlConfig, api_key: str) -> CrawlResult:
    """从 Pexels API 下载人物照片"""
    _ensure_dir(cfg.out_dir)
    result = CrawlResult()
    seen_ids: Set[int] = set()

    size_key = "medium"
    if cfg.width > 600:
        size_key = "large"
    elif cfg.width <= 300:
        size_key = "small"

    headers = {"Authorization": api_key}
    client = httpx.Client(
        follow_redirects=True,
        timeout=cfg.timeout_s,
        headers=headers,
    )

    print(f"[Pexels] 目标: {cfg.count} 张人物照片")
    print(f"[Pexels] 保存: {os.path.abspath(cfg.out_dir)}")
    print("-" * 50)

    try:
        for query in PEXELS_QUERIES:
            if result.downloaded >= cfg.count:
                break

            page = 1
            empty_pages = 0

            while result.downloaded < cfg.count and empty_pages < 2:
                try:
                    r = client.get(
                        "https://api.pexels.com/v1/search",
                        params={
                            "query": query,
                            "per_page": 40,
                            "page": page,
                            "orientation": "portrait",
                        },
                    )

                    if r.status_code == 429:
                        print("[警告] 触发速率限制，等待 30 秒...")
                        time.sleep(30)
                        continue

                    r.raise_for_status()
                    data = r.json()
                except Exception as e:
                    print(f"[错误] API 请求失败: {e}")
                    break

                photos = data.get("photos", [])
                if not photos:
                    empty_pages += 1
                    page += 1
                    continue

                for photo in photos:
                    if result.downloaded >= cfg.count:
                        break

                    pid = photo["id"]
                    if pid in seen_ids:
                        continue
                    seen_ids.add(pid)

                    img_url = photo["src"].get(size_key, photo["src"]["medium"])
                    idx = result.downloaded + 1
                    filename = f"person_{idx:03d}.jpg"
                    save_path = os.path.join(cfg.out_dir, filename)

                    tag = f"[{idx:>3}/{cfg.count}]"
                    if _download_one(client, img_url, save_path, cfg.min_file_size):
                        result.downloaded += 1
                        result.paths.append(save_path)
                        print(f"  {tag} {filename}  ✓")
                    else:
                        result.failed += 1
                        print(f"  {tag} {filename}  ✗")

                    time.sleep(cfg.delay)

                page += 1
                time.sleep(0.5)
    finally:
        client.close()

    return result


# ──────────────────────────────────────────────
#  Bing 图片搜索爬取 (无需 API Key)
# ──────────────────────────────────────────────

BING_QUERIES = [
    "portrait person photo",
    "人物 肖像 摄影",
    "headshot portrait photography",
    "professional headshot photo",
]

BING_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def _extract_bing_image_urls(html: str) -> List[str]:
    """从 Bing 搜索结果 HTML 中提取图片直链"""
    # Bing 在 `murl` 字段中存储原始图片 URL
    urls = re.findall(r'"murl"\s*:\s*"(https?://[^"]+?\.(?:jpg|jpeg|png))"', html)
    return urls


def crawl_bing(cfg: CrawlConfig, start_idx: int = 0) -> CrawlResult:
    """从 Bing 图片搜索爬取人物照片 (无需 API Key)"""
    _ensure_dir(cfg.out_dir)
    result = CrawlResult()
    seen_urls: Set[str] = set()

    client = httpx.Client(
        follow_redirects=True,
        timeout=cfg.timeout_s,
        headers=BING_HEADERS,
        verify=False,
    )

    print(f"[Bing] 目标: {cfg.count} 张人物照片")
    print(f"[Bing] 保存: {os.path.abspath(cfg.out_dir)}")
    print("-" * 50)

    try:
        for query in BING_QUERIES:
            if result.downloaded >= cfg.count:
                break

            print(f"\n  搜索: {query}")
            offset = 0

            while result.downloaded < cfg.count and offset < 200:
                search_url = (
                    f"https://www.bing.com/images/search"
                    f"?q={quote_plus(query)}"
                    f"&first={offset}&count=35"
                    f"&qft=+filterui:photo-photo+filterui:imagesize-medium"
                )

                try:
                    r = client.get(search_url)
                    r.raise_for_status()
                    html = r.text
                except Exception as e:
                    print(f"  [错误] 搜索请求失败: {e}")
                    break

                img_urls = _extract_bing_image_urls(html)
                new_urls = [u for u in img_urls if u not in seen_urls]

                if not new_urls:
                    offset += 35
                    if offset > 100:
                        break
                    continue

                for img_url in new_urls:
                    if result.downloaded >= cfg.count:
                        break

                    seen_urls.add(img_url)
                    idx = start_idx + result.downloaded + 1
                    filename = f"person_{idx:03d}.jpg"
                    save_path = os.path.join(cfg.out_dir, filename)

                    tag = f"[{idx:>3}/{start_idx + cfg.count}]"
                    if _download_one(client, img_url, save_path, cfg.min_file_size):
                        result.downloaded += 1
                        result.paths.append(save_path)
                        print(f"  {tag} {filename}  ✓")
                    else:
                        result.failed += 1
                        result.skipped += 1

                    time.sleep(cfg.delay)

                offset += 35
                time.sleep(1)
    finally:
        client.close()

    return result


# ──────────────────────────────────────────────
#  主程序
# ──────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        prog="crawl_person_photos",
        description="批量爬取人物照片 - 用于指纹嵌入/检测功能验证",
    )
    parser.add_argument(
        "--source",
        choices=["pexels", "bing"],
        default="bing",
        help="图片来源 (默认: bing)",
    )
    parser.add_argument(
        "--api-key",
        type=str,
        default="",
        help="Pexels API Key (source=pexels 时必填)",
    )
    parser.add_argument("--count", type=int, default=50, help="下载数量 (默认: 50)")
    parser.add_argument(
        "--out-dir",
        type=str,
        default=os.path.join("scripts", "test_images", "portraits"),
        help="输出目录",
    )
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=680)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--fallback-bing",
        action="store_true",
        help="Pexels 不足时用 Bing 补充",
    )

    args = parser.parse_args()

    cfg = CrawlConfig(
        count=args.count,
        out_dir=args.out_dir,
        width=args.width,
        height=args.height,
        timeout_s=args.timeout,
    )

    print("=" * 50)
    print("  人物照片批量爬取工具")
    print("  用途: 指纹嵌入与检测功能验证")
    print("=" * 50)

    total_downloaded = 0

    if args.source == "pexels":
        if not args.api_key:
            print("\n[错误] 使用 Pexels 源需要提供 --api-key")
            print("  获取方式: 访问 https://www.pexels.com/api/ 免费注册")
            print("\n  或改用 Bing 源 (无需 Key):")
            print("    python scripts/crawl_person_photos.py --source bing --count 50")
            return 1

        result = crawl_pexels(cfg, args.api_key)
        total_downloaded = result.downloaded

        if args.fallback_bing and total_downloaded < args.count:
            remaining = args.count - total_downloaded
            print(f"\n[Pexels 不足] 还需 {remaining} 张，切换到 Bing 补充...")
            cfg_bing = CrawlConfig(
                count=remaining,
                out_dir=cfg.out_dir,
                timeout_s=cfg.timeout_s,
            )
            bing_result = crawl_bing(cfg_bing, start_idx=total_downloaded)
            total_downloaded += bing_result.downloaded

    elif args.source == "bing":
        result = crawl_bing(cfg)
        total_downloaded = result.downloaded

    print("\n" + "=" * 50)
    print(f"  完成! 共下载 {total_downloaded} 张人物照片")
    print(f"  保存位置: {os.path.abspath(cfg.out_dir)}")
    print("=" * 50)

    if total_downloaded > 0:
        print(f"\n下一步 - 批量指纹嵌入测试:")
        print(f"  python scripts/batch_watermark_test.py \\")
        print(f"    --input-dir {cfg.out_dir} --mode local --strength 0.1")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
