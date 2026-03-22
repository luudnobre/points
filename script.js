const pdfFileInput = document.getElementById("pdfFile");
const uploadArea = document.getElementById("uploadArea");
const filePreview = document.getElementById("filePreview");
const namesInput = document.getElementById("namesInput");
const chipsContainer = document.getElementById("chipsContainer");
const nameCounter = document.getElementById("nameCounter");
const processBtn = document.getElementById("processBtn");
const resetBtn = document.getElementById("resetBtn");
const loadExampleBtn = document.getElementById("loadExampleBtn");
const clearNamesBtn = document.getElementById("clearNamesBtn");
const resultsList = document.getElementById("resultsList");
const logBox = document.getElementById("logBox");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const appStatus = document.getElementById("appStatus");

let selectedFile = null;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js";

function normalizeText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeFileName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

function setStatus(text) {
  appStatus.textContent = text;
}

function updateProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function log(message, type = "normal") {
  const line = document.createElement("div");
  line.textContent = `• ${message}`;

  if (type === "success") line.classList.add("success-text");
  if (type === "warning") line.classList.add("warning-text");
  if (type === "error") line.classList.add("error-text");

  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logBox.innerHTML = "";
}

function parseNames(raw) {
  return [...new Set(
    raw
      .split(/\n|,/g)
      .map((name) => name.trim())
      .filter(Boolean)
  )];
}

function renderNameChips() {
  const names = parseNames(namesInput.value);
  nameCounter.textContent = `${names.length} ${names.length === 1 ? "nome" : "nomes"}`;

  if (!names.length) {
    chipsContainer.innerHTML = `<p class="empty-state">Os nomes digitados aparecerão aqui.</p>`;
    return;
  }

  chipsContainer.innerHTML = names
    .map((name) => `<span class="chip">${escapeHtml(name)}</span>`)
    .join("");
}

function renderFilePreview(file) {
  if (!file) {
    filePreview.innerHTML = `<span>Nenhum arquivo selecionado</span>`;
    return;
  }

  const mb = (file.size / 1024 / 1024).toFixed(2);
  filePreview.innerHTML = `
    <strong>${escapeHtml(file.name)}</strong>
    <span style="margin-left:8px; color:#a9b8d1;">(${mb} MB)</span>
  `;
}

function setFile(file) {
  selectedFile = file;
  renderFilePreview(file);

  if (file) {
    setStatus("PDF carregado");
    log(`Arquivo selecionado: ${file.name}`, "success");
  } else {
    setStatus("Pronto");
  }
}

function resetAll() {
  selectedFile = null;
  pdfFileInput.value = "";
  namesInput.value = "";
  renderFilePreview(null);
  renderNameChips();
  resultsList.innerHTML = `<p class="empty-state">Os PDFs gerados aparecerão aqui.</p>`;
  clearLog();
  updateProgress(0, "Aguardando ação");
  setStatus("Pronto");
}

function createNameMatcher(name) {
  const normalized = normalizeText(name);
  const words = normalized.split(" ").filter((w) => w.length > 1);

  return {
    original: name,
    normalized,
    words,
    matches(pageText) {
      if (!pageText) return false;

      if (pageText.includes(normalized)) {
        return true;
      }

      const strongWords = words.filter((w) => w.length >= 3);

      if (!strongWords.length) {
        return false;
      }

      const foundCount = strongWords.filter((word) => pageText.includes(word)).length;
      const ratio = foundCount / strongWords.length;

      return ratio >= 1;
    }
  };
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pagesText = [];

  log(`PDF carregado com ${pdf.numPages} página(s).`, "success");

  for (let i = 1; i <= pdf.numPages; i++) {
    updateProgress(
      Math.round((i / pdf.numPages) * 45),
      `Lendo texto da página ${i} de ${pdf.numPages}`
    );

    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .map((item) => item.str)
      .join(" ");

    pagesText.push({
      pageNumber: i,
      raw: text,
      normalized: normalizeText(text)
    });
  }

  return {
    pdfBytes: arrayBuffer,
    pagesText,
    pageCount: pdf.numPages
  };
}

function mapNamesToPages(names, pagesText) {
  const matchers = names.map(createNameMatcher);
  const result = {};

  for (const matcher of matchers) {
    result[matcher.original] = [];
  }

  pagesText.forEach((page) => {
    matchers.forEach((matcher) => {
      if (matcher.matches(page.normalized)) {
        result[matcher.original].push(page.pageNumber);
      }
    });
  });

  return result;
}

async function buildPdfFromPages(sourcePdfBytes, pageNumbers) {
  const { PDFDocument } = PDFLib;
  const sourcePdf = await PDFDocument.load(sourcePdfBytes);
  const newPdf = await PDFDocument.create();

  const pageIndexes = pageNumbers.map((p) => p - 1);
  const copiedPages = await newPdf.copyPages(sourcePdf, pageIndexes);

  copiedPages.forEach((page) => newPdf.addPage(page));

  return await newPdf.save();
}

function createDownloadCard(name, pageNumbers, pdfBytes) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const safeName = sanitizeFileName(name) || "arquivo";

  const card = document.createElement("div");
  card.className = "result-item";

  card.innerHTML = `
    <div class="result-top">
      <div>
        <div class="result-name">${escapeHtml(name)}</div>
        <div class="result-meta">
          ${pageNumbers.length} página(s) encontrada(s)<br>
          Páginas: ${pageNumbers.join(", ")}
        </div>
      </div>

      <a
        class="download-btn"
        href="${url}"
        download="${safeName}.pdf"
      >
        Baixar PDF
      </a>
    </div>
  `;

  resultsList.appendChild(card);
}

async function processPdf() {
  clearLog();
  resultsList.innerHTML = "";
  updateProgress(0, "Iniciando");
  setStatus("Processando");

  const names = parseNames(namesInput.value);

  if (!selectedFile) {
    log("Você precisa selecionar um PDF antes de processar.", "error");
    setStatus("Erro");
    updateProgress(0, "Selecione um PDF");
    return;
  }

  if (!names.length) {
    log("Você precisa informar ao menos um nome.", "error");
    setStatus("Erro");
    updateProgress(0, "Digite os nomes");
    return;
  }

  try {
    log("Iniciando leitura do PDF...");
    const { pdfBytes, pagesText, pageCount } = await extractTextFromPdf(selectedFile);

    updateProgress(50, "Mapeando nomes nas páginas");
    log("Buscando os nomes no conteúdo do PDF...");

    const namePageMap = mapNamesToPages(names, pagesText);

    let generatedCount = 0;
    let foundAny = false;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const pageNumbers = [...new Set(namePageMap[name])].sort((a, b) => a - b);

      const progress = 50 + Math.round(((i + 1) / names.length) * 50);
      updateProgress(progress, `Gerando arquivo de ${name}`);

      if (!pageNumbers.length) {
        log(`Nenhuma página encontrada para: ${name}`, "warning");
        continue;
      }

      foundAny = true;
      log(`Nome encontrado: ${name} | páginas: ${pageNumbers.join(", ")}`, "success");

      const separatedPdfBytes = await buildPdfFromPages(pdfBytes, pageNumbers);
      createDownloadCard(name, pageNumbers, separatedPdfBytes);
      generatedCount++;
    }

    if (!foundAny) {
      resultsList.innerHTML = `
        <p class="empty-state">
          Nenhum dos nomes foi encontrado. Isso pode acontecer se o PDF estiver como imagem escaneada
          ou se os nomes estiverem escritos de forma muito diferente.
        </p>
      `;
    }

    updateProgress(100, "Processamento concluído");
    setStatus("Concluído");
    log(`Finalizado. ${generatedCount} PDF(s) gerado(s).`, "success");
    log(`Total de páginas analisadas: ${pageCount}.`);
  } catch (error) {
    console.error(error);
    setStatus("Erro");
    updateProgress(0, "Erro no processamento");
    log("Ocorreu um erro ao processar o PDF.", "error");
    log(error.message || "Erro desconhecido.", "error");
  }
}

pdfFileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  setFile(file);
});

namesInput.addEventListener("input", renderNameChips);

uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");

  const file = e.dataTransfer.files[0];
  if (file && file.type === "application/pdf") {
    setFile(file);
    pdfFileInput.files = e.dataTransfer.files;
  } else {
    log("O arquivo arrastado não é um PDF válido.", "error");
  }
});

loadExampleBtn.addEventListener("click", () => {
  namesInput.value = `Maria da Silva
João Pedro Santos
Ana Clara Souza`;
  renderNameChips();
});

clearNamesBtn.addEventListener("click", () => {
  namesInput.value = "";
  renderNameChips();
});

processBtn.addEventListener("click", processPdf);
resetBtn.addEventListener("click", resetAll);

renderNameChips();
renderFilePreview(null);