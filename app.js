async function loadData() {
  const response = await fetch("results.json");
  return await response.json();
}

function getReviewStorageKey(index) {
  return `slide_review_${index}`;
}

function getExplanationStorageKey(index) {
  return `slide_explanation_${index}`;
}

function getTermsStorageKey(index) {
  return `slide_terms_${index}`;
}

function getSavedReview(index, defaultValue) {
  const saved = localStorage.getItem(getReviewStorageKey(index));
  return saved !== null ? saved : defaultValue;
}

function getSavedExplanation(index, defaultValue) {
  const saved = localStorage.getItem(getExplanationStorageKey(index));
  return saved !== null ? saved : defaultValue;
}

function getSavedTerms(index, defaultTerms) {
  const saved = localStorage.getItem(getTermsStorageKey(index));

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

function getCurrentSlideEdits(index, result) {
  return {
    explanation: getSavedExplanation(
      index,
      result.explanation || "설명이 없습니다."
    ),
    review: getSavedReview(
      index,
      result.review || "아직 작성된 복습 내용이 없습니다."
    ),
    terms: getSavedTerms(index, result.terms || []),
  };
}

function clearSlideEdits(index) {
  localStorage.removeItem(getExplanationStorageKey(index));
  localStorage.removeItem(getReviewStorageKey(index));
  localStorage.removeItem(getTermsStorageKey(index));
}

function setupSectionToggles() {
  const toggleButtons = document.querySelectorAll("[data-target]");

  toggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetName = button.dataset.target;
      const sectionBody = document.getElementById(`${targetName}-section-body`);

      if (!sectionBody) return;

      const isHidden = sectionBody.style.display === "none";

      if (isHidden) {
        sectionBody.style.display = "";
        button.textContent = "−";
      } else {
        sectionBody.style.display = "none";
        button.textContent = "+";
      }
    });
  });
}

function setupExplanationEditor(slideIndex) {
  const editButton = document.querySelector('[data-action="edit-explanation"]');
  const targetElement = document.getElementById("explanation");
  const emptyFallback = "설명이 없습니다.";

  if (!editButton || !targetElement) return;

  editButton.addEventListener("click", () => {
    if (targetElement.dataset.editing === "true") return;

    const originalText = targetElement.textContent;
    targetElement.dataset.editing = "true";

    targetElement.innerHTML = "";

    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = originalText === emptyFallback ? "" : originalText;

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
      const newValue = textarea.value.trim() || emptyFallback;
      targetElement.textContent = newValue;
      targetElement.dataset.editing = "false";
      localStorage.setItem(getExplanationStorageKey(slideIndex), newValue);
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

function setupReviewEditor(slideIndex) {
  const editButton = document.querySelector('[data-action="edit-review"]');
  const targetElement = document.getElementById("review");
  const emptyFallback = "아직 작성된 복습 내용이 없습니다.";

  if (!editButton || !targetElement) return;

  editButton.addEventListener("click", () => {
    if (targetElement.dataset.editing === "true") return;

    const originalText = targetElement.textContent;
    targetElement.dataset.editing = "true";

    targetElement.innerHTML = "";

    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = originalText === emptyFallback ? "" : originalText;

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
      const newValue = textarea.value.trim() || emptyFallback;
      targetElement.textContent = newValue;
      targetElement.dataset.editing = "false";
      localStorage.setItem(getReviewStorageKey(slideIndex), newValue);
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

function renderTermsList(termsList, terms) {
  termsList.innerHTML = "";

  if (!terms || terms.length === 0) {
    const emptyText = document.createElement("div");
    emptyText.className = "empty-text";
    emptyText.textContent = "표시할 핵심 용어가 없습니다.";
    termsList.appendChild(emptyText);
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

function setupTermsEditor(slideIndex) {
  const editButton = document.querySelector('[data-action="edit-terms"]');
  const termsList = document.getElementById("terms-list");

  if (!editButton || !termsList) return;

  editButton.addEventListener("click", () => {
    if (termsList.dataset.editing === "true") return;

    const originalTerms = Array.from(
      termsList.querySelectorAll(".term-item")
    ).map((item) => {
      const english = item.querySelector(".term-english")?.textContent || "";
      const korean = item.querySelector(".term-korean")?.textContent || "";
      return { english, korean };
    });

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
      koreanInput.placeholder = "한국어 뜻";
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
    addButton.textContent = "단어 추가";

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
        getTermsStorageKey(slideIndex),
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

function setupEditsPreview(slideIndex, result) {
  const button = document.getElementById("show-edits-button");
  const resetButton = document.getElementById("reset-edits-button");
  const preview = document.getElementById("edits-preview");

  if (!button || !preview) return;

  button.addEventListener("click", () => {
    const edits = getCurrentSlideEdits(slideIndex, result);
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

    clearSlideEdits(slideIndex);
    window.location.reload();
  });
}

async function loadSlideList() {
  const data = await loadData();
  const slideList = document.getElementById("slide-list");

  if (!slideList) return;

  data.forEach((item, index) => {
    const slideNumber = index + 1;

    const link = document.createElement("a");
    link.href = `viewer.html?index=${index}`;
    link.className = "slide-link";
    link.textContent = `slide${slideNumber}`;

    slideList.appendChild(link);
  });
}

async function loadSlideDetail() {
  const slideImage = document.getElementById("slide-image");
  if (!slideImage) return null;

  const data = await loadData();

  const params = new URLSearchParams(window.location.search);
  const index = Number(params.get("index"));

  if (isNaN(index) || index < 0 || index >= data.length) {
    alert("잘못된 슬라이드 접근입니다.");
    window.location.href = "index.html";
    return null;
  }

  const item = data[index];
  const result = item.result;
  const edits = getCurrentSlideEdits(index, result);

  const slidePosition = document.getElementById("slide-position");
  const termsList = document.getElementById("terms-list");
  const explanation = document.getElementById("explanation");
  const review = document.getElementById("review");
  const prevButton = document.getElementById("prev-button");
  const nextButton = document.getElementById("next-button");

  slidePosition.textContent = `${index + 1} / ${data.length}`;
  slideImage.src = `slides/${item.file_name}`;
  slideImage.alt = item.file_name;

  renderTermsList(termsList, edits.terms);
  explanation.textContent = edits.explanation;

  if (review) {
    review.textContent = edits.review;
  }

  if (index > 0) {
    prevButton.href = `viewer.html?index=${index - 1}`;
    prevButton.classList.remove("disabled");
  } else {
    prevButton.removeAttribute("href");
    prevButton.classList.add("disabled");
  }

  if (index < data.length - 1) {
    nextButton.href = `viewer.html?index=${index + 1}`;
    nextButton.classList.remove("disabled");
  } else {
    nextButton.removeAttribute("href");
    nextButton.classList.add("disabled");
  }

  return { index, result };
}

loadSlideList();
loadSlideDetail().then((slideInfo) => {
  if (!slideInfo) return;

  setupSectionToggles();
  setupExplanationEditor(slideInfo.index);
  setupReviewEditor(slideInfo.index);
  setupTermsEditor(slideInfo.index);
  setupEditsPreview(slideInfo.index, slideInfo.result);
});
