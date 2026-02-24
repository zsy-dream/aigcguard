import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from typing import List

import httpx


@dataclass
class MediaSpec:
    count: int
    out_dir: str
    timeout_s: float


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _default_desktop_dir(folder_name: str) -> str:
    home = os.path.expanduser("~")
    return os.path.join(home, "Desktop", folder_name)


def download_sample_videos(spec: MediaSpec) -> List[str]:
    """
    下载示例短视频（10-20秒左右）
    使用多个备用源，增加重试机制
    """
    _ensure_dir(spec.out_dir)
    paths: List[str] = []

    # 使用多个备用视频源
    sample_videos = [
        {
            "url": "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
            "filename": "0001.mp4"
        },
        {
            "url": "https://www.w3schools.com/html/mov_bbb.mp4",
            "filename": "0002.mp4"
        },
        {
            "url": "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
            "filename": "0003.mp4"
        },
        {
            "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            "filename": "0004.mp4"
        },
        {
            "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
            "filename": "0005.mp4"
        }
    ]

    client = httpx.Client(
        follow_redirects=True, 
        timeout=spec.timeout_s,
        verify=False  # 临时禁用SSL验证以避免网络问题
    )
    
    try:
        for i, video_info in enumerate(sample_videos[: spec.count]):
            url = video_info["url"]
            filename = video_info["filename"]
            out_path = os.path.join(spec.out_dir, filename)

            print(f"Downloading video {i+1}/{spec.count}: {filename}")
            
            # 添加重试机制
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    r = client.get(url)
                    r.raise_for_status()

                    content_type = r.headers.get("content-type", "").lower()
                    if "video" not in content_type and "octet-stream" not in content_type:
                        print(f"Warning: Unexpected content-type for {url}: {content_type}")
                        if attempt == max_retries - 1:
                            continue
                        time.sleep(1)
                        continue

                    with open(out_path, "wb") as f:
                        f.write(r.content)
                    paths.append(out_path)
                    print(f"Saved: {out_path}")
                    break
                    
                except Exception as e:
                    print(f"Attempt {attempt + 1} failed for {url}: {e}")
                    if attempt < max_retries - 1:
                        time.sleep(2)
                    else:
                        print(f"Failed to download {url} after {max_retries} attempts")

        return paths
    finally:
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(prog="download_test_media")
    parser.add_argument("--count", type=int, default=5, help="Number of videos to download")
    parser.add_argument("--desktop-folder", type=str, default="WatermarkTestImages")
    parser.add_argument("--timeout", type=float, default=60.0)

    args = parser.parse_args()

    out_dir = _default_desktop_dir(args.desktop_folder)
    spec = MediaSpec(
        count=args.count,
        out_dir=out_dir,
        timeout_s=args.timeout,
    )

    print(f"Downloading {args.count} sample videos to: {out_dir}")
    paths = download_sample_videos(spec)
    print(f"Downloaded {len(paths)} videos successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
