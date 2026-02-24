import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx


sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class DownloadSpec:
    count: int
    width: int
    height: int
    out_dir: str
    seed_prefix: str
    name_mode: str
    timeout_s: float


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def download_images(spec: DownloadSpec) -> List[str]:
    _ensure_dir(spec.out_dir)

    paths: List[str] = []
    client = httpx.Client(follow_redirects=True, timeout=spec.timeout_s)
    try:
        for i in range(spec.count):
            seed = f"{spec.seed_prefix}{i:05d}"
            url = f"https://picsum.photos/seed/{seed}/{spec.width}/{spec.height}"
            if spec.name_mode == "numeric":
                filename = f"{i+1:04d}.jpg"
            else:
                filename = f"picsum_{seed}_{spec.width}x{spec.height}.jpg"
            out_path = os.path.join(spec.out_dir, filename)

            r = client.get(url)
            r.raise_for_status()

            content_type = r.headers.get("content-type", "").lower()
            if "image" not in content_type:
                raise RuntimeError(f"Unexpected content-type for {url}: {content_type}")

            with open(out_path, "wb") as f:
                f.write(r.content)
            paths.append(out_path)

        return paths
    finally:
        client.close()


def _iter_images_from_dir(dir_path: str) -> List[str]:
    if not os.path.exists(dir_path):
        return []

    exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    results: List[str] = []
    for name in sorted(os.listdir(dir_path)):
        p = os.path.join(dir_path, name)
        if os.path.isfile(p) and os.path.splitext(name)[1].lower() in exts:
            results.append(p)
    return results


def _default_desktop_dir(folder_name: str) -> str:
    home = os.path.expanduser("~")
    return os.path.join(home, "Desktop", folder_name)


def _run_local_embed(
    image_paths: List[str],
    strength: float,
    user_id: str,
    author_name: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    from app.service.watermark import WatermarkService

    results: List[Dict[str, Any]] = []
    ok = 0
    failed = 0
    t0 = time.time()

    for p in image_paths:
        filename = os.path.basename(p)
        try:
            with open(p, "rb") as f:
                b = f.read()
            res = WatermarkService.embed_watermark(
                file_bytes=b,
                filename=filename,
                user_id=user_id,
                author_name=author_name,
                strength=strength,
            )
            results.append({"input": p, "status": "success", "result": res})
            ok += 1
        except Exception as e:
            results.append({"input": p, "status": "failed", "error": str(e)})
            failed += 1

    elapsed = time.time() - t0
    summary = {
        "mode": "local",
        "count": len(image_paths),
        "success": ok,
        "failed": failed,
        "elapsed_s": round(elapsed, 3),
        "avg_s": round(elapsed / max(1, len(image_paths)), 4),
        "strength": strength,
        "user_id": user_id,
        "author_name": author_name,
    }
    return results, summary


def _run_api_embed(
    image_paths: List[str],
    strength: float,
    author_name: str,
    api_url: str,
    timeout_s: float,
    bearer_token: Optional[str],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    ok = 0
    failed = 0

    headers: Dict[str, str] = {}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    t0 = time.time()
    client = httpx.Client(timeout=timeout_s, headers=headers)
    try:
        for p in image_paths:
            filename = os.path.basename(p)
            try:
                with open(p, "rb") as f:
                    files = {"image": (filename, f, "application/octet-stream")}
                    data = {"strength": str(strength), "author_name": author_name}
                    r = client.post(api_url, files=files, data=data)
                r.raise_for_status()
                results.append({"input": p, "status": "success", "result": r.json()})
                ok += 1
            except Exception as e:
                err_detail = str(e)
                try:
                    if isinstance(e, httpx.HTTPStatusError) and e.response is not None:
                        err_detail = f"{e.response.status_code}: {e.response.text}"
                except Exception:
                    pass
                results.append({"input": p, "status": "failed", "error": err_detail})
                failed += 1
    finally:
        client.close()

    elapsed = time.time() - t0
    summary = {
        "mode": "api",
        "api_url": api_url,
        "count": len(image_paths),
        "success": ok,
        "failed": failed,
        "elapsed_s": round(elapsed, 3),
        "avg_s": round(elapsed / max(1, len(image_paths)), 4),
        "strength": strength,
        "author_name": author_name,
    }
    return results, summary


def _write_report(out_dir: str, results: List[Dict[str, Any]], summary: Dict[str, Any]) -> str:
    _ensure_dir(out_dir)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = os.path.join(out_dir, f"batch_report_{ts}.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "results": results}, f, ensure_ascii=False, indent=2)
    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(prog="batch_watermark_test")

    parser.add_argument("--download", action="store_true")
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--seed-prefix", type=str, default="aigc_")
    parser.add_argument("--name-mode", choices=["seed", "numeric"], default="seed")
    parser.add_argument("--desktop-folder", type=str, default=None)

    parser.add_argument("--input-dir", type=str, default=os.path.join("scripts", "test_images"))
    parser.add_argument("--report-dir", type=str, default=os.path.join("scripts", "batch_reports"))

    parser.add_argument("--mode", choices=["local", "api"], default="local")
    parser.add_argument("--strength", type=float, default=0.1)
    parser.add_argument("--user-id", type=str, default="guest")
    parser.add_argument("--author-name", type=str, default="guest")

    parser.add_argument("--api-url", type=str, default="http://127.0.0.1:8000/api/embed")
    parser.add_argument("--bearer-token", type=str, default=None)
    parser.add_argument("--timeout", type=float, default=30.0)

    args = parser.parse_args()

    if args.download:
        if args.desktop_folder:
            args.input_dir = _default_desktop_dir(args.desktop_folder)
        spec = DownloadSpec(
            count=args.count,
            width=args.width,
            height=args.height,
            out_dir=args.input_dir,
            seed_prefix=args.seed_prefix,
            name_mode=args.name_mode,
            timeout_s=args.timeout,
        )
        download_images(spec)

    if args.download_only:
        return 0

    image_paths = _iter_images_from_dir(args.input_dir)
    if not image_paths:
        raise SystemExit(f"No images found in {args.input_dir}. Use --download first.")

    if args.mode == "local":
        results, summary = _run_local_embed(
            image_paths=image_paths,
            strength=args.strength,
            user_id=args.user_id,
            author_name=args.author_name,
        )
    else:
        results, summary = _run_api_embed(
            image_paths=image_paths,
            strength=args.strength,
            author_name=args.author_name,
            api_url=args.api_url,
            timeout_s=args.timeout,
            bearer_token=args.bearer_token,
        )

    report_path = _write_report(args.report_dir, results, summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Report saved: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
