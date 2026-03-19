const LECTURES_PATH = "lectures.json";
const DEFAULT_EXPLANATION = "설명이 없습니다.";
const DEFAULT_REVIEW = "아직 작성된 복습 내용이 없습니다.";
const DEFAULT_TERMS_EMPTY = "표시할 핵심 용어가 없습니다.";

async function fetchJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }

  return await response.json();
}

async function loadCatalog() {
  return await fetchJson(LECTURES_PATH);
}

function flattenLectures(catalog) {
  return (catalog.subjects || []).flatMap((subject) =>
    (subject.lectures || []).map((lecture) => ({ subject, lecture }))
  );
}

function findLectureById(catalog, lectureId) {
  return flattenLectures(catalog).find(({ lecture }) => lecture.id === lectureId);
}

function getDefaultLecture(catalog) {
  return flattenLectures(catalog)[0] || null;
}

function getLectureResultsPath(lecture) {
  return lecture.resultsPath || "results.json";
}

function getLectureSlidesPath(lecture) {
  return lecture.slidesPath || "slides";
}

function buildViewerHref(lectureId, index) {
  return `viewer.html?lecture=${encodeURIComponent(lectureId)}&index=${index}`;
}

function buildLectureHref(lectureId) {
  return `index.html?lecture=${encodeURIComponent(lectureId)}`;
}

function getReviewStorageKey(lectureId, index) {
  return `${lectureId}__slide_review_${index}`;
}

function getExplanationStorageKey(lectureId, index) {
  return `${lectureId}__slide_explanation_${index}`;
}

function getTermsStorageKey(lectureId, index) {
  return `${lectureId}__slide_terms_${index}`;
}

function getSavedReview(lectureId, index, defaultValue) {
  const saved = localStorage.getItem(getReviewStorageKey(lectureId, index));
  return saved !== null ? saved : defaultValue;
}

function getSavedExplanation(lectureId, index, defaultValue) {
  const saved = localStorage.getItem(getExplanationStorageKey(lectureId, index));
  return saved !== null ? saved : defaultValue;
}

function getSavedTerms(lectureId, index, defaultTerms) {
  const saved = localStorage.getItem(getTermsStorageKey(lectureId, index));

  if (saved === null) {
    return defaultTerms;
  }

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : defaultTerms;
  } catch (error) {
    return defaultTerms;
  }
}

function getCurrentSlideEdits(lectureId, index, result) {
  return {
    explanation: getSavedExplanation(
      lectureId,
      index,
      result.explanation || DEFAULT_EXPLANATION
    ),
    review: getSavedReview(lectureId, index, result.review || DEFAULT_REVIEW),
    terms: getSavedTerms(lectureId, index, result.terms || []),
  };
}

function clearSlideEdits(lectureId, index) {
  localStorage.removeItem(getExplanationStorageKey(lectureId, index));
  localStorage.removeItem(getReviewStorageKey(lectureId, index));
  localStorage.removeItem(getTermsStorageKey(lectureId, index));
}

function createEmptyState(text) {
  const emptyText = document.createElement("div");
  emptyText.className = "empty-text";
  emptyText.textContent = text;
  return emptyText;
}

function createSlideCard(title, href, metaText) {
  const link = document.createElement("a");
  link.href = href;
  link.className = "slide-link";

  const titleElement = document.createElement("div");
  titleElement.className = "slide-link-title";
  titleElement.textContent = title;
  link.appendChild(titleElement);

  if (metaText) {
    const metaElement = document.createElement("div");
    metaElement.className = "slide-link-meta";
    metaElement.textContent = metaText;
    link.appendChild(metaElement);
  }

  return link;
}

function renderTermsList(termsList, terms) {
  termsList.innerHTML = "";

  if (!terms || terms.length === 0) {
    termsList.appendChild(createEmptyState(DEFAULT_TERMS_EMPTY));
    return;
  }

  terms.forEach((term) => {
    const termItem = document.createElement("div");
    termItem.className = "term-item";

    const english = document.createElement("div");
    english.className = "term-english";
    english.textContent = term.english || "";

    const korean = document.createElement("div");
    korean.className = "term-korean";
    korean.textContent = term.korean || "";

    termItem.appendChild(english);
    termItem.appendChild(korean);
    termsList.appendChild(termItem);
  });
}

function setupSectionToggles() {
  const toggleButtons = document.querySelectorAll("[data-target]");

  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetName = button.dataset.target;
      const sectionBody = document.getElementById(`${targetName}-section-body`);

      if (!sectionBody) return;

      const isHidden = sectionBody.style.display === "none";
      sectionBody.style.display = isHidden ? "" : "none";
      button.textContent = isHidden ? "−" : "+";
    });
  });
}

function setupExplanationEditor(lectureId, slideIndex) {
  const editButton = document.querySelector('[data-action="edit-explanation"]');
  const targetElement = document.getElementById("explanation");

  if (!editButton || !targetElement) return;

  editButton.addEventListener("click", () => {
    if (targetElement.dataset.editing === "true") return;

    const originalText = targetElement.textContent;
    targetElement.dataset.editing = "true";
    targetElement.innerHTML = "";

    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = originalText === DEFAULT_EXPLANATION ? "" : originalText;

    const buttonRow = document.createElement("div");
    buttonRow.className = "edit-button-row";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "edit-action-button";
    saveButton.textContent = "저장";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "edit-action-button secondary";
    cancelButton.textContent = "취소";

    saveButton.addEventListener("click", () => {
      const newValue = textarea.value.trim() || DEFAULT_EXPLANATION;
      targetElement.textContent = newValue;
      targetElement.dataset.editing = "false";
      localStorage.setItem(getExplanationStorageKey(lectureId, slideIndex), newValue);
    });

    cancelButton.addEventListener("click", () => {
      targetElement.textContent = originalText;
      targetElement.dataset.editing = "false";
    });

    buttonRow.appendChild(saveButton);
    buttonRow.appendChild(cancelButton);
    targetElement.appendChild(textarea);
    targetElement.appendChild(buttonRow);
  });
}

function setupReviewEditor(lectureId, slideIndex) {
  const editButton = document.querySelector('[data-action="edit-review"]');
  const targetElement = document.getElementById("review");

  if (!editButton || !targetElement) return;

  editButton.addEventListener("click", () => {
    if (targetElement.dataset.editing === "true") return;

    const originalText = targetElement.textContent;
    targetElement.dataset.editing = "true";
    targetElement.innerHTML = "";

    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = originalText === DEFAULT_REVIEW ? "" : originalText;

    const buttonRow = document.createElement("div");
    buttonRow.className = "edit-button-row";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "edit-action-button";
    saveButton.textContent = "저장";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "edit-action-button secondary";
    cancelButton.textContent = "취소";

    saveButton.addEventListener("click", () => {
      const newValue = textarea.value.trim() || DEFAULT_REVIEW;
      targetElement.textContent = newValue;
      targetElement.dataset.editing = "false";
      localStorage.setItem(getReviewStorageKey(lectureId, slideIndex), newValue);
    });

    cancelButton.addEventListener("click", () => {
      targetElement.textContent = originalText;
      targetElement.dataset.editing = "false";
    });

    buttonRow.appendChild(saveButton);
    buttonRow.appendChild(cancelButton);
    targetElement.appendChild(textarea);
    targetElement.appendChild(buttonRow);
  });
}

function setupTermsEditor(lectureId, slideIndex) {
  const editButton = document.querySelector('[data-action="edit-terms"]');
  const termsList = document.getElementById("terms-list");

  if (!editButton || !termsList) return;

  editButton.addEventListener("click", () => {
    if (termsList.dataset.editing === "true") return;

    const originalTerms = Array.from(termsList.querySelectorAll(".term-item")).map(
      (item) => ({
        english: item.querySelector(".term-english")?.textContent || "",
        korean: item.querySelector(".term-korean")?.textContent || "",
      })
    );

    termsList.dataset.editing = "true";
    termsList.innerHTML = "";

    const editorWrap = document.createElement("div");
    editorWrap.className = "terms-editor-wrap";

    const rowsContainer = document.createElement("div");
    rowsContainer.className = "terms-editor-rows";

    function createTermRow(term = { english: "", korean: "" }) {
      const row = document.createElement("div");
      row.className = "term-edit-row";

      const englishInput = document.createElement("input");
      englishInput.type = "text";
      englishInput.className = "term-edit-input";
      englishInput.placeholder = "영어 용어";
      englishInput.value = term.english || "";

      const koreanInput = document.createElement("input");
      koreanInput.type = "text";
      koreanInput.className = "term-edit-input";
      koreanInput.placeholder = "한글 뜻";
      koreanInput.value = term.korean || "";

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "edit-action-button secondary";
      deleteButton.textContent = "삭제";

      deleteButton.addEventListener("click", () => {
        row.remove();
      });

      row.appendChild(englishInput);
      row.appendChild(koreanInput);
      row.appendChild(deleteButton);
      return row;
    }

    if (originalTerms.length === 0) {
      rowsContainer.appendChild(createTermRow());
    } else {
      originalTerms.forEach((term) => {
        rowsContainer.appendChild(createTermRow(term));
      });
    }

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "edit-action-button secondary";
    addButton.textContent = "용어 추가";

    addButton.addEventListener("click", () => {
      rowsContainer.appendChild(createTermRow());
    });

    const buttonRow = document.createElement("div");
    buttonRow.className = "edit-button-row";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "edit-action-button";
    saveButton.textContent = "저장";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "edit-action-button secondary";
    cancelButton.textContent = "취소";

    saveButton.addEventListener("click", () => {
      const rows = Array.from(rowsContainer.querySelectorAll(".term-edit-row"));
      const updatedTerms = rows
        .map((row) => {
          const inputs = row.querySelectorAll(".term-edit-input");
          return {
            english: inputs[0].value.trim(),
            korean: inputs[1].value.trim(),
          };
        })
        .filter((term) => term.english || term.korean);

      renderTermsList(termsList, updatedTerms);
      termsList.dataset.editing = "false";
      localStorage.setItem(
        getTermsStorageKey(lectureId, slideIndex),
        JSON.stringify(updatedTerms)
      );
    });

    cancelButton.addEventListener("click", () => {
      renderTermsList(termsList, originalTerms);
      termsList.dataset.editing = "false";
    });

    buttonRow.appendChild(saveButton);
    buttonRow.appendChild(cancelButton);
    editorWrap.appendChild(rowsContainer);
    editorWrap.appendChild(addButton);
    editorWrap.appendChild(buttonRow);
    termsList.appendChild(editorWrap);
  });
}

function setupEditsPreview(lectureId, slideIndex, result) {
  const button = document.getElementById("show-edits-button");
  const resetButton = document.getElementById("reset-edits-button");
  const preview = document.getElementById("edits-preview");

  if (!button || !preview) return;

  button.addEventListener("click", () => {
    const edits = getCurrentSlideEdits(lectureId, slideIndex, result);
    preview.textContent = JSON.stringify(edits, null, 2);

    if (preview.style.display === "none") {
      preview.style.display = "block";
      button.textContent = "숨기기";
    } else {
      preview.style.display = "none";
      button.textContent = "보기";
    }
  });

  if (!resetButton) return;

  resetButton.addEventListener("click", () => {
    const shouldReset = window.confirm(
      "현재 슬라이드의 설명, 복습, 핵심 용어 수정 내용을 초기화할까요?"
    );

    if (!shouldReset) return;

    clearSlideEdits(lectureId, slideIndex);
    window.location.reload();
  });
}

function renderLectureCatalog(catalog) {
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const backLink = document.getElementById("list-back-link");
  const listContent = document.getElementById("list-content");

  if (!pageTitle || !pageSubtitle || !backLink || !listContent) return;

  pageTitle.textContent = "강의 목록";
  pageSubtitle.textContent = "과목 아래의 강의를 선택하면 슬라이드 목록으로 이동합니다.";
  backLink.hidden = true;
  listContent.innerHTML = "";

  (catalog.subjects || []).forEach((subject) => {
    const subjectGroup = document.createElement("section");
    subjectGroup.className = "subject-group";

    const subjectTitle = document.createElement("h2");
    subjectTitle.className = "subject-title";
    subjectTitle.textContent = subject.title;
    subjectGroup.appendChild(subjectTitle);

    if (subject.description) {
      const subjectDescription = document.createElement("p");
      subjectDescription.className = "subject-description";
      subjectDescription.textContent = subject.description;
      subjectGroup.appendChild(subjectDescription);
    }

    const lectureList = document.createElement("div");
    lectureList.className = "slide-list";

    (subject.lectures || []).forEach((lecture) => {
      lectureList.appendChild(
        createSlideCard(
          lecture.title,
          buildLectureHref(lecture.id),
          lecture.description || "강의 슬라이드 목록 보기"
        )
      );
    });

    subjectGroup.appendChild(lectureList);
    listContent.appendChild(subjectGroup);
  });
}

async function renderLectureSlideList(lectureEntry) {
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const backLink = document.getElementById("list-back-link");
  const listContent = document.getElementById("list-content");

  if (!pageTitle || !pageSubtitle || !backLink || !listContent) return;

  const { subject, lecture } = lectureEntry;
  const data = await fetchJson(getLectureResultsPath(lecture));

  pageTitle.textContent = lecture.title;
  pageSubtitle.textContent = `${subject.title} > ${lecture.title}`;
  backLink.hidden = false;
  backLink.href = "index.html";
  listContent.innerHTML = "";

  const slideList = document.createElement("div");
  slideList.className = "slide-list";

  data.forEach((item, index) => {
    slideList.appendChild(
      createSlideCard(
        `slide${index + 1}`,
        buildViewerHref(lecture.id, index),
        item.file_name
      )
    );
  });

  listContent.appendChild(slideList);
}

async function loadIndexPage() {
  const listContent = document.getElementById("list-content");

  if (!listContent) return;

  const catalog = await loadCatalog();
  const params = new URLSearchParams(window.location.search);
  const lectureId = params.get("lecture");

  if (!lectureId) {
    renderLectureCatalog(catalog);
    return;
  }

  const lectureEntry =
    findLectureById(catalog, lectureId) || getDefaultLecture(catalog);

  if (!lectureEntry) {
    listContent.innerHTML = "";
    listContent.appendChild(createEmptyState("표시할 강의가 없습니다."));
    return;
  }

  await renderLectureSlideList(lectureEntry);
}

async function loadSlideDetail() {
  const slideImage = document.getElementById("slide-image");

  if (!slideImage) return null;

  const catalog = await loadCatalog();
  const params = new URLSearchParams(window.location.search);
  const lectureId = params.get("lecture");
  const lectureEntry =
    findLectureById(catalog, lectureId) || getDefaultLecture(catalog);

  if (!lectureEntry) {
    alert("표시할 강의가 없습니다.");
    window.location.href = "index.html";
    return null;
  }

  const { subject, lecture } = lectureEntry;
  const data = await fetchJson(getLectureResultsPath(lecture));
  const index = Number(params.get("index"));

  if (Number.isNaN(index) || index < 0 || index >= data.length) {
    alert("올바르지 않은 슬라이드 접근입니다.");
    window.location.href = buildLectureHref(lecture.id);
    return null;
  }

  const item = data[index];
  const result = item.result || {};
  const edits = getCurrentSlideEdits(lecture.id, index, result);

  const viewerBackLink = document.getElementById("viewer-back-link");
  const lecturePath = document.getElementById("lecture-path");
  const slidePosition = document.getElementById("slide-position");
  const termsList = document.getElementById("terms-list");
  const explanation = document.getElementById("explanation");
  const review = document.getElementById("review");
  const prevButton = document.getElementById("prev-button");
  const nextButton = document.getElementById("next-button");

  if (viewerBackLink) {
    viewerBackLink.href = buildLectureHref(lecture.id);
  }

  if (lecturePath) {
    lecturePath.textContent = `${subject.title} > ${lecture.title}`;
  }

  slidePosition.textContent = `${index + 1} / ${data.length}`;
  slideImage.src = `${getLectureSlidesPath(lecture)}/${item.file_name}`;
  slideImage.alt = item.file_name;

  renderTermsList(termsList, edits.terms);
  explanation.textContent = edits.explanation;

  if (review) {
    review.textContent = edits.review;
  }

  if (index > 0) {
    prevButton.href = buildViewerHref(lecture.id, index - 1);
    prevButton.classList.remove("disabled");
  } else {
    prevButton.removeAttribute("href");
    prevButton.classList.add("disabled");
  }

  if (index < data.length - 1) {
    nextButton.href = buildViewerHref(lecture.id, index + 1);
    nextButton.classList.remove("disabled");
  } else {
    nextButton.removeAttribute("href");
    nextButton.classList.add("disabled");
  }

  return { index, lectureId: lecture.id, result };
}

loadIndexPage();
loadSlideDetail().then((slideInfo) => {
  if (!slideInfo) return;

  setupSectionToggles();
  setupExplanationEditor(slideInfo.lectureId, slideInfo.index);
  setupReviewEditor(slideInfo.lectureId, slideInfo.index);
  setupTermsEditor(slideInfo.lectureId, slideInfo.index);
  setupEditsPreview(slideInfo.lectureId, slideInfo.index, slideInfo.result);
});
