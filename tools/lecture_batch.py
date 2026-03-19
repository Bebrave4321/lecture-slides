import argparse
import base64
import json
import mimetypes
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:
    from openai import OpenAI
except ImportError as exc:
    raise SystemExit(
        "openai 패키지가 필요합니다. `pip install openai` 후 다시 실행해 주세요."
    ) from exc


PROMPT_VERSION = "2026-03-20"
DEFAULT_MODEL = "gpt-5-mini"
DEFAULT_MAX_COMPLETION_TOKENS = 1200
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

SLIDE_SCHEMA = {
    "name": "slide_result",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "skip": {"type": "boolean"},
            "terms": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "english": {"type": "string"},
                        "korean": {"type": "string"},
                    },
                    "required": ["english", "korean"],
                    "additionalProperties": False,
                },
            },
            "explanation": {"type": "string"},
        },
        "required": ["skip", "terms", "explanation"],
        "additionalProperties": False,
    },
}

PROMPT = """다음 형식에 맞춰 JSON으로만 답해줘.

규칙:
- 단원명, 챕터 제목, 구분용 슬라이드처럼 실질적 학습 정보가 부족하면:
  - skip = true
  - terms = []
  - explanation = "[설명 생략] 단원/구분 슬라이드로 판단되어 설명을 생략합니다."

- 그 외에는:
  - skip = false
  - terms에는 슬라이드의 텍스트 또는 그림 라벨에 실제로 보이는 핵심 용어만 2~5개 넣을 것
  - terms의 english에는 영어 의학/생물학 용어만 넣을 것
  - terms의 korean에는 해당 english 용어에 대응하는 한국어 용어만 넣을 것
  - terms의 english와 korean은 서로 1:1로 대응되게 작성할 것
  - korean 표기는 한 슬라이드 안에서 하나의 표기로 통일하고, 같은 뜻의 다른 표현을 섞지 말 것
  - 불필요한 별칭, 과도한 괄호 설명, 발음 표기는 넣지 말 것
  - explanation은 슬라이드의 텍스트와 이미지 내용을 바탕으로 작성할 것
  - explanation은 처음 배우는 사람도 이해할 수 있도록, 고등학생 수준의 눈높이로 아주 친절하고 쉽게 설명할 것
  - explanation은 3~6문장 정도로, 핵심 개념과 구조·역할이 자연스럽게 이해되도록 작성할 것

중요:
- review는 생성하지 않는다.
- terms와 explanation만 판단해서 반환한다.
"""


def natural_sort_key(value: str):
    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", value)
    ]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_path(path_str: str) -> Path:
    return Path(path_str).expanduser().resolve()


def ensure_slides_dir(slides_dir: Path) -> list[Path]:
    if not slides_dir.exists() or not slides_dir.is_dir():
        raise SystemExit(f"슬라이드 폴더를 찾을 수 없습니다: {slides_dir}")

    slides = sorted(
        [path for path in slides_dir.iterdir() if path.suffix.lower() in SUPPORTED_EXTENSIONS],
        key=lambda path: natural_sort_key(path.name),
    )

    if not slides:
        raise SystemExit(
            "슬라이드 이미지가 없습니다. jpg/jpeg/png/webp 파일을 넣은 뒤 다시 실행해 주세요."
        )

    return slides


def lecture_root_from_slides(slides_dir: Path) -> Path:
    if slides_dir.name.lower() == "slides":
        return slides_dir.parent
    return slides_dir


def default_work_dir(slides_dir: Path) -> Path:
    return lecture_root_from_slides(slides_dir) / ".openai-batch"


def default_results_path(slides_dir: Path) -> Path:
    return lecture_root_from_slides(slides_dir) / "results.json"


def guess_mime_type(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type or "application/octet-stream"


def image_to_data_url(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("utf-8")
    return f"data:{guess_mime_type(path)};base64,{encoded}"


def make_request_body(image_path: Path, model: str, max_completion_tokens: int) -> dict:
    return {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_to_data_url(image_path)},
                    },
                ],
            }
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": SLIDE_SCHEMA,
        },
        "max_completion_tokens": max_completion_tokens,
    }


def write_json(path: Path, data: dict | list):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_jsonl(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_job(work_dir: Path) -> dict:
    job_path = work_dir / "job.json"
    if not job_path.exists():
        raise SystemExit(f"작업 정보를 찾을 수 없습니다: {job_path}")
    return load_json(job_path)


def save_job(work_dir: Path, job: dict):
    write_json(work_dir / "job.json", job)


def create_request_rows(slides: list[Path], model: str, max_completion_tokens: int) -> tuple[list[dict], list[dict]]:
    request_rows = []
    manifest_rows = []

    for index, slide_path in enumerate(slides):
        custom_id = f"slide-{index + 1}:{slide_path.name}"
        request_rows.append(
            {
                "custom_id": custom_id,
                "method": "POST",
                "url": "/v1/chat/completions",
                "body": make_request_body(slide_path, model, max_completion_tokens),
            }
        )
        manifest_rows.append(
            {
                "custom_id": custom_id,
                "slide_index": index,
                "file_name": slide_path.name,
                "absolute_path": str(slide_path),
            }
        )

    return request_rows, manifest_rows


def command_start(args):
    slides_dir = normalize_path(args.slides_dir)
    slides = ensure_slides_dir(slides_dir)
    work_dir = normalize_path(args.work_dir) if args.work_dir else default_work_dir(slides_dir)
    results_path = normalize_path(args.results_path) if args.results_path else default_results_path(slides_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    request_rows, manifest_rows = create_request_rows(
        slides,
        model=args.model,
        max_completion_tokens=args.max_completion_tokens,
    )

    requests_path = work_dir / "requests.jsonl"
    manifest_path = work_dir / "manifest.json"
    raw_output_path = work_dir / "batch-output.jsonl"
    raw_error_path = work_dir / "batch-errors.jsonl"

    write_jsonl(requests_path, request_rows)
    write_json(
        manifest_path,
        {
            "prompt_version": PROMPT_VERSION,
            "model": args.model,
            "slides_dir": str(slides_dir),
            "results_path": str(results_path),
            "created_at": now_iso(),
            "slide_count": len(slides),
            "slides": manifest_rows,
        },
    )

    client = OpenAI()
    with requests_path.open("rb") as handle:
        uploaded_file = client.files.create(file=handle, purpose="batch")

    batch = client.batches.create(
        input_file_id=uploaded_file.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
        metadata={
            "tool": "lecture_batch.py",
            "prompt_version": PROMPT_VERSION,
            "slide_count": str(len(slides)),
        },
    )

    save_job(
        work_dir,
        {
            "batch_id": batch.id,
            "input_file_id": uploaded_file.id,
            "status": batch.status,
            "slides_dir": str(slides_dir),
            "work_dir": str(work_dir),
            "results_path": str(results_path),
            "requests_path": str(requests_path),
            "manifest_path": str(manifest_path),
            "raw_output_path": str(raw_output_path),
            "raw_error_path": str(raw_error_path),
            "model": args.model,
            "prompt_version": PROMPT_VERSION,
            "created_at": now_iso(),
        },
    )

    print("배치 작업을 시작했습니다.")
    print(f"- slides_dir: {slides_dir}")
    print(f"- work_dir: {work_dir}")
    print(f"- batch_id: {batch.id}")
    print("")
    print("다음 확인 명령:")
    print(f'python tools/lecture_batch.py status --work-dir "{work_dir}"')
    print("")
    print("완료 후 결과 생성 명령:")
    print(f'python tools/lecture_batch.py finish --work-dir "{work_dir}"')


def command_status(args):
    work_dir = normalize_path(args.work_dir)
    job = load_job(work_dir)

    client = OpenAI()
    batch = client.batches.retrieve(job["batch_id"])
    job["status"] = batch.status
    job["checked_at"] = now_iso()
    if getattr(batch, "output_file_id", None):
        job["output_file_id"] = batch.output_file_id
    if getattr(batch, "error_file_id", None):
        job["error_file_id"] = batch.error_file_id
    save_job(work_dir, job)

    print(f"batch_id: {batch.id}")
    print(f"status: {batch.status}")
    if getattr(batch, "request_counts", None):
        counts = batch.request_counts
        print(
            "request_counts: total={0}, completed={1}, failed={2}".format(
                getattr(counts, "total", 0),
                getattr(counts, "completed", 0),
                getattr(counts, "failed", 0),
            )
        )
    if getattr(batch, "output_file_id", None):
        print(f"output_file_id: {batch.output_file_id}")
    if getattr(batch, "error_file_id", None):
        print(f"error_file_id: {batch.error_file_id}")


def parse_terms(raw_terms) -> list[dict]:
    if not isinstance(raw_terms, list):
        return []

    normalized_terms = []
    for item in raw_terms:
        if not isinstance(item, dict):
            continue
        english = str(item.get("english", "")).strip()
        korean = str(item.get("korean", "")).strip()
        if english or korean:
            normalized_terms.append({"english": english, "korean": korean})
    return normalized_terms


def extract_text_from_file_response(file_response) -> str:
    text_attr = getattr(file_response, "text", None)
    if isinstance(text_attr, str):
        return text_attr

    content_attr = getattr(file_response, "content", None)
    if isinstance(content_attr, (bytes, bytearray)):
        return content_attr.decode("utf-8")
    if isinstance(content_attr, str):
        return content_attr

    read_method = getattr(file_response, "read", None)
    if callable(read_method):
        data = read_method()
        if isinstance(data, (bytes, bytearray)):
            return data.decode("utf-8")
        if isinstance(data, str):
            return data

    raise ValueError("파일 응답에서 텍스트를 꺼낼 수 없습니다.")


def parse_model_payload(line: dict) -> tuple[dict, dict]:
    response = line.get("response", {})
    body = response.get("body", {})
    choices = body.get("choices", [])
    if not choices:
        raise ValueError("응답 choices가 없습니다.")

    message = choices[0].get("message", {})
    content = message.get("content")
    if isinstance(content, str):
        content_text = content
    elif isinstance(content, list):
        content_text = "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        )
    else:
        raise ValueError("message.content 형식을 해석할 수 없습니다.")

    if not content_text.strip():
        raise ValueError("message.content가 비어 있습니다.")

    payload = json.loads(content_text)
    normalized = {
        "skip": bool(payload.get("skip", False)),
        "terms": parse_terms(payload.get("terms")),
        "explanation": str(payload.get("explanation", "")).strip(),
        "review": "",
    }
    usage = body.get("usage", {}) or {}
    normalized_usage = {
        "input_tokens": int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0),
        "output_tokens": int(
            usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0
        ),
        "total_tokens": int(usage.get("total_tokens", 0) or 0),
    }
    return normalized, normalized_usage


def command_finish(args):
    work_dir = normalize_path(args.work_dir)
    job = load_job(work_dir)
    client = OpenAI()
    batch = client.batches.retrieve(job["batch_id"])

    job["status"] = batch.status
    job["checked_at"] = now_iso()
    if getattr(batch, "output_file_id", None):
        job["output_file_id"] = batch.output_file_id
    if getattr(batch, "error_file_id", None):
        job["error_file_id"] = batch.error_file_id
    save_job(work_dir, job)

    if batch.status != "completed":
        print(f"아직 완료되지 않았습니다. 현재 상태: {batch.status}")
        print(f'확인 명령: python tools/lecture_batch.py status --work-dir "{work_dir}"')
        return

    if not getattr(batch, "output_file_id", None):
        raise SystemExit("완료되었지만 output_file_id가 없습니다.")

    manifest = load_json(Path(job["manifest_path"]))
    raw_output_path = Path(job["raw_output_path"])
    raw_error_path = Path(job["raw_error_path"])
    results_path = normalize_path(args.results_path) if args.results_path else Path(job["results_path"])

    output_text = extract_text_from_file_response(client.files.content(batch.output_file_id))
    raw_output_path.write_text(output_text, encoding="utf-8")

    if getattr(batch, "error_file_id", None):
        error_text = extract_text_from_file_response(client.files.content(batch.error_file_id))
        raw_error_path.write_text(error_text, encoding="utf-8")

    parsed_by_custom_id = {}
    usage_by_custom_id = {}
    failures = []

    for raw_line in output_text.splitlines():
        if not raw_line.strip():
            continue
        line = json.loads(raw_line)
        custom_id = line.get("custom_id")
        try:
            parsed_result, usage = parse_model_payload(line)
        except Exception as exc:  # noqa: BLE001
            failures.append({"custom_id": custom_id, "error": str(exc), "raw": line})
            continue
        parsed_by_custom_id[custom_id] = parsed_result
        usage_by_custom_id[custom_id] = usage

    results = []
    missing = []
    usage_totals = defaultdict(int)

    for slide_meta in manifest["slides"]:
        custom_id = slide_meta["custom_id"]
        if custom_id not in parsed_by_custom_id:
            missing.append(slide_meta["file_name"])
            continue

        usage = usage_by_custom_id[custom_id]
        usage_totals["input_tokens"] += usage["input_tokens"]
        usage_totals["output_tokens"] += usage["output_tokens"]
        usage_totals["total_tokens"] += usage["total_tokens"]

        results.append(
            {
                "file_name": slide_meta["file_name"],
                "result": parsed_by_custom_id[custom_id],
                "usage": usage,
            }
        )

    write_json(results_path, results)

    summary = {
        "prompt_version": manifest["prompt_version"],
        "model": manifest["model"],
        "slides_dir": manifest["slides_dir"],
        "results_path": str(results_path),
        "slide_count": manifest["slide_count"],
        "completed_count": len(results),
        "missing_count": len(missing),
        "missing_files": missing,
        "parse_failures": failures,
        "usage_totals": dict(usage_totals),
        "finished_at": now_iso(),
    }
    write_json(work_dir / "summary.json", summary)

    print("results.json 생성을 완료했습니다.")
    print(f"- results_path: {results_path}")
    print(f"- completed_count: {len(results)} / {manifest['slide_count']}")
    if missing:
        print(f"- missing_files: {', '.join(missing)}")
    if failures:
        print(f"- parse_failures: {len(failures)}건 (summary.json 확인)")


def build_parser():
    parser = argparse.ArgumentParser(
        description="강의 슬라이드 이미지 폴더를 OpenAI Batch API로 처리해 results.json을 생성합니다."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    start_parser = subparsers.add_parser(
        "start", help="배치 요청 파일을 만들고 OpenAI Batch 작업을 시작합니다."
    )
    start_parser.add_argument("--slides-dir", required=True, help="슬라이드 이미지 폴더 경로")
    start_parser.add_argument(
        "--work-dir",
        help='작업 폴더 경로 (기본값: 강의 폴더 아래 ".openai-batch")',
    )
    start_parser.add_argument(
        "--results-path",
        help='완성된 results.json 경로 (기본값: 강의 폴더의 "results.json")',
    )
    start_parser.add_argument("--model", default=DEFAULT_MODEL, help="사용할 모델")
    start_parser.add_argument(
        "--max-completion-tokens",
        type=int,
        default=DEFAULT_MAX_COMPLETION_TOKENS,
        help="슬라이드당 최대 출력 토큰 수",
    )
    start_parser.set_defaults(func=command_start)

    status_parser = subparsers.add_parser("status", help="현재 Batch 상태를 확인합니다.")
    status_parser.add_argument("--work-dir", required=True, help="작업 폴더 경로")
    status_parser.set_defaults(func=command_status)

    finish_parser = subparsers.add_parser(
        "finish", help="완료된 Batch 결과를 받아 현재 사이트 형식의 results.json으로 변환합니다."
    )
    finish_parser.add_argument("--work-dir", required=True, help="작업 폴더 경로")
    finish_parser.add_argument(
        "--results-path",
        help="results.json을 다른 경로로 저장하고 싶을 때 사용",
    )
    finish_parser.set_defaults(func=command_finish)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
