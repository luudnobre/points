const pdfFile = document.getElementById("pdfFile");
const namesInput = document.getElementById("namesInput");
const processBtn = document.getElementById("processBtn");
const resetBtn = document.getElementById("resetBtn");
const exampleBtn = document.getElementById("exampleBtn");
const fileInfo = document.getElementById("fileInfo");
const resultsList = document.getElementById("resultsList");
const logBox = document.getElementById("logBox");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const statusBadge = document.getElementById("statusBadge");

let selectedFile = null;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function setStatus(text) {
  statusBadge.textContent = text;
}

function setProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function log(message, type = "") {
  const div = document.createElement("div");
  div.textContent = `• ${message}`;

  if (type === "success") div.className = "log-success";
  if (type === "warning") div.className = "log-warning";
  if (type === "error") div.className = "log-error";

  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function clearLog() {
  logBox.innerHTML = "";
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

function parseNames(text) {
  return [...new Set(
    text
      .split(/\n|,/g)
      .map(name => name.trim())
      .filter(Boolean)
  )];
}

function createMatcher(name) {
  const normalized = normalizeText(name);
  const parts = normalized.split(" ").filter(Boolean);

  return {
    original: name,
    match(text) {
      if (text.includes(normalized)) return true;

      const strongParts = parts.filter(part => part.length >= 3);
      if (!strongParts.length) return false;

      const foundCount = strongParts.filter(part => text.includes(part)).length;
      return foundCount === strongParts.length;
    }
  };
}

function clearResults() {
  resultsList.innerHTML = `
    <p class="empty">
      O PDF gerado aparecerá aqui depois do processamento.
    </p>
  `;
}

function setFile(file) {
  const isPdf =
    file &&
    (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

  if (!isPdf) {
    selectedFile = null;
    fileInfo.textContent = "Arquivo inválido. Escolha um PDF.";
    log("O arquivo selecionado não é um PDF válido.", "error");
    setStatus("Erro");
    return;
  }

  selectedFile = file;
  const sizeMB = (file.size / 1024 / 1024).toFixed(2);
  fileInfo.textContent = `${file.name} (${sizeMB} MB)`;
  log(`Arquivo selecionado: ${file.name}`, "success");
  setStatus("PDF carregado");
}

function cloneUint8(uint8) {
  return new Uint8Array(uint8);
}

async function readPdf(file) {
  const originalBuffer = await file.arrayBuffer();
  const originalBytes = new Uint8Array(originalBuffer);

  const pdfJsBytes = cloneUint8(originalBytes);
  const pdfLibBytes = cloneUint8(originalBytes);

  const loadingTask = pdfjsLib.getDocument({ data: pdfJsBytes });
  const pdf = await loadingTask.promise;

  log(`PDF aberto com ${pdf.numPages} página(s).`, "success");

  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    setProgress(
      Math.round((i / pdf.numPages) * 45),
      `Lendo página ${i} de ${pdf.numPages}`
    );

    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");

    pages.push({
      pageNumber: i,
      text: normalizeText(text)
    });
  }

  return {
    sourceBytes: pdfLibBytes,
    pages
  };
}

function mapNamesToPages(names, pages) {
  const matchers = names.map(createMatcher);
  const map = {};

  matchers.forEach(matcher => {
    map[matcher.original] = [];
  });

  pages.forEach(page => {
    matchers.forEach(matcher => {
      if (matcher.match(page.text)) {
        map[matcher.original].push(page.pageNumber);
      }
    });
  });

  return map;
}

async function buildPdf(sourceBytes, pageNumbers) {
  const { PDFDocument } = PDFLib;

  const safeBytes = cloneUint8(sourceBytes);
  const sourceDoc = await PDFDocument.load(safeBytes);
  const newDoc = await PDFDocument.create();

  const indexes = pageNumbers.map(number => number - 1);
  const copiedPages = await newDoc.copyPages(sourceDoc, indexes);

  copiedPages.forEach(page => newDoc.addPage(page));

  return await newDoc.save();
}

function renderSinglePdfResult(pageNumbers, foundNames, notFoundNames, pdfBytes) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const foundNamesText = foundNames.length
    ? foundNames.map(item => `${item.name} (${item.pages.join(", ")})`).join(" | ")
    : "Nenhum nome encontrado";

  const notFoundText = notFoundNames.length
    ? notFoundNames.join(", ")
    : "Nenhum";

  const card = document.createElement("div");
  card.className = "result-card";
  card.innerHTML = `
    <div>
      <div class="result-name">PDF único gerado</div>
      <div class="result-meta">
        ${pageNumbers.length} página(s) no total<br>
        Páginas: ${pageNumbers.join(", ")}<br>
        ${foundNames.length} nome(s) encontrado(s)<br>
        ${notFoundNames.length} nome(s) não encontrado(s)<br><br>
        <strong>Encontrados:</strong> ${foundNamesText}<br>
        <strong>Não encontrados:</strong> ${notFoundText}
      </div>
    </div>

    <a
      class="download-link"
      href="${url}"
      download="${sanitizeFileName("pontos_filtrados")}.pdf"
    >
      Baixar PDF
    </a>
  `;

  resultsList.innerHTML = "";
  resultsList.appendChild(card);
}

async function processPdf() {
  clearLog();
  resultsList.innerHTML = "";
  setProgress(0, "Iniciando");
  setStatus("Processando");

  const names = parseNames(namesInput.value);

  if (!selectedFile) {
    log("Selecione um PDF antes de continuar.", "error");
    setStatus("Erro");
    setProgress(0, "Selecione um PDF");
    return;
  }

  if (!names.length) {
    log("Digite pelo menos um nome.", "error");
    setStatus("Erro");
    setProgress(0, "Digite os nomes");
    return;
  }

  try {
    log("Iniciando leitura do PDF...");
    const { sourceBytes, pages } = await readPdf(selectedFile);

    setProgress(50, "Buscando nomes nas páginas");
    log("Procurando os nomes dentro do PDF...");

    const map = mapNamesToPages(names, pages);

    let allPages = [];
    const foundNames = [];
    const notFoundNames = [];

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const pageNumbers = [...new Set(map[name])].sort((a, b) => a - b);

      if (pageNumbers.length > 0) {
        foundNames.push({
          name,
          pages: pageNumbers
        });

        allPages.push(...pageNumbers);
        log(`Nome encontrado: ${name} | páginas: ${pageNumbers.join(", ")}`, "success");
      } else {
        notFoundNames.push(name);
        log(`Nome não encontrado: ${name}`, "warning");
      }
    }

    const uniquePages = [...new Set(allPages)].sort((a, b) => a - b);

    if (!uniquePages.length) {
      clearResults();
      log("Nenhuma página encontrada para os nomes informados.", "warning");
      setStatus("Sem resultados");
      setProgress(100, "Concluído sem resultados");
      return;
    }

    setProgress(82, "Gerando PDF único");
    const resultBytes = await buildPdf(sourceBytes, uniquePages);

    renderSinglePdfResult(uniquePages, foundNames, notFoundNames, resultBytes);

    log(`PDF único criado com ${uniquePages.length} página(s).`, "success");
    setStatus("Concluído");
    setProgress(100, "Concluído");
  } catch (error) {
    console.error(error);
    log(`Erro ao processar o PDF: ${error.message}`, "error");
    setStatus("Erro");
    setProgress(0, "Erro no processamento");
  }
}

function resetAll() {
  selectedFile = null;
  pdfFile.value = "";
  namesInput.value = "";
  fileInfo.textContent = "Nenhum arquivo selecionado";
  clearResults();
  clearLog();
  setProgress(0, "Aguardando ação");
  setStatus("Pronto");
}

pdfFile.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) setFile(file);
});

exampleBtn.addEventListener("click", () => {
  namesInput.value = `ALAN TURING`;
});

processBtn.addEventListener("click", processPdf);
resetBtn.addEventListener("click", resetAll);

clearResults();