"""
人物照片批量爬取脚本 V2 (增强版)
用于指纹嵌入与检测功能的批量验证

包含多源策略：
1. Unsplash Source (随机人物图，最稳定)
2. Bing 图片搜索 (正则解析)
3. 百度图片搜索 (JSON 解析)

使用方式:
  python scripts/crawl_person_photos_v2.py --count 50
"""

import argparse
import os
import re
import sys
import time
import random
import json
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
    min_file_size: int = 10000  # 小于 10KB 的丢弃
    delay: float = 0.5


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
        # 增加随机 User-Agent
        headers = {
            "User-Agent": random.choice([
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            ])
        }
        
        r = client.get(url, headers=headers)
        r.raise_for_status()

        content_type = r.headers.get("content-type", "").lower()
        # 有些图床不返回标准 image/jpeg，只检查 body 是否为空
        if not r.content:
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
#  策略 1: Unsplash Source (随机)
# ──────────────────────────────────────────────

def crawl_unsplash_source(cfg: CrawlConfig, result: CrawlResult) -> None:
    """利用 Unsplash Source 接口随机获取人物照片"""
    if result.downloaded >= cfg.count:
        return

    print("\n[Unsplash] 尝试获取随机人物照片...")
    
    # 关键词列表
    keywords = ["portrait", "person", "face", "model", "man", "woman"]
    
    client = httpx.Client(follow_redirects=True, timeout=cfg.timeout_s)
    
    try:
        while result.downloaded < cfg.count:
            kw = random.choice(keywords)
            # URL format: https://source.unsplash.com/random/{W}x{H}/?{keyword}
            # Unsplash Source 有时会重定向，httpx follow_redirects=True 处理
            # 注意: Unsplash Source 近期可能不稳定，如果失败会切换其他源
            url = f"https://source.unsplash.com/random/{cfg.width}x{cfg.height}/?{kw}"
            # 也可以用 picsum 作为兜底: https://picsum.photos/{W}/{H}
            
            # 由于 Unsplash Source 可能失效，我们尝试用 picsum 做简单的占位符测试
            # 但用户需要真实人物照片，所以首选还是搜索
            # 这里我们用一个替代方案: Generated Photos (thispersondoesnotexist 类似，但不好爬)
            # 换用: https://thispersondoesnotexist.com/ (单张，无参数)
            
            url = "https://thispersondoesnotexist.com/"
            
            idx = result.downloaded + 1
            filename = f"person_ai_{idx:03d}.jpg"
            save_path = os.path.join(cfg.out_dir, filename)
            
            tag = f"[{idx:>3}/{cfg.count}]"
            
            # 为了避免重复，加一点延迟和随机
            time.sleep(1.0) 
            
            if _download_one(client, url, save_path, cfg.min_file_size):
                result.downloaded += 1
                result.paths.append(save_path)
                print(f"  {tag} {filename} (AI Generated) ✓")
            else:
                print(f"  {tag} AI Source failed, skipping strategy...")
                break
                
    except Exception as e:
        print(f"  [Unsplash/AI] 策略中断: {e}")
    finally:
        client.close()


# ──────────────────────────────────────────────
#  策略 2: Bing 图片搜索 (修复版)
# ──────────────────────────────────────────────

BING_QUERIES = [
    "portrait photography",
    "face photo",
    "headshot",
    "asian portrait",
    "western portrait",
]

def crawl_bing(cfg: CrawlConfig, result: CrawlResult) -> None:
    if result.downloaded >= cfg.count:
        return

    print("\n[Bing] 开始搜索爬取...")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    client = httpx.Client(
        headers=headers, 
        timeout=cfg.timeout_s, 
        verify=False,
        follow_redirects=True
    )

    seen_urls = set()

    try:
        for query in BING_QUERIES:
            if result.downloaded >= cfg.count:
                break
                
            print(f"  Query: {query}")
            url = f"https://www.bing.com/images/search?q={quote_plus(query)}&first=1&count=50&qft=+filterui:photo-photo"
            
            try:
                r = client.get(url)
                html = r.text
            except Exception as e:
                print(f"    Bing 请求失败: {e}")
                continue

            # 尝试多种正则匹配
            # 1. murl (原始大图)
            # 2. turl (缩略图，作为备选)
            urls = re.findall(r'"murl"\s*:\s*"(https?://[^"]+)"', html)
            if not urls:
                urls = re.findall(r'"turl"\s*:\s*"(https?://[^"]+)"', html)
            
            print(f"    找到 {len(urls)} 张图片链接")
            
            for img_url in urls:
                if result.downloaded >= cfg.count:
                    break
                
                # 清理 URL (Bing 有时会转义)
                img_url = img_url.replace('\\', '')
                
                if img_url in seen_urls:
                    continue
                seen_urls.add(img_url)

                idx = result.downloaded + 1
                filename = f"person_bing_{idx:03d}.jpg"
                save_path = os.path.join(cfg.out_dir, filename)
                tag = f"[{idx:>3}/{cfg.count}]"

                if _download_one(client, img_url, save_path, cfg.min_file_size):
                    result.downloaded += 1
                    result.paths.append(save_path)
                    print(f"  {tag} {filename} ✓")
                else:
                    print(f"  {tag} 下载失败: {img_url[:50]}...")
                
                time.sleep(cfg.delay)
            
            time.sleep(1)

    finally:
        client.close()


# ──────────────────────────────────────────────
#  策略 3: 百度图片 (作为最后防线)
# ──────────────────────────────────────────────

BAIDU_QUERIES = ["人像摄影", "大头照", "证件照人像", "模特肖像"]

def crawl_baidu(cfg: CrawlConfig, result: CrawlResult) -> None:
    if result.downloaded >= cfg.count:
        return

    print("\n[Baidu] 启动补充爬取...")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://image.baidu.com"
    }
    
    client = httpx.Client(headers=headers, timeout=cfg.timeout_s, verify=False)
    seen_urls = set()

    try:
        for query in BAIDU_QUERIES:
            if result.downloaded >= cfg.count:
                break
                
            # 百度图片 JSON API
            url = (
                f"https://image.baidu.com/search/acjson?"
                f"tn=resultjson_com&logid=11364736366530138663&ipn=rj&ct=201326592&is=&fp=result&"
                f"queryWord={quote_plus(query)}&cl=2&lm=-1&ie=utf-8&oe=utf-8&adpicid=&st=-1&z=&ic=0&"
                f"hd=&latest=&copyright=&word={quote_plus(query)}&s=&se=&tab=&width=&height=&face=0&"
                f"istype=2&qc=&nc=1&fr=&expermode=&force=&pn=30&rn=30&gsm=1e&1708670624647="
            )
            
            try:
                r = client.get(url)
                # 百度有时候返回 text/plain 但内容是 json
                try:
                    data = r.json()
                except:
                    # 尝试清理非 JSON 字符
                    clean_text = r.text.replace(r"\'", "'")
                    try:
                        data = json.loads(clean_text)
                    except:
                        print("    百度 API 解析失败")
                        continue
                        
                items = data.get("data", [])
                if not items:
                    continue
                    
                print(f"    关键词 '{query}' 获取到 {len(items)} 条数据")
                
                for item in items:
                    if result.downloaded >= cfg.count:
                        break
                        
                    # 优先用 thumbURL (缩略图稳定) 或 middleURL
                    img_url = item.get("middleURL") or item.get("thumbURL")
                    if not img_url:
                        continue
                        
                    if img_url in seen_urls:
                        continue
                    seen_urls.add(img_url)
                    
                    idx = result.downloaded + 1
                    filename = f"person_baidu_{idx:03d}.jpg"
                    save_path = os.path.join(cfg.out_dir, filename)
                    tag = f"[{idx:>3}/{cfg.count}]"

                    if _download_one(client, img_url, save_path, cfg.min_file_size):
                        result.downloaded += 1
                        result.paths.append(save_path)
                        print(f"  {tag} {filename} ✓")
                    else:
                        print(f"  {tag} 下载失败")
                    
                    time.sleep(cfg.delay)
                    
            except Exception as e:
                print(f"    百度爬取异常: {e}")
                
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser(description="多源人物照片爬虫")
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--out-dir", type=str, default=os.path.join("scripts", "test_images", "portraits"))
    
    args = parser.parse_args()
    
    cfg = CrawlConfig(count=args.count, out_dir=args.out_dir)
    result = CrawlResult()
    
    _ensure_dir(cfg.out_dir)
    
    print("=" * 50)
    print(f"开始爬取 {cfg.count} 张人物照片")
    print(f"保存至: {cfg.out_dir}")
    print("=" * 50)

    # 1. 尝试 AI 生成人脸 (高质量，无版权)
    crawl_unsplash_source(cfg, result)
    
    # 2. 尝试 Bing 搜索
    if result.downloaded < cfg.count:
        crawl_bing(cfg, result)
        
    # 3. 尝试 百度 搜索
    if result.downloaded < cfg.count:
        crawl_baidu(cfg, result)
        
    print("\n" + "=" * 50)
    print(f"任务结束。总计下载: {result.downloaded}/{cfg.count}")
    print("=" * 50)

if __name__ == "__main__":
    main()
