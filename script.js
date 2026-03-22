const pdfFileInput = document.getElementById("pdfFile");
const pickFileBtn = document.getElementById("pickFileBtn");
const filePreview = document.getElementById("filePreview");
const namesInput = document.getElementById("namesInput");
const processBtn = document.getElementById("processBtn");
const resetBtn = document.getElementById("resetBtn");
const resultsList = document.getElementById("resultsList");
const logBox = document.getElementById("logBox");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");

let selectedFile = null;

// Worker do PDF.js compatível com a mesma versão
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function log(message, type = "normal") {
  const line = document.createElement("div");
  line.textContent = `• ${message}`;

  if (type === "error") line.style.color = "#ff9c9c";
  if (type === "success") line.style.color = "#8ef0b7";
  if (type === "warning") line.style.color = "#ffd97d";

  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logBox.innerHTML = "";
}

function updateProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function normalizeText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFileName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

function parseNames(raw) {
  return raw
    .split(/\n|,/g)
    .map((n) => n.trim())
    .filter(Boolean);
}

function setFile(file) {
  if (!file) return;

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    log("O arquivo selecionado não é um PDF.", "error");
    selectedFile = null;
    filePreview.textContent = "Nenhum arquivo selecionado";
    return;
  }

  selectedFile = file;
  filePreview.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  log(`PDF carregado: ${file.name}`, "success");
}

pickFileBtn.addEventListener("click", () => {
  pdfFileInput.click();
});

pdfFileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) {
    setFile(file);
  }
});

function createNameMatcher(name) {
  const normalized = normalizeText(name);
  const words = normalized.split(" ").filter(Boolean);

  return {
    original: name,
    normalized,
    matches(pageText) {
      if (pageText.includes(normalized)) return true;

      let count = 0;
      for (const word of words) {
        if (word.length >= 3 && pageText.includes(word)) {
          count++;
        }
      }

      return words.length > 0 && count === words.filter(w => w.length >= 3).length;
    }
  };
}

async function readPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer
  });

  const pdf = await loadingTask.promise;
  const pages = [];

  log(`PDF aberto com ${pdf.numPages} página(s).`, "success");

  for (let i = 1; i <= pdf.numPages; i++) {
    updateProgress(Math.round((i / pdf.numPages) * 40), `Lendo página ${i}/${pdf.numPages}`);

    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");

    pages.push({
      pageNumber: i,
      raw: text,
      normalized: normalizeText(text)
    });
  }

  return {
    pdfBytes: arrayBuffer,
    pages
  };
}

function mapNamesToPages(names, pages) {
  const matchers = names.map(createNameMatcher);
  const result = {};

  for (const matcher of matchers) {
    result[matcher.original] = [];
  }

  for (const page of pages) {
    for (const matcher of matchers) {
      if (matcher.matches(page.normalized)) {
        result[matcher.original].push(page.pageNumber);
      }
    }
  }

  return result;
}

async function buildPdfFromPages(sourcePdfBytes, pageNumbers) {
  const { PDFDocument } = PDFLib;
  const sourcePdf = await PDFDocument.load(sourcePdfBytes);
  const newPdf = await PDFDocument.create();

  const indexes = pageNumbers.map(n => n - 1);
  const copiedPages = await newPdf.copyPages(sourcePdf, indexes);

  copiedPages.forEach(page => newPdf.addPage(page));

  return await newPdf.save();
}

function renderDownload(name, pageNumbers, bytes) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const item = document.createElement("div");
  item.className = "result-item";
  item.innerHTML = `
    <div>
      <strong>${name}</strong>
      <div class="result-meta">Páginas: ${pageNumbers.join(", ")}</div>
    </div>
    <a class="download-btn" href="${url}" download="${sanitizeFileName(name)}.pdf">Baixar</a>
  `;

  resultsList.appendChild(item);
}

async function processPdf() {
  clearLog();
  resultsList.innerHTML = "";
  updateProgress(0, "Iniciando");

  const names = parseNames(namesInput.value);

  if (!selectedFile) {
    log("Selecione um PDF primeiro.", "error");
    return;
  }

  if (!names.length) {
    log("Digite pelo menos um nome.", "error");
    return;
  }

  try {
    log("Lendo o PDF...");
    const { pdfBytes, pages } = await readPdfText(selectedFile);

    updateProgress(50, "Buscando nomes nas páginas");
    const map = mapNamesToPages(names, pages);

    let count = 0;

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const pageNumbers = [...new Set(map[name])].sort((a, b) => a - b);

      updateProgress(
        50 + Math.round(((i + 1) / names.length) * 50),
        `Gerando ${name}`
      );

      if (!pageNumbers.length) {
        log(`Nome não encontrado: ${name}`, "warning");
        continue;
      }

      const bytes = await buildPdfFromPages(pdfBytes, pageNumbers);
      renderDownload(name, pageNumbers, bytes);
      log(`PDF criado para ${name}`, "success");
      count++;
    }

    if (count === 0) {
      resultsList.innerHTML = `<p class="empty-state">Nenhum nome encontrado no PDF.</p>`;
      log("Nenhum nome foi localizado. Pode ser PDF escaneado.", "warning");
    }

    updateProgress(100, "Concluído");
  } catch (error) {
    console.error(error);
    log(`Erro ao processar PDF: ${error.message}`, "error");
    updateProgress(0, "Erro");
  }
}

function resetAll() {
  selectedFile = null;
  pdfFileInput.value = "";
  namesInput.value = "";
  filePreview.textContent = "Nenhum arquivo selecionado";
  resultsList.innerHTML = `<p class="empty-state">Os PDFs separados aparecerão aqui.</p>`;
  clearLog();
  updateProgress(0, "Aguardando ação");
}

processBtn.addEventListener("click", processPdf);
resetBtn.addEventListener("click", resetAll);