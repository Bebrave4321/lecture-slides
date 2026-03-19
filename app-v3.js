const LECTURES_PATH = "lectures.json";
const lectureSupabaseEditsCache = new Map();
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

function getDefaultSubject(catalog) {
  return (catalog.subjects || [])[0] || null;
}

function findSubjectById(catalog, subjectId) {
  return (catalog.subjects || []).find((subject) => subject.id === subjectId) || null;
}

function getDefaultLecture(subject) {
  return (subject?.lectures || [])[0] || null;
}

function findLectureById(subject, lectureId) {
  return (subject?.lectures || []).find((lecture) => lecture.id === lectureId) || null;
}

function getLectureResultsPath(lecture) {
  return lecture.resultsPath || "results.json";
}

function getLectureSlidesPath(lecture) {
  return lecture.slidesPath || "slides";
}

function buildSubjectHref(subjectId) {
  return `index.html?subject=${encodeURIComponent(subjectId)}`;
}

function buildLectureHref(subjectId, lectureId) {
  return `index.html?subject=${encodeURIComponent(subjectId)}&lecture=${encodeURIComponent(
    lectureId
  )}`;
}

function buildViewerHref(subjectId, lectureId, index) {
  return `viewer.html?subject=${encodeURIComponent(
    subjectId
  )}&lecture=${encodeURIComponent(lectureId)}&index=${index}`;
}

function getStoragePrefix(subjectId, lectureId) {
  return `${subjectId}__${lectureId}`;
}

function getLectureCacheKey(subjectId, lectureId) {
  return `${subjectId}__${lectureId}`;
}

function getReviewStorageKey(subjectId, lectureId, index) {
  return `${getStoragePrefix(subjectId, lectureId)}__slide_review_${index}`;
}

function getExplanationStorageKey(subjectId, lectureId, index) {
  return `${getStoragePrefix(subjectId, lectureId)}__slide_explanation_${index}`;
}

function getTermsStorageKey(subjectId, lectureId, index) {
  return `${getStoragePrefix(subjectId, lectureId)}__slide_terms_${index}`;
}

function getLectureSupabaseEdit(subjectId, lectureId, index) {
  const lectureEdits = lectureSupabaseEditsCache.get(
    getLectureCacheKey(subjectId, lectureId)
  );

  if (!lectureEdits) {
    return null;
  }

  return lectureEdits.get(index) || null;
}

function hasSavedExplanation(subjectId, lectureId, index) {
  return localStorage.getItem(getExplanationStorageKey(subjectId, lectureId, index)) !== null;
}

function hasSavedReview(subjectId, lectureId, index) {
  return localStorage.getItem(getReviewStorageKey(subjectId, lectureId, index)) !== null;
}

function hasSavedTerms(subjectId, lectureId, index) {
  return localStorage.getItem(getTermsStorageKey(subjectId, lectureId, index)) !== null;
}

function getSavedReview(subjectId, lectureId, index, defaultValue) {
  const saved = localStorage.getItem(getReviewStorageKey(subjectId, lectureId, index));

  if (saved !== null) {
    return saved;
  }

  const supabaseEdit = getLectureSupabaseEdit(subjectId, lectureId, index);
  return supabaseEdit?.review ?? defaultValue;
}

function getSavedExplanation(subjectId, lectureId, index, defaultValue) {
  const saved = localStorage.getItem(getExplanationStorageKey(subjectId, lectureId, index));

  if (saved !== null) {
    return saved;
  }

  const supabaseEdit = getLectureSupabaseEdit(subjectId, lectureId, index);
  return supabaseEdit?.explanation ?? defaultValue;
}

function getSavedTerms(subjectId, lectureId, index, defaultTerms) {
  const saved = localStorage.getItem(getTermsStorageKey(subjectId, lectureId, index));

  if (saved === null) {
    const supabaseEdit = getLectureSupabaseEdit(subjectId, lectureId, index);
    return Array.isArray(supabaseEdit?.terms) ? supabaseEdit.terms : defaultTerms;
  }

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : defaultTerms;
  } catch (error) {
    return defaultTerms;
  }
}

function getCurrentSlideEdits(subjectId, lectureId, index, result) {
  return {
    explanation: getSavedExplanation(
      subjectId,
      lectureId,
      index,
      result.explanation || DEFAULT_EXPLANATION
    ),
    review: getSavedReview(
      subjectId,
      lectureId,
      index,
      result.review || DEFAULT_REVIEW
    ),
    terms: getSavedTerms(subjectId, lectureId, index, result.terms || []),
  };
}

function buildSlideEditRecord(subjectId, lectureId, index, item) {
  const result = item.result || {};
  const edits = getCurrentSlideEdits(subjectId, lectureId, index, result);

  return {
    slideIndex: index,
    fileName: item.file_name,
    explanation: edits.explanation,
    review: edits.review,
    terms: edits.terms,
  };
}

function buildLectureEditsPayload(subject, lecture, data) {
  const slides = data.map((item, index) =>
    buildSlideEditRecord(subject.id, lecture.id, index, item)
  );

  return {
    subjectId: subject.id,
    subjectTitle: subject.title,
    lectureId: lecture.id,
    lectureTitle: lecture.title,
    resultsPath: getLectureResultsPath(lecture),
    slidesPath: getLectureSlidesPath(lecture),
    slideCount: slides.length,
    slides,
  };
}

function buildMergedLectureResults(data, lectureEditsPayload) {
  return data.map((item, index) => {
    const slideEdit = lectureEditsPayload.slides[index];
    const result = item.result || {};

    return {
      ...item,
      result: {
        ...result,
        explanation: slideEdit.explanation,
        review: slideEdit.review,
        terms: slideEdit.terms,
      },
    };
  });
}

function hasSlideEditChanges(result, slideEditRecord) {
  const explanation = result.explanation || DEFAULT_EXPLANATION;
  const review = result.review || DEFAULT_REVIEW;
  const terms = Array.isArray(result.terms) ? result.terms : [];

  return (
    explanation !== slideEditRecord.explanation ||
    review !== slideEditRecord.review ||
    JSON.stringify(terms) !== JSON.stringify(slideEditRecord.terms)
  );
}

function buildChangedLectureSlideRows(subject, lecture, data) {
  return data
    .map((item, index) => {
      const slideEditRecord = buildSlideEditRecord(subject.id, lecture.id, index, item);
      const result = item.result || {};

      if (!hasSlideEditChanges(result, slideEditRecord)) {
        return null;
      }

      return {
        subject_id: subject.id,
        subject_title: subject.title,
        lecture_id: lecture.id,
        lecture_title: lecture.title,
        slide_index: slideEditRecord.slideIndex,
        file_name: slideEditRecord.fileName,
        explanation: slideEditRecord.explanation,
        review: slideEditRecord.review,
        terms: slideEditRecord.terms,
      };
    })
    .filter(Boolean);
}

function getSupabaseConfig() {
  return window.SLIDE_SUPABASE_CONFIG || null;
}

function hasSupabaseConfig(config) {
  return Boolean(config?.url && config?.anonKey && config?.table);
}

function createSupabaseClientOrNull() {
  const config = getSupabaseConfig();

  if (
    !hasSupabaseConfig(config) ||
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    return null;
  }

  return window.supabase.createClient(config.url, config.anonKey);
}

async function loadLectureEditsFromSupabase(subject, lecture) {
  const config = getSupabaseConfig();
  const supabase = createSupabaseClientOrNull();
  const cacheKey = getLectureCacheKey(subject.id, lecture.id);

  if (!supabase || !config) {
    lectureSupabaseEditsCache.set(cacheKey, new Map());
    return new Map();
  }

  const { data, error } = await supabase
    .from(config.table)
    .select("slide_index, file_name, explanation, review, terms")
    .eq("subject_id", subject.id)
    .eq("lecture_id", lecture.id);

  if (error) {
    throw error;
  }

  const lectureEdits = new Map();

  (data || []).forEach((row) => {
    lectureEdits.set(row.slide_index, {
      slideIndex: row.slide_index,
      fileName: row.file_name,
      explanation: row.explanation,
      review: row.review,
      terms: Array.isArray(row.terms) ? row.terms : [],
    });
  });

  lectureSupabaseEditsCache.set(cacheKey, lectureEdits);
  return lectureEdits;
}

async function tryLoadLectureEditsFromSupabase(subject, lecture) {
  try {
    return await loadLectureEditsFromSupabase(subject, lecture);
  } catch (error) {
    lectureSupabaseEditsCache.set(getLectureCacheKey(subject.id, lecture.id), new Map());
    return new Map();
  }
}

const lectureAutoSaveTimers = new Map();

function scheduleLectureAutoSave(subject, lecture) {
  const cacheKey = getLectureCacheKey(subject.id, lecture.id);
  const existingTimer = lectureAutoSaveTimers.get(cacheKey);

  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timerId = window.setTimeout(async () => {
    lectureAutoSaveTimers.delete(cacheKey);

    try {
      await saveLectureEditsToSupabase(subject, lecture);
    } catch (error) {
      console.error("Auto save to Supabase failed:", error);
    }
  }, 500);

  lectureAutoSaveTimers.set(cacheKey, timerId);
}

async function saveLectureEditsToSupabase(subject, lecture) {
  const config = getSupabaseConfig();
  const supabase = createSupabaseClientOrNull();

  if (!supabase || !config) {
    throw new Error("Supabase 설정이 비어 있습니다.");
  }

  const data = await fetchJson(getLectureResultsPath(lecture));
  const changedRows = buildChangedLectureSlideRows(subject, lecture, data);

  const deleteQuery = supabase
    .from(config.table)
    .delete()
    .eq("subject_id", subject.id)
    .eq("lecture_id", lecture.id);

  const { error: deleteError } = await deleteQuery;

  if (deleteError) {
    throw deleteError;
  }

  if (changedRows.length === 0) {
    await loadLectureEditsFromSupabase(subject, lecture);
    return { savedCount: 0 };
  }

  const { error: insertError } = await supabase.from(config.table).insert(changedRows);

  if (insertError) {
    throw insertError;
  }

  await loadLectureEditsFromSupabase(subject, lecture);
  return { savedCount: changedRows.length };
}

function clearSlideEdits(subjectId, lectureId, index) {
  localStorage.removeItem(getExplanationStorageKey(subjectId, lectureId, index));
  localStorage.removeItem(getReviewStorageKey(subjectId, lectureId, index));
  localStorage.removeItem(getTermsStorageKey(subjectId, lectureId, index));
}

function createEmptyState(text) {
  const emptyText = document.createElement("div");
  emptyText.className = "empty-text";
  emptyText.textContent = text;
  return emptyText;
}

function getOrCreateListBackLink() {
  let backLink = document.getElementById("list-back-link");

  if (backLink) {
    return backLink;
  }

  const pageTitle = document.getElementById("page-title");

  if (!pageTitle || !pageTitle.parentElement) {
    return null;
  }

  backLink = document.createElement("a");
  backLink.id = "list-back-link";
  backLink.className = "back-link list-back-link";
  pageTitle.insertAdjacentElement("afterend", backLink);

  return backLink;
}

function createListCard(title, href, metaText) {
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

function createLectureCard(subject, lecture) {
  const card = document.createElement("div");
  card.className = "lecture-card";

  const link = createListCard(
    lecture.title,
    buildLectureHref(subject.id, lecture.id),
    lecture.description || "강의의 슬라이드 목록 보기"
  );

  const actions = document.createElement("div");
  actions.className = "lecture-card-actions";

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "lecture-download-button";
  downloadButton.textContent = "수정 반영 JSON";

  downloadButton.addEventListener("click", async () => {
    downloadButton.disabled = true;

    try {
      await downloadMergedLectureJson(subject, lecture);
    } finally {
      downloadButton.disabled = false;
    }
  });

  actions.appendChild(downloadButton);
  card.appendChild(link);
  card.appendChild(actions);

  return card;
}

async function downloadMergedLectureJson(subject, lecture) {
  const data = await fetchJson(getLectureResultsPath(lecture));
  await tryLoadLectureEditsFromSupabase(subject, lecture);
  const lectureEditsPayload = buildLectureEditsPayload(subject, lecture, data);
  const mergedData = buildMergedLectureResults(data, lectureEditsPayload);

  const blob = new Blob([JSON.stringify(mergedData, null, 2)], {
    type: "application/json",
  });

  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeSubject = subject.id || "subject";
  const safeLecture = lecture.id || "lecture";

  anchor.href = downloadUrl;
  anchor.download = `${safeSubject}-${safeLecture}-merged-results.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
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

function reorderDetailSections() {
  const slideSection = document.getElementById("slide-section-body")?.closest(".content-block");
  const explanationSection = document
    .getElementById("explanation-section-body")
    ?.closest(".content-block");
  const reviewSection = document.getElementById("review-section-body")?.closest(".content-block");
  const termsSection = document.getElementById("terms-section-body")?.closest(".content-block");

  if (!slideSection || !explanationSection || !reviewSection || !termsSection) {
    return;
  }

  slideSection.insertAdjacentElement("afterend", explanationSection);
  explanationSection.insertAdjacentElement("afterend", reviewSection);
  reviewSection.insertAdjacentElement("afterend", termsSection);
}

function setupExplanationEditor(subject, lecture, slideIndex) {
  const subjectId = subject.id;
  const lectureId = lecture.id;
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
      localStorage.setItem(
        getExplanationStorageKey(subjectId, lectureId, slideIndex),
        newValue
      );
      scheduleLectureAutoSave(subject, lecture);
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

function setupReviewEditor(subject, lecture, slideIndex) {
  const subjectId = subject.id;
  const lectureId = lecture.id;
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
      localStorage.setItem(getReviewStorageKey(subjectId, lectureId, slideIndex), newValue);
      scheduleLectureAutoSave(subject, lecture);
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

function setupTermsEditor(subject, lecture, slideIndex) {
  const subjectId = subject.id;
  const lectureId = lecture.id;
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
        getTermsStorageKey(subjectId, lectureId, slideIndex),
        JSON.stringify(updatedTerms)
      );
      scheduleLectureAutoSave(subject, lecture);
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

function setupSlideJump(subjectId, lectureId, totalSlides, currentIndex) {
  const form = document.getElementById("slide-jump-form");
  const input = document.getElementById("slide-jump-input");

  if (!form || !input) return;

  input.min = "1";
  input.max = String(totalSlides);
  input.value = String(currentIndex + 1);

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const nextSlideNumber = Number(input.value);

    if (
      Number.isNaN(nextSlideNumber) ||
      nextSlideNumber < 1 ||
      nextSlideNumber > totalSlides
    ) {
      input.focus();
      input.select();
      return;
    }

    window.location.href = buildViewerHref(subjectId, lectureId, nextSlideNumber - 1);
  });
}

function renderSubjectList(catalog) {
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const backLink = document.getElementById("list-back-link");
  const listContent = document.getElementById("list-content");

  if (!pageTitle || !pageSubtitle || !listContent) return;

  pageTitle.textContent = "과목 목록";
  pageSubtitle.textContent = "과목을 선택하면 해당 과목의 강의 목록으로 이동합니다.";
  if (backLink) {
    backLink.remove();
  }
  listContent.innerHTML = "";

  const subjectList = document.createElement("div");
  subjectList.className = "slide-list";

  (catalog.subjects || []).forEach((subject) => {
    subjectList.appendChild(
      createListCard(
        subject.title,
        buildSubjectHref(subject.id),
        subject.description || "과목의 강의 목록 보기"
      )
    );
  });

  listContent.appendChild(subjectList);
}

function renderLectureList(subject) {
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const backLink = getOrCreateListBackLink();
  const listContent = document.getElementById("list-content");

  if (!pageTitle || !pageSubtitle || !backLink || !listContent) return;

  pageTitle.textContent = "강의 목록";
  pageSubtitle.textContent = subject.title;
  backLink.hidden = false;
  backLink.href = "index.html";
  backLink.textContent = "과목 목록으로";
  listContent.innerHTML = "";

  const lectureList = document.createElement("div");
  lectureList.className = "slide-list";

  (subject.lectures || []).forEach((lecture) => {
    lectureList.appendChild(createLectureCard(subject, lecture));
  });

  listContent.appendChild(lectureList);
}

async function renderSlideList(subject, lecture) {
  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const backLink = getOrCreateListBackLink();
  const listContent = document.getElementById("list-content");

  if (!pageTitle || !pageSubtitle || !backLink || !listContent) return;

  const data = await fetchJson(getLectureResultsPath(lecture));

  pageTitle.textContent = "슬라이드 목록";
  pageSubtitle.textContent = `${subject.title} > ${lecture.title}`;
  backLink.hidden = false;
  backLink.href = buildSubjectHref(subject.id);
  backLink.textContent = "강의 목록으로";
  listContent.innerHTML = "";

  const slideList = document.createElement("div");
  slideList.className = "slide-list";

  data.forEach((item, index) => {
    slideList.appendChild(
      createListCard(
        `slide${index + 1}`,
        buildViewerHref(subject.id, lecture.id, index),
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
  const subjectId = params.get("subject");
  const lectureId = params.get("lecture");

  if (!subjectId) {
    renderSubjectList(catalog);
    return;
  }

  const subject = findSubjectById(catalog, subjectId) || getDefaultSubject(catalog);

  if (!subject) {
    listContent.innerHTML = "";
    listContent.appendChild(createEmptyState("표시할 과목이 없습니다."));
    return;
  }

  if (!lectureId) {
    renderLectureList(subject);
    return;
  }

  const lecture = findLectureById(subject, lectureId) || getDefaultLecture(subject);

  if (!lecture) {
    listContent.innerHTML = "";
    listContent.appendChild(createEmptyState("표시할 강의가 없습니다."));
    return;
  }

  await renderSlideList(subject, lecture);
}

async function loadSlideDetail() {
  const slideImage = document.getElementById("slide-image");

  if (!slideImage) return null;

  const catalog = await loadCatalog();
  const params = new URLSearchParams(window.location.search);
  const subjectId = params.get("subject");
  const lectureId = params.get("lecture");
  const subject = findSubjectById(catalog, subjectId) || getDefaultSubject(catalog);

  if (!subject) {
    alert("표시할 과목이 없습니다.");
    window.location.href = "index.html";
    return null;
  }

  const lecture = findLectureById(subject, lectureId) || getDefaultLecture(subject);

  if (!lecture) {
    alert("표시할 강의가 없습니다.");
    window.location.href = buildSubjectHref(subject.id);
    return null;
  }

  const data = await fetchJson(getLectureResultsPath(lecture));
  await tryLoadLectureEditsFromSupabase(subject, lecture);
  const index = Number(params.get("index"));

  if (Number.isNaN(index) || index < 0 || index >= data.length) {
    alert("올바르지 않은 슬라이드 접근입니다.");
    window.location.href = buildLectureHref(subject.id, lecture.id);
    return null;
  }

  const item = data[index];
  const result = item.result || {};
  const edits = getCurrentSlideEdits(subject.id, lecture.id, index, result);

  const viewerBackLink = document.getElementById("viewer-back-link");
  const lecturePath = document.getElementById("lecture-path");
  const slidePosition = document.getElementById("slide-position");
  const termsList = document.getElementById("terms-list");
  const explanation = document.getElementById("explanation");
  const review = document.getElementById("review");
  const prevButton = document.getElementById("prev-button");
  const nextButton = document.getElementById("next-button");

  if (viewerBackLink) {
    viewerBackLink.href = buildLectureHref(subject.id, lecture.id);
    viewerBackLink.textContent = "슬라이드 목록";
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
    prevButton.href = buildViewerHref(subject.id, lecture.id, index - 1);
    prevButton.classList.remove("disabled");
  } else {
    prevButton.removeAttribute("href");
    prevButton.classList.add("disabled");
  }

  if (index < data.length - 1) {
    nextButton.href = buildViewerHref(subject.id, lecture.id, index + 1);
    nextButton.classList.remove("disabled");
  } else {
    nextButton.removeAttribute("href");
    nextButton.classList.add("disabled");
  }

  setupSlideJump(subject.id, lecture.id, data.length, index);

  return { index, subjectId: subject.id, lectureId: lecture.id, result, item, subject, lecture };
}

loadIndexPage();
loadSlideDetail().then((slideInfo) => {
  if (!slideInfo) return;

  reorderDetailSections();
  setupSectionToggles();
  setupExplanationEditor(slideInfo.subject, slideInfo.lecture, slideInfo.index);
  setupReviewEditor(slideInfo.subject, slideInfo.lecture, slideInfo.index);
  setupTermsEditor(slideInfo.subject, slideInfo.lecture, slideInfo.index);
});
