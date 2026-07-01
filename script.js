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
const todayDate = document.getElementById("todayDate");
const modeDescription = document.getElementById("modeDescription");
const resultCaption = document.getElementById("resultCaption");
const namesCounter = document.getElementById("namesCounter");

const statNames = document.getElementById("statNames");
const statFound = document.getElementById("statFound");
const statNotFound = document.getElementById("statNotFound");
const statPages = document.getElementById("statPages");

const tabButtons = document.querySelectorAll(".tab-button");
const taskItems = document.querySelectorAll(".task-item");

let selectedFile = null;
let activeMode = "single";
let lastObjectUrl = null;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function formatToday() {
  const today = new Date();
  todayDate.textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(today);
}

function getDateStamp() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setStatus(text) {
  statusBadge.textContent = text;
}

function setProgress(percent, text) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  progressFill.style.width = `${safePercent}%`;
  progressFill.parentElement.setAttribute("aria-valuenow", String(safePercent));
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
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim();

  return cleaned || "colaborador";
}

function parseNames(text) {
  const names = text
    .split(/\n|,/g)
    .map(name => name.trim())
    .filter(Boolean);

  return [...new Set(names)];
}

function updateNameCounter() {
  const count = parseNames(namesInput.value).length;
  namesCounter.textContent = count === 1 ? "1 nome" : `${count} nomes`;
  statNames.textContent = String(count);
  updateTask("names", count > 0 ? "done" : "todo");
}

function createMatcher(name) {
  const normalized = normalizeText(name);
  const parts = normalized.split(" ").filter(Boolean);

  return {
    original: name,
    match(text) {
      if (!normalized) return false;
      if (text.includes(normalized)) return true;

      const strongParts = parts.filter(part => part.length >= 3);
      if (!strongParts.length) return false;

      const foundCount = strongParts.filter(part => text.includes(part)).length;
      return foundCount === strongParts.length;
    }
  };
}

function revokeLastObjectUrl() {
  if (lastObjectUrl) {
    URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = null;
  }
}

function clearResults() {
  revokeLastObjectUrl();

  const text = activeMode === "zip"
    ? "O ZIP com os PDFs separados aparecerá aqui depois do processamento."
    : "O PDF gerado aparecerá aqui depois do processamento.";

  resultsList.innerHTML = `<p class="empty">${text}</p>`;
}

function setFile(file) {
  const isPdf =
    file &&
    (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

  if (!isPdf) {
    selectedFile = null;
    fileInfo.textContent = "Arquivo inválido. Escolha um PDF.";
    log("O arquivo selecionado não é um PDF válido.", "error");
    setStatus("ERRO ⚠️");
    updateTask("upload", "error");
    return;
  }

  selectedFile = file;
  const sizeMB = (file.size / 1024 / 1024).toFixed(2);
  fileInfo.textContent = `${file.name} (${sizeMB} MB)`;
  log(`Arquivo selecionado: ${file.name}`, "success");
  setStatus("PDF CARREGADO ✅");
  updateTask("upload", "done");
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

async function buildPdfFromSourceDoc(sourceDoc, pageNumbers) {
  const { PDFDocument } = PDFLib;
  const newDoc = await PDFDocument.create();
  const indexes = pageNumbers.map(number => number - 1);
  const copiedPages = await newDoc.copyPages(sourceDoc, indexes);

  copiedPages.forEach(page => newDoc.addPage(page));

  return await newDoc.save();
}

function updateTask(taskName, state) {
  const item = [...taskItems].find(task => task.dataset.task === taskName);
  if (!item) return;

  item.classList.remove("active", "done", "error");
  if (state && state !== "todo") item.classList.add(state);
}

function resetTasks() {
  taskItems.forEach(item => item.classList.remove("active", "done", "error"));
  if (selectedFile) updateTask("upload", "done");
  if (parseNames(namesInput.value).length) updateTask("names", "done");
}

function updateStats({ names = 0, found = 0, notFound = 0, pages = 0 } = {}) {
  statNames.textContent = String(names);
  statFound.textContent = String(found);
  statNotFound.textContent = String(notFound);
  statPages.textContent = String(pages);
}

function analyzeMatches(names, pages) {
  const map = mapNamesToPages(names, pages);
  const foundNames = [];
  const notFoundNames = [];
  let allPages = [];

  for (const name of names) {
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

  return {
    foundNames,
    notFoundNames,
    uniquePages
  };
}

function makeDownloadUrl(blob) {
  revokeLastObjectUrl();
  lastObjectUrl = URL.createObjectURL(blob);
  return lastObjectUrl;
}

function renderSinglePdfResult(pageNumbers, foundNames, notFoundNames, pdfBytes) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = makeDownloadUrl(blob);

  const foundNamesText = foundNames.length
    ? foundNames.map(item => `${item.name} (${item.pages.join(", ")})`).join(" | ")
    : "Nenhum nome encontrado";

  const notFoundText = notFoundNames.length
    ? notFoundNames.join(", ")
    : "Nenhum";

  const dateStamp = getDateStamp();

  const card = document.createElement("div");
  card.className = "result-card";
  card.innerHTML = `
    <div class="result-main">
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
      download="${sanitizeFileName(`pontos_filtrados_${dateStamp}`)}.pdf"
    >
      Baixar PDF
    </a>
  `;

  resultsList.innerHTML = "";
  resultsList.appendChild(card);
}

async function renderZipResult(foundNames, notFoundNames, zipBlob) {
  const url = makeDownloadUrl(zipBlob);
  const dateStamp = getDateStamp();

  const fileChips = foundNames
    .slice(0, 12)
    .map(item => `<span class="result-chip">${sanitizeFileName(item.name)}.pdf</span>`)
    .join("");

  const hiddenCount = foundNames.length > 12 ? foundNames.length - 12 : 0;
  const hiddenChip = hiddenCount > 0
    ? `<span class="result-chip">+${hiddenCount} arquivo(s)</span>`
    : "";

  const notFoundText = notFoundNames.length
    ? notFoundNames.join(", ")
    : "Nenhum";

  const card = document.createElement("div");
  card.className = "result-card";
  card.innerHTML = `
    <div class="result-main">
      <div class="result-name">ZIP gerado com PDFs separados</div>
      <div class="result-meta">
        ${foundNames.length} PDF(s) individual(is) criado(s)<br>
        ${notFoundNames.length} nome(s) não encontrado(s)<br>
        <strong>Não encontrados:</strong> ${notFoundText}<br><br>
        Cada PDF foi nomeado conforme o nome informado no ponto.
      </div>
      <div class="result-chips">
        ${fileChips}
        ${hiddenChip}
      </div>
    </div>

    <a
      class="download-link"
      href="${url}"
      download="${sanitizeFileName(`colaboradores_pdf_${dateStamp}`)}.zip"
    >
      Baixar ZIP
    </a>
  `;

  resultsList.innerHTML = "";
  resultsList.appendChild(card);
}

function buildReportText(foundNames, notFoundNames, uniquePages) {
  const now = new Date();
  const lines = [];

  lines.push("RELATÓRIO DE PROCESSAMENTO - SEPARADOR DE PONTOS");
  lines.push(`Data: ${now.toLocaleString("pt-BR")}`);
  lines.push("");
  lines.push(`Total encontrados: ${foundNames.length}`);
  lines.push(`Total não encontrados: ${notFoundNames.length}`);
  lines.push(`Páginas utilizadas: ${uniquePages.join(", ") || "Nenhuma"}`);
  lines.push("");
  lines.push("ENCONTRADOS:");

  foundNames.forEach(item => {
    lines.push(`- ${item.name}: página(s) ${item.pages.join(", ")}`);
  });

  lines.push("");
  lines.push("NÃO ENCONTRADOS:");

  if (notFoundNames.length) {
    notFoundNames.forEach(name => lines.push(`- ${name}`));
  } else {
    lines.push("- Nenhum");
  }

  return lines.join("\n");
}

async function generateSeparatedZip(sourceDoc, foundNames, notFoundNames, uniquePages) {
  const zip = new JSZip();
  const dateStamp = getDateStamp();
  const folder = zip.folder(`Colaboradores PDF - ${dateStamp}`);

  for (let i = 0; i < foundNames.length; i++) {
    const item = foundNames[i];
    const start = 72;
    const end = 96;
    const percent = Math.round(start + ((i + 1) / foundNames.length) * (end - start));

    setProgress(percent, `Gerando PDF de ${item.name}`);

    const pdfBytes = await buildPdfFromSourceDoc(sourceDoc, item.pages);
    const filename = `${sanitizeFileName(item.name)}.pdf`;
    folder.file(filename, pdfBytes);
  }

  folder.file(
    `relatorio_processamento_${dateStamp}.txt`,
    buildReportText(foundNames, notFoundNames, uniquePages)
  );

  setProgress(98, "Compactando arquivos em ZIP");

  return await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function setProcessingState(isProcessing) {
  processBtn.disabled = isProcessing;
  resetBtn.disabled = isProcessing;
  exampleBtn.disabled = isProcessing;

  tabButtons.forEach(button => {
    button.disabled = isProcessing;
  });
}

async function processPdf() {
  clearLog();
  resultsList.innerHTML = "";
  resetTasks();
  setProgress(0, "Iniciando");
  setStatus("PROCESSANDO ⏳");
  setProcessingState(true);

  const names = parseNames(namesInput.value);
  updateStats({ names: names.length });

  if (!selectedFile) {
    log("Selecione um PDF antes de continuar.", "error");
    setStatus("ERRO ⚠️");
    setProgress(0, "Selecione um PDF");
    updateTask("upload", "error");
    setProcessingState(false);
    return;
  }

  if (!names.length) {
    log("Digite pelo menos um nome.", "error");
    setStatus("ERRO ⚠️");
    setProgress(0, "Digite os nomes");
    updateTask("names", "error");
    setProcessingState(false);
    return;
  }

  try {
    updateTask("read", "active");
    log("Iniciando leitura do PDF...");

    const { sourceBytes, pages } = await readPdf(selectedFile);

    updateTask("read", "done");
    setProgress(50, "Buscando nomes nas páginas");
    log("Procurando os nomes dentro do PDF...");

    const { foundNames, notFoundNames, uniquePages } = analyzeMatches(names, pages);

    updateStats({
      names: names.length,
      found: foundNames.length,
      notFound: notFoundNames.length,
      pages: uniquePages.length
    });

    if (!uniquePages.length) {
      clearResults();
      log("Nenhuma página encontrada para os nomes informados.", "warning");
      setStatus("SEM RESULTADOS ⚠️");
      setProgress(100, "Concluído sem resultados");
      updateTask("generate", "error");
      return;
    }

    const { PDFDocument } = PDFLib;
    const sourceDoc = await PDFDocument.load(cloneUint8(sourceBytes));

    updateTask("generate", "active");

    if (activeMode === "single") {
      setProgress(82, "Gerando PDF único");
      const resultBytes = await buildPdfFromSourceDoc(sourceDoc, uniquePages);
      renderSinglePdfResult(uniquePages, foundNames, notFoundNames, resultBytes);
      log(`PDF único criado com ${uniquePages.length} página(s).`, "success");
    } else {
      setProgress(70, "Gerando PDFs separados por colaborador");
      const zipBlob = await generateSeparatedZip(sourceDoc, foundNames, notFoundNames, uniquePages);
      await renderZipResult(foundNames, notFoundNames, zipBlob);
      log(`ZIP criado com ${foundNames.length} PDF(s) separado(s).`, "success");
    }

    updateTask("generate", "done");
    setStatus("CONCLUÍDO ✅");
    setProgress(100, "Concluído");
  } catch (error) {
    console.error(error);
    log(`Erro ao processar o PDF: ${error.message}`, "error");
    setStatus("ERRO ⚠️");
    setProgress(0, "Erro no processamento");
    updateTask("generate", "error");
  } finally {
    setProcessingState(false);
  }
}

function switchMode(mode) {
  activeMode = mode;

  tabButtons.forEach(button => {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  if (mode === "zip") {
    processBtn.textContent = "Gerar ZIP separado";
    modeDescription.textContent = "Gere um ZIP com um PDF separado para cada colaborador encontrado.";
    resultCaption.textContent = "O ZIP com os PDFs separados aparecerá aqui depois do processamento.";
  } else {
    processBtn.textContent = "Gerar PDF único";
    modeDescription.textContent = "Gere um único PDF com todas as páginas encontradas.";
    resultCaption.textContent = "O PDF gerado aparecerá aqui depois do processamento.";
  }

  clearResults();
}

function resetAll() {
  selectedFile = null;
  pdfFile.value = "";
  namesInput.value = "";
  fileInfo.textContent = "Nenhum arquivo selecionado";
  clearResults();
  clearLog();
  resetTasks();
  updateNameCounter();
  updateStats();
  setProgress(0, "Aguardando ação");
  setStatus("PRONTO ✅");
}

pdfFile.addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (file) setFile(file);
});

namesInput.addEventListener("input", updateNameCounter);

exampleBtn.addEventListener("click", () => {
  namesInput.value = `ALAN TURING\nADA LOVELACE\nGRACE HOPPER`;
  updateNameCounter();
  log("Exemplo carregado na lista de nomes.", "success");
});

processBtn.addEventListener("click", processPdf);
resetBtn.addEventListener("click", resetAll);

tabButtons.forEach(button => {
  button.addEventListener("click", () => switchMode(button.dataset.mode));
});

formatToday();
updateNameCounter();
clearResults();
setProgress(0, "Aguardando ação");
setStatus("PRONTO ✅");