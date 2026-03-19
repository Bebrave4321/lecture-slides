# OpenAI Batch 생성 가이드

이 문서는 `강의 이미지 폴더 -> OpenAI Batch API -> results.json` 흐름을 가장 간단하게 쓰기 위한 안내입니다.

## 준비물

- 슬라이드 이미지 폴더
- Python
- `openai` Python 패키지
- `OPENAI_API_KEY` 환경 변수

예시 폴더:

- `C:\lectures\embryology-01\slides\slide1.jpg`
- `C:\lectures\embryology-01\slides\slide2.jpg`

완료되면 같은 강의 폴더에 `results.json`이 생성됩니다.

## 1. 한 번만 준비

PowerShell에서:

```powershell
pip install openai
```

API 키 설정 예시:

```powershell
$env:OPENAI_API_KEY="여기에_본인_API_키"
```

## 2. 배치 시작

슬라이드 폴더를 기준으로 아래 명령을 실행합니다.

```powershell
python tools/lecture_batch.py start --slides-dir "C:\lectures\embryology-01\slides"
```

이 명령이 하는 일:

- 슬라이드 이미지를 자연 순서로 읽음
- Batch 요청 파일 생성
- OpenAI에 업로드
- Batch 작업 시작
- 강의 폴더 아래 `.openai-batch` 작업 폴더 생성

## 3. 상태 확인

```powershell
python tools/lecture_batch.py status --work-dir "C:\lectures\embryology-01\.openai-batch"
```

`completed`가 나오면 다음 단계로 갑니다.

## 4. results.json 만들기

```powershell
python tools/lecture_batch.py finish --work-dir "C:\lectures\embryology-01\.openai-batch"
```

완료되면:

- `C:\lectures\embryology-01\results.json`
- `C:\lectures\embryology-01\.openai-batch\summary.json`

이 생성됩니다.

## 생성되는 결과 형식

`results.json`은 현재 웹사이트가 바로 읽을 수 있는 형식으로 저장됩니다.

- `file_name`
- `result.skip`
- `result.terms`
- `result.explanation`
- `result.review`
- `usage`

중요:

- `review`는 AI가 쓰지 않고 빈 문자열로 둡니다.
- `review`는 웹사이트에서 직접 작성하면 됩니다.

## 사이트에 넣는 방법

강의 폴더 기준으로 아래 두 가지만 있으면 됩니다.

- `slides/`
- `results.json`

그 다음 `lectures.json`에 강의 항목을 연결하면 사이트에서 볼 수 있습니다.

## 자주 쓰는 흐름 요약

1. 슬라이드 이미지 폴더 준비
2. `start` 실행
3. `status`로 완료 확인
4. `finish` 실행
5. 생성된 `results.json`을 사이트에 연결

## 주의할 점

- `.openai-batch` 폴더는 중간 작업 파일이므로 Git에 올리지 않게 되어 있습니다.
- OpenAI API 키는 절대 GitHub에 올리지 마세요.
- Batch 결과는 입력 순서와 다르게 돌아올 수 있어서, 스크립트가 `custom_id`로 다시 원래 순서에 맞춰 정렬합니다.
