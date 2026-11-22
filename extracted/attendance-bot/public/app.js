const state = {
  uploadId: null,
  lobs: [],
  selectedLobs: [],
  analysis: null,
  activeTab: "approved",
  selectedCategories: [],
  chatContext: {
    agentName: null,
  },
  cardIndex: new Map(),
};

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("sei-attendance-theme", theme);

  const button = $("#theme-toggle");
  button.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
}

function initTheme() {
  const savedTheme = localStorage.getItem("sei-attendance-theme") || "light";
  setTheme(savedTheme);

  $("#theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "dark" ? "light" : "dark");
  });
}

/* ---------- Collapsible upload details panel ---------- */

function toggleUploadDetails() {
  const panel = $("#warnings-panel");
  if (!panel) return;

  const isOpen = panel.classList.toggle("open");

  const toggle = $("#warnings-toggle");
  const label = $("#warnings-toggle-label");

  if (toggle) toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (label)
    label.textContent = isOpen ? "Hide upload details" : "Show upload details";
}

function openUploadDetails() {
  const panel = $("#warnings-panel");
  const toggle = $("#warnings-toggle");
  const label = $("#warnings-toggle-label");

  if (panel) panel.classList.add("open");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  if (label) label.textContent = "Hide upload details";
}

function setUploadStatus(text) {
  const panel = $("#warnings-panel");
  const status = $("#file-status");

  if (panel) panel.classList.remove("hidden");
  if (status) status.textContent = text;

  openUploadDetails();
}

function renderWarnings(warnings = []) {
  const panel = $("#warnings-panel");
  const container = $("#warnings");
  const countBadge = $("#warnings-count");

  if (!panel || !container) return;

  if (countBadge) countBadge.textContent = String(warnings.length);

  if (!warnings.length) {
    container.innerHTML = "";
    return;
  }

  panel.classList.remove("hidden");

  container.innerHTML = warnings
    .map((warning) => `<div class="warning-item">${escapeHtml(warning)}</div>`)
    .join("");
}

/* ---------- LOB controls ---------- */

function renderLobs() {
  const container = $("#lob-list");
  container.innerHTML = "";

  const allLabel = document.createElement("label");
  allLabel.className = "lob-item";

  const allCheckbox = document.createElement("input");
  allCheckbox.type = "checkbox";
  allCheckbox.checked = state.selectedLobs.length === 0;

  allCheckbox.addEventListener("change", () => {
    state.selectedLobs = [];
    renderLobs();
    analyzeWorkbook();
  });

  allLabel.appendChild(allCheckbox);
  allLabel.appendChild(document.createTextNode("All LOBs"));
  container.appendChild(allLabel);

  for (const lob of state.lobs) {
    const label = document.createElement("label");
    label.className = "lob-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedLobs.includes(lob);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (!state.selectedLobs.includes(lob)) {
          state.selectedLobs.push(lob);
        }
      } else {
        state.selectedLobs = state.selectedLobs.filter((item) => item !== lob);
      }

      renderLobs();
      analyzeWorkbook();
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(lob));
    container.appendChild(label);
  }
}

/* ---------- Dashboard ---------- */

function renderSummary() {
  const summary = state.analysis?.summary;

  $("#totalAgents").textContent = summary?.totalAgents ?? 0;
  $("#affectedAgents").textContent = summary?.affectedAgents ?? 0;
  $("#lateInCount").textContent = summary?.counts?.lateIn ?? 0;
  $("#earlyOutCount").textContent = summary?.counts?.earlyOut ?? 0;
  $("#overtimeCount").textContent = summary?.counts?.overtime ?? 0;
  $("#staffedCount").textContent = summary?.counts?.staffedVariance ?? 0;
  $("#pendingCount").textContent = summary?.counts?.pendingReview ?? 0;
  $("#approvedCount").textContent = summary?.counts?.approvedExceptions ?? 0;

  const tbody = $("#lob-summary-table tbody");
  tbody.innerHTML = "";

  if (!summary?.byLob?.length) {
    tbody.innerHTML = '<tr><td colspan="9">No LOB data available.</td></tr>';
    return;
  }

  for (const lob of summary.byLob) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${escapeHtml(lob.lob)}</td>
      <td>${lob.agents}</td>
      <td>${lob.exceptions}</td>
      <td>${lob.approvedExceptions}</td>
      <td>${lob.pendingReview}</td>
      <td>${lob.earlyOut}</td>
      <td>${lob.overtime}</td>
      <td>${lob.lateIn}</td>
      <td>${lob.staffedVariance}</td>
    `;

    tbody.appendChild(row);
  }
}

/* ---------- Cards ---------- */

function field(label, value) {
  if (!value && value !== 0) return "";

  return `
    <div>
      <div class="field-label">${escapeHtml(label)}</div>
      <div class="field-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function findingToText(finding) {
  const lines = [];

  lines.push(`Agent: ${finding.agentName}`);
  lines.push(`LOB: ${finding.lob}`);
  lines.push(`Worksheet: ${finding.sheet} (row ${finding.row})`);
  lines.push(`Issue: ${finding.issue}`);

  if (finding.actual) lines.push(`Actual: ${finding.actual}`);
  if (finding.scheduled) lines.push(`Scheduled: ${finding.scheduled}`);
  if (finding.diffDisplay) lines.push(`Difference: ${finding.diffDisplay}`);

  lines.push(`Approval: ${finding.approvalStatus}`);

  if (finding.comments) lines.push(`Comments: ${finding.comments}`);
  if (finding.wfmComments) lines.push(`WFM Comments: ${finding.wfmComments}`);

  if (finding.warnings?.length) {
    lines.push(`Warnings: ${finding.warnings.join(" ")}`);
  }

  lines.push(`Action: ${finding.action}`);

  return lines.join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  }
}

function findingCard(finding) {
  state.cardIndex.set(finding.id, finding);

  const approvalColor = finding.approved
    ? "green"
    : finding.approvalStatus === "No"
      ? "red"
      : "gray";

  const warnings = finding.warnings?.length
    ? `<div class="warning-box">${finding.warnings.map(escapeHtml).join("<br>")}</div>`
    : "";

  return `
    <article class="card border-${finding.color}">
      <div class="card-header">
        <div class="card-title">${escapeHtml(finding.agentName)}</div>
      </div>

      <div class="badges">
        <span class="badge bg-${finding.color}">${escapeHtml(finding.issue)}</span>
        <span class="badge bg-${approvalColor}">Approval: ${escapeHtml(finding.approvalStatus)}</span>
        <span class="badge bg-gray">${escapeHtml(finding.sheet)} row ${finding.row}</span>
      </div>

      <div class="card-grid">
        ${field("LOB", finding.lob)}
        ${field("Team Leader", finding.tl)}
        ${field("Actual", finding.actual)}
        ${field("Scheduled", finding.scheduled)}
        ${field("Difference", finding.diffDisplay)}
        ${field("Source", finding.source)}
        ${field("Comments", finding.comments)}
        ${field("WFM Comments", finding.wfmComments)}
      </div>

      ${warnings}

      <div class="action-box">
        <div class="field-label">Recommended Action</div>
        <div class="field-value">${escapeHtml(finding.action)}</div>
      </div>

      <button class="btn copy-btn" data-id="${finding.id}">Copy Message</button>
    </article>
  `;
}

/* ---------- Issue type filters ---------- */

const CATEGORY_OPTIONS = [
  { key: "late_in", label: "Late IN", categories: ["late_in"] },
  { key: "early_in", label: "Early IN", categories: ["early_in"] },
  {
    key: "early_out",
    label: "Early OUT",
    categories: ["early_out", "early_out_extra"],
  },
  { key: "overtime", label: "Overtime", categories: ["overtime"] },
  {
    key: "staffed",
    label: "Staffed Time",
    categories: ["staffed_variance", "staffed_calculated_discrepancy"],
  },
  { key: "breaks", label: "Late / Exceed Breaks", categories: ["late_breaks"] },
  {
    key: "outage",
    label: "Outage",
    categories: ["outage", "outage_not_approved"],
  },
  { key: "total_late", label: "Total Late", categories: ["total_late"] },
  {
    key: "leave",
    label: "Leave",
    categories: ["approved_leave", "unapproved_leave"],
  },
  { key: "other", label: "Other", categories: ["other"] },
];

function findingCategoryGroup(finding) {
  for (const option of CATEGORY_OPTIONS) {
    if (option.categories.includes(finding.category)) {
      return option.key;
    }
  }

  return "other";
}

function filterFindingsByCategory(findings) {
  if (!state.selectedCategories.length) return findings;

  return findings.filter((finding) =>
    state.selectedCategories.includes(findingCategoryGroup(finding)),
  );
}

function renderCategoryFilters() {
  const container = $("#category-filters");
  if (!container) return;

  container.innerHTML = "";

  const allFindings = state.analysis?.findings || [];

  for (const option of CATEGORY_OPTIONS) {
    const count = allFindings.filter(
      (finding) => findingCategoryGroup(finding) === option.key,
    ).length;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className =
      "chip" + (state.selectedCategories.includes(option.key) ? " active" : "");

    const label = document.createElement("span");
    label.textContent = option.label;

    const badge = document.createElement("span");
    badge.className = "chip-count";
    badge.textContent = String(count);

    chip.appendChild(label);
    chip.appendChild(badge);

    chip.addEventListener("click", () => {
      if (state.selectedCategories.includes(option.key)) {
        state.selectedCategories = state.selectedCategories.filter(
          (key) => key !== option.key,
        );
      } else {
        state.selectedCategories.push(option.key);
      }

      renderCategoryFilters();
      renderCards();
    });

    container.appendChild(chip);
  }
}

function getCurrentFindings() {
  if (!state.analysis) return [];

  let findings = [];

  if (state.activeTab === "approved") {
    findings = state.analysis.approvedExceptions;
  } else if (state.activeTab === "pending") {
    findings = state.analysis.pendingReview;
  } else if (state.activeTab === "all") {
    findings = state.analysis.findings;
  }

  return filterFindingsByCategory(findings);
}

function renderCards() {
  state.cardIndex.clear();

  const container = $("#results");
  const findings = getCurrentFindings();

  if (!findings.length) {
    container.innerHTML = '<div class="empty">No findings for this view.</div>';
    return;
  }

  container.innerHTML = findings.map(findingCard).join("");
}

function renderChatCards(cards, container) {
  const wrapper = document.createElement("div");
  wrapper.className = "cards";
  wrapper.innerHTML = cards.map(findingCard).join("");
  container.appendChild(wrapper);
}

function addChatMessage(sender, text) {
  const container = $("#chat-messages");

  const message = document.createElement("div");
  message.className = `chat-message ${sender}`;
  message.textContent = text;

  container.appendChild(message);
  container.scrollTop = container.scrollHeight;

  return message;
}

/* ---------- Upload and analysis ---------- */

async function uploadWorkbook() {
  const fileInput = $("#file-input");

  const file = fileInput.files[0];

  if (!file) {
    setUploadStatus("Please choose an Excel file first.");
    return;
  }

  setUploadStatus("Uploading and parsing workbook...");

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    state.uploadId = data.uploadId;
    state.lobs = data.lobs;
    state.selectedLobs = [];
    state.selectedCategories = [];

    renderWarnings(data.warnings);
    renderLobs();

    setUploadStatus(
      `Uploaded ${data.fileName}. Available sheets: ${data.availableSheets.join(", ") || "none"}.`,
    );

    await analyzeWorkbook();
  } catch (error) {
    setUploadStatus(error.message);
  }
}

async function analyzeWorkbook() {
  if (!state.uploadId) return;

  try {
    const data = await apiFetch("/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        uploadId: state.uploadId,
        lobs: state.selectedLobs,
      }),
    });

    state.analysis = data.analysis;

    renderSummary();
    renderCategoryFilters();

    if (["approved", "pending", "all"].includes(state.activeTab)) {
      renderCards();
    }
  } catch (error) {
    setUploadStatus(error.message);
  }
}

/* ---------- Chat and agent search ---------- */

async function askBot(question, targetSelector, isChat = false) {
  if (!state.uploadId) {
    if (isChat) {
      addChatMessage("bot", "Please upload an attendance workbook first.");
    } else {
      $(targetSelector).innerHTML =
        '<div class="empty">Upload a workbook first.</div>';
    }

    return;
  }

  try {
    const answer = await apiFetch("/api/ask", {
      method: "POST",
      body: JSON.stringify({
        uploadId: state.uploadId,
        question,
        lobs: state.selectedLobs,
        context: state.chatContext,
      }),
    });

    if (!isChat) {
      const container = $(targetSelector);
      container.innerHTML = "";

      if (answer.text) {
        const textBlock = document.createElement("div");
        textBlock.className = "empty";
        textBlock.style.whiteSpace = "pre-wrap";
        textBlock.textContent = answer.text;
        container.appendChild(textBlock);
      }

      if (answer.candidates?.length) {
        const buttons = document.createElement("div");
        buttons.className = "candidate-buttons";

        for (const candidate of answer.candidates) {
          const button = document.createElement("button");
          button.className = "btn";
          button.textContent = candidate;

          button.addEventListener("click", () => {
            askBot(
              `Show all attendance exceptions for ${candidate}`,
              targetSelector,
            );
          });

          buttons.appendChild(button);
        }

        container.appendChild(buttons);
      }

      if (answer.cards?.length) {
        const cards = document.createElement("div");
        cards.className = "cards";
        cards.innerHTML = answer.cards.map(findingCard).join("");
        container.appendChild(cards);

        const names = [...new Set(answer.cards.map((card) => card.agentName))];
        if (names.length === 1) {
          state.chatContext.agentName = names[0];
        }
      }

      return;
    }

    if (answer.text) {
      addChatMessage("bot", answer.text);
    }

    const container = $("#chat-messages");

    if (answer.candidates?.length) {
      const wrapper = document.createElement("div");
      wrapper.className = "chat-message bot candidate-buttons";

      for (const candidate of answer.candidates) {
        const button = document.createElement("button");
        button.className = "btn";
        button.textContent = candidate;

        button.addEventListener("click", () => {
          addChatMessage(
            "user",
            `Show all attendance exceptions for ${candidate}`,
          );
          askBot(`Show all attendance exceptions for ${candidate}`, null, true);
        });

        wrapper.appendChild(button);
      }

      container.appendChild(wrapper);
      container.scrollTop = container.scrollHeight;
    }

    if (answer.cards?.length) {
      renderChatCards(answer.cards, container);
      container.scrollTop = container.scrollHeight;

      const names = [...new Set(answer.cards.map((card) => card.agentName))];
      if (names.length === 1) {
        state.chatContext.agentName = names[0];
      }
    }
  } catch (error) {
    if (isChat) {
      addChatMessage("bot", error.message);
    } else {
      $(targetSelector).innerHTML =
        `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }
}

/* ---------- Tabs and events ---------- */

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;

      buttons.forEach((item) =>
        item.classList.toggle("active", item === button),
      );

      $("#panel-analysis").classList.toggle(
        "hidden",
        !["approved", "pending", "all"].includes(state.activeTab),
      );

      $("#panel-search").classList.toggle(
        "hidden",
        state.activeTab !== "search",
      );
      $("#panel-chat").classList.toggle("hidden", state.activeTab !== "chat");

      if (["approved", "pending", "all"].includes(state.activeTab)) {
        renderCards();
      }
    });
  });
}

function initEvents() {
  const warningsToggle = $("#warnings-toggle");

  if (warningsToggle) {
    warningsToggle.addEventListener("click", toggleUploadDetails);
  }

  const filterClear = $("#filter-clear");

  if (filterClear) {
    filterClear.addEventListener("click", () => {
      state.selectedCategories = [];
      renderCategoryFilters();
      renderCards();
    });
  }

  $("#upload-btn").addEventListener("click", uploadWorkbook);

  $("#file-input").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      const display = $("#file-name-display");
      if (display) display.textContent = `Selected: ${file.name}`;
      uploadWorkbook();
    }
  });

  $("#copy-all").addEventListener("click", async () => {
    const findings = getCurrentFindings();

    if (!findings.length) {
      $("#copy-status").textContent = "No visible findings to copy.";
      return;
    }

    const text = findings.map(findingToText).join("\n\n---\n\n");

    await copyText(text);
    $("#copy-status").textContent = "Copied visible report to clipboard.";

    setTimeout(() => {
      $("#copy-status").textContent = "";
    }, 3000);
  });

  $("#agent-search-btn").addEventListener("click", () => {
    const query = $("#agent-query").value.trim();

    if (!query) return;

    askBot(query, "#search-results");
  });

  $("#agent-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      $("#agent-search-btn").click();
    }
  });

  $("#chat-send").addEventListener("click", () => {
    const input = $("#chat-input");
    const question = input.value.trim();

    if (!question) return;

    addChatMessage("user", question);
    input.value = "";

    askBot(question, null, true);
  });

  $("#chat-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      $("#chat-send").click();
    }
  });

  document.addEventListener("click", async (event) => {
    if (event.target.classList.contains("copy-btn")) {
      const id = event.target.dataset.id;
      const finding = state.cardIndex.get(id);

      if (!finding) return;

      await copyText(findingToText(finding));

      event.target.textContent = "Copied!";

      setTimeout(() => {
        event.target.textContent = "Copy Message";
      }, 2000);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initTabs();
  initEvents();

  renderLobs();
  renderSummary();
  renderCategoryFilters();
  renderCards();
});
