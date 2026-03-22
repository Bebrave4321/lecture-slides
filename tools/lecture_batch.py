import argparse
import base64
import json
import mimetypes
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:
    from openai import OpenAI
except ImportError as exc:
    raise SystemExit(
        "The `openai` package is required. Install it with `pip install openai` and try again."
    ) from exc


PROMPT_VERSION = "2026-03-22c"
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_MAX_COMPLETION_TOKENS = 1200
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MODEL_CHOICES = [
    ("1", "gpt-5.4-mini", "recommended default"),
    ("2", "gpt-5-mini", "lower cost"),
    ("3", "gpt-5.4", "stronger model"),
]

SLIDE_SCHEMA = {
    "name": "slide_result",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "skip": {"type": "boolean"},
            "has_visual_teaching_content": {"type": "boolean"},
            "image_observations": {
                "type": "array",
                "items": {"type": "string"},
            },
            "visual_summary": {"type": "string"},
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
        "required": [
            "skip",
            "has_visual_teaching_content",
            "image_observations",
            "visual_summary",
            "terms",
            "explanation",
        ],
        "additionalProperties": False,
    },
}

SYSTEM_PROMPT = """You read one lecture slide image and produce Korean study-help content.

Prioritize what is visibly shown in the slide, not just the text.
When a diagram, labeled figure, timeline, multi-panel image, or annotated illustration is present,
you must actively read it and use it in the explanation.

Return valid JSON only.
"""

PROMPT = """Return JSON that matches the schema exactly.

Decision rules:
- If the slide is a cover page, section divider, blank page, decorative page, or too unreadable to explain:
  - skip = true
  - has_visual_teaching_content = false
  - image_observations = []
  - visual_summary = ""
  - terms = []
  - explanation = a short Korean skip message.
- Otherwise:
  - skip = false

Required workflow before writing the explanation:
1. Inspect the whole slide: title, bullets, labels, arrows, stage markers, tables, captions, and every figure.
2. Decide whether the slide contains meaningful visual teaching content beyond plain bullets.
3. If yes, set has_visual_teaching_content = true, write image_observations, then write visual_summary.
4. If no, set has_visual_teaching_content = false, image_observations = [], visual_summary = "".
5. Only then write the explanation.

Rules for has_visual_teaching_content:
- True when the slide has a diagram, labeled figure, multi-panel sequence, chart, table, microscopy image, or annotated photo that teaches something important.
- False only when the slide is essentially plain text or the figure is too tiny/unreadable to teach from.
- If there is a meaningful figure and you set this to false, that is an error.

Rules for image_observations:
- Each item must describe a specific visible detail, not a vague statement.
- Mention location or panel labels when possible, such as left/right, top/bottom, A1-D3, arrows, sequence, or highlighted structure.
- Good: "On the right, four embryo drawings compare weeks 5, 6, 7, and 8, showing the body becoming more human-like."
- Bad: "There is a diagram." or "An image helps understanding."
- If has_visual_teaching_content = true, image_observations must contain 2 to 4 items.
- If has_visual_teaching_content = false, image_observations must be [].

Rules for visual_summary:
- Write 1 to 2 Korean sentences that explain what the figure itself is teaching.
- Focus on the visual lesson, not on copying bullet text.
- If has_visual_teaching_content = false, visual_summary must be an empty string.

Rules for terms:
- Pick 2 to 5 important terms from the slide.
- terms[].english should keep the original technical term.
- terms[].korean should be a short Korean meaning or label matched 1:1 with the English term.

Rules for explanation:
- Write in natural Korean for a middle or high school student seeing the topic for the first time.
- Sound like a teacher explaining next to the student: clear, warm, and a little vivid, but not childish or jokey.
- Keep the slide self-contained. Do not refer to previous or next slides.
- Do not merely rewrite bullet points. Explain what the slide is showing and why it matters.
- Use 5 to 8 sentences.
- Start by stating the main idea in plain language.
- If has_visual_teaching_content = true, explicitly use at least 3 visual details from image_observations or labels in the explanation.
- If has_visual_teaching_content = true, spend at least half of the sentences on what the figure is showing and how to read it.
- If has_visual_teaching_content = true, use visual_summary as the backbone of the explanation instead of treating the image as a side note.
- One short analogy is allowed only if it genuinely helps understanding.

Language rules:
- All output strings must be in Korean except terms[].english.
- review is never generated here, so do not invent review-like content.
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
        raise SystemExit(f"Slides directory not found: {slides_dir}")

    slides = sorted(
        [path for path in slides_dir.iterdir() if path.suffix.lower() in SUPPORTED_EXTENSIONS],
        key=lambda path: natural_sort_key(path.name),
    )

    if not slides:
        raise SystemExit(
            "No slide images were found. Add jpg/jpeg/png/webp files and try again."
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


def build_messages(image_path: Path) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {
                    "type": "image_url",
                    "image_url": {"url": image_to_data_url(image_path)},
                },
            ],
        },
    ]


def make_request_body(image_path: Path, model: str, max_completion_tokens: int) -> dict:
    return {
        "model": model,
        "messages": build_messages(image_path),
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
        raise SystemExit(f"Job metadata not found: {job_path}")
    return load_json(job_path)


def save_job(work_dir: Path, job: dict):
    write_json(work_dir / "job.json", job)


def choose_model_interactively() -> str:
    print("Choose a model.")
    for key, model_name, description in MODEL_CHOICES:
        print(f"{key}. {model_name} ({description})")

    while True:
        selected = input(f"Enter number [default {MODEL_CHOICES[0][0]}]: ").strip()
        if not selected:
            return DEFAULT_MODEL

        for key, model_name, _ in MODEL_CHOICES:
            if selected == key:
                return model_name

        print("Please enter a valid number.")


def create_request_rows(
    slides: list[Path], model: str, max_completion_tokens: int
) -> tuple[list[dict], list[dict]]:
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
    model_name = args.model or choose_model_interactively()
    slides_dir = normalize_path(args.slides_dir)
    slides = ensure_slides_dir(slides_dir)
    work_dir = normalize_path(args.work_dir) if args.work_dir else default_work_dir(slides_dir)
    results_path = normalize_path(args.results_path) if args.results_path else default_results_path(slides_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    request_rows, manifest_rows = create_request_rows(
        slides,
        model=model_name,
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
            "model": model_name,
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
            "model": model_name,
            "prompt_version": PROMPT_VERSION,
            "created_at": now_iso(),
        },
    )

    print("Batch job started.")
    print(f"- slides_dir: {slides_dir}")
    print(f"- work_dir: {work_dir}")
    print(f"- model: {model_name}")
    print(f"- batch_id: {batch.id}")
    print("")
    print("Check status with:")
    print(f'python tools/lecture_batch.py status --work-dir "{work_dir}"')
    print("")
    print("Build results when completed:")
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


def parse_string_list(raw_items, *, limit: int | None = None) -> list[str]:
    if not isinstance(raw_items, list):
        return []

    normalized_items = []
    seen = set()

    for item in raw_items:
        value = str(item).strip()
        if not value or value in seen:
            continue
        normalized_items.append(value)
        seen.add(value)
        if limit and len(normalized_items) >= limit:
            break

    return normalized_items


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

    raise ValueError("Could not extract text from file response.")


def extract_message_content_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        )
    raise ValueError("Unsupported message.content format.")


def normalize_payload(payload: dict) -> dict:
    return {
        "skip": bool(payload.get("skip", False)),
        "has_visual_teaching_content": bool(
            payload.get("has_visual_teaching_content", False)
        ),
        "image_observations": parse_string_list(
            payload.get("image_observations"),
            limit=4,
        ),
        "visual_summary": str(payload.get("visual_summary", "")).strip(),
        "terms": parse_terms(payload.get("terms")),
        "explanation": str(payload.get("explanation", "")).strip(),
        "review": "",
    }


def parse_model_payload(line: dict) -> tuple[dict, dict]:
    response = line.get("response", {})
    body = response.get("body", {})
    choices = body.get("choices", [])
    if not choices:
        raise ValueError("Response choices are missing.")

    message = choices[0].get("message", {})
    content_text = extract_message_content_text(message.get("content"))
    if not content_text.strip():
        raise ValueError("message.content is empty.")

    payload = json.loads(content_text)
    normalized = normalize_payload(payload)
    usage = body.get("usage", {}) or {}
    normalized_usage = {
        "input_tokens": int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0),
        "output_tokens": int(
            usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0
        ),
        "total_tokens": int(usage.get("total_tokens", 0) or 0),
    }
    return normalized, normalized_usage


def parse_chat_completion_payload(completion) -> tuple[dict, dict]:
    choices = getattr(completion, "choices", None) or []
    if not choices:
        raise ValueError("Response choices are missing.")

    message = getattr(choices[0], "message", None)
    if not message:
        raise ValueError("Response message is missing.")

    content_text = extract_message_content_text(getattr(message, "content", None))
    if not content_text.strip():
        raise ValueError("message.content is empty.")

    payload = json.loads(content_text)
    normalized = normalize_payload(payload)

    usage = getattr(completion, "usage", None)
    normalized_usage = {
        "input_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
        "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
    }
    return normalized, normalized_usage


def print_preview_result(index: int, total: int, slide_path: Path, parsed_result: dict):
    print("")
    print(f"[{index}/{total}] {slide_path.name}")
    print(
        "has_visual_teaching_content: "
        f"{parsed_result['has_visual_teaching_content']}"
    )
    if parsed_result["image_observations"]:
        print("image_observations:")
        for observation in parsed_result["image_observations"]:
            print(f"- {observation}")
    if parsed_result["visual_summary"]:
        print("visual_summary:")
        print(parsed_result["visual_summary"])
    print(parsed_result["explanation"])


def command_preview(args):
    model_name = args.model or choose_model_interactively()
    slides_dir = normalize_path(args.slides_dir)
    slides = ensure_slides_dir(slides_dir)

    if args.limit:
        slides = slides[: args.limit]

    if args.slide_name:
        requested = {name.strip() for name in args.slide_name if name.strip()}
        slides = [slide for slide in slides if slide.name in requested]
        if not slides:
            raise SystemExit("No slides matched the requested slide names.")

    results_path = (
        normalize_path(args.results_path)
        if args.results_path
        else lecture_root_from_slides(slides_dir) / "results-preview.json"
    )

    client = OpenAI()
    results = []
    usage_totals = defaultdict(int)

    for index, slide_path in enumerate(slides, start=1):
        completion = client.chat.completions.create(
            **make_request_body(slide_path, model_name, args.max_completion_tokens)
        )

        parsed_result, usage = parse_chat_completion_payload(completion)
        usage_totals["input_tokens"] += usage["input_tokens"]
        usage_totals["output_tokens"] += usage["output_tokens"]
        usage_totals["total_tokens"] += usage["total_tokens"]

        results.append(
            {
                "file_name": slide_path.name,
                "result": parsed_result,
                "usage": usage,
            }
        )

        print_preview_result(index, len(slides), slide_path, parsed_result)

    write_json(results_path, results)
    write_json(
        results_path.parent / "summary-preview.json",
        {
            "prompt_version": PROMPT_VERSION,
            "model": model_name,
            "slides_dir": str(slides_dir),
            "results_path": str(results_path),
            "slide_count": len(results),
            "usage_totals": dict(usage_totals),
            "generated_at": now_iso(),
        },
    )

    print("")
    print("Preview generation finished.")
    print(f"- results_path: {results_path}")
    print(f"- slide_count: {len(results)}")
    print(
        "- usage_totals: input={0}, output={1}, total={2}".format(
            usage_totals["input_tokens"],
            usage_totals["output_tokens"],
            usage_totals["total_tokens"],
        )
    )


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
        print(f"Batch is not complete yet. Current status: {batch.status}")
        print(f'Check again with: python tools/lecture_batch.py status --work-dir "{work_dir}"')
        return

    if not getattr(batch, "output_file_id", None):
        raise SystemExit("Batch completed, but output_file_id is missing.")

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

    print("results.json generation completed.")
    print(f"- results_path: {results_path}")
    print(f"- completed_count: {len(results)} / {manifest['slide_count']}")
    if missing:
        print(f"- missing_files: {', '.join(missing)}")
    if failures:
        print(f"- parse_failures: {len(failures)} (see summary.json)")


def build_parser():
    parser = argparse.ArgumentParser(
        description="Generate slide explanations with the OpenAI Batch API or preview mode."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    start_parser = subparsers.add_parser(
        "start",
        help="Create a batch request file and start an OpenAI Batch job.",
    )
    start_parser.add_argument("--slides-dir", required=True, help="Path to the slide image directory.")
    start_parser.add_argument(
        "--work-dir",
        help='Path to the batch work directory. Default: lecture root/.openai-batch',
    )
    start_parser.add_argument(
        "--results-path",
        help='Output path for results.json. Default: lecture root/results.json',
    )
    start_parser.add_argument(
        "--model",
        help="Model name. If omitted, you can choose interactively.",
    )
    start_parser.add_argument(
        "--max-completion-tokens",
        type=int,
        default=DEFAULT_MAX_COMPLETION_TOKENS,
        help="Maximum completion tokens per slide.",
    )
    start_parser.set_defaults(func=command_start)

    preview_parser = subparsers.add_parser(
        "preview",
        help="Run immediate non-batch requests for prompt testing.",
    )
    preview_parser.add_argument("--slides-dir", required=True, help="Path to the slide image directory.")
    preview_parser.add_argument(
        "--results-path",
        help='Output path for preview results. Default: lecture root/results-preview.json',
    )
    preview_parser.add_argument(
        "--model",
        help="Model name. If omitted, you can choose interactively.",
    )
    preview_parser.add_argument(
        "--limit",
        type=int,
        help="Only process the first N slides after sorting.",
    )
    preview_parser.add_argument(
        "--slide-name",
        action="append",
        help="Only process a specific slide filename. Can be repeated.",
    )
    preview_parser.add_argument(
        "--max-completion-tokens",
        type=int,
        default=DEFAULT_MAX_COMPLETION_TOKENS,
        help="Maximum completion tokens per slide.",
    )
    preview_parser.set_defaults(func=command_preview)

    status_parser = subparsers.add_parser("status", help="Check the current Batch job status.")
    status_parser.add_argument("--work-dir", required=True, help="Path to the batch work directory.")
    status_parser.set_defaults(func=command_status)

    finish_parser = subparsers.add_parser(
        "finish",
        help="Download a completed Batch output and build results.json.",
    )
    finish_parser.add_argument("--work-dir", required=True, help="Path to the batch work directory.")
    finish_parser.add_argument(
        "--results-path",
        help="Optional alternative output path for results.json.",
    )
    finish_parser.set_defaults(func=command_finish)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
