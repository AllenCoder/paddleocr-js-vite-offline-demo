import { PaddleOCR } from "@paddleocr/paddleocr-js";
import type { OcrResult, OcrResultItem } from "@paddleocr/paddleocr-js";
import { OcrVisualizer } from "@paddleocr/paddleocr-js/viz";

type OcrEngine = Awaited<ReturnType<typeof PaddleOCR.create>>;

const ORT_WASM_PATHS = "/";
const DEFAULT_RUNTIME_PARAMS = Object.freeze({
  textDetThresh: 0.3,
  textDetBoxThresh: 0.6,
  textDetUnclipRatio: 1.5,
  textRecScoreThresh: 0.1
});

function getDemoThreadCount(): number {
  return self.crossOriginIsolated
    ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))
    : 1;
}

const ui = {
  modelPreset: document.getElementById("modelPreset") as HTMLSelectElement,
  runtimeBackend: document.getElementById("runtimeBackend") as HTMLSelectElement,
  detThresh: document.getElementById("detThresh") as HTMLInputElement,
  boxThresh: document.getElementById("boxThresh") as HTMLInputElement,
  unclipRatio: document.getElementById("unclipRatio") as HTMLInputElement,
  recScoreThresh: document.getElementById("recScoreThresh") as HTMLInputElement,
  imageInput: document.getElementById("imageInput") as HTMLInputElement,
  chooseImageBtn: document.getElementById("chooseImageBtn") as HTMLButtonElement,
  reinitializeBtn: document.getElementById("reinitializeBtn") as HTMLButtonElement,
  runBtn: document.getElementById("runBtn") as HTMLButtonElement,
  status: document.getElementById("status") as HTMLElement,
  metrics: document.getElementById("metrics") as HTMLPreElement,
  results: document.getElementById("results") as HTMLOListElement,
  vizImage: document.getElementById("vizImage") as HTMLImageElement
};

interface AppState {
  imageFile: File | null;
  previewBitmap: ImageBitmap | null;
  lastResult: OcrResult | null;
  ocr: OcrEngine | null;
  ocrReady: boolean;
  vizObjectUrl: string | null;
}

const state: AppState = {
  imageFile: null,
  previewBitmap: null,
  lastResult: null,
  ocr: null,
  ocrReady: false,
  vizObjectUrl: null
};

function updateRunButtonState(): void {
  ui.runBtn.disabled = !state.imageFile || !state.ocrReady;
}

const visualizer = new OcrVisualizer({
  font: {
    family: "PingFang SC",
    source: "/PingFang-SC-Regular.ttf"
  }
});

function setStatus(text: string, isError = false): void {
  ui.status.textContent = text;
  ui.status.style.color = isError ? "#b91c1c" : "";
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function showVizImage(blob: Blob): void {
  if (state.vizObjectUrl) {
    URL.revokeObjectURL(state.vizObjectUrl);
  }
  state.vizObjectUrl = URL.createObjectURL(blob);
  ui.vizImage.src = state.vizObjectUrl;
  ui.vizImage.hidden = false;
}

function showPreviewImage(bitmap: ImageBitmap): void {
  // For pre-OCR preview, draw to an offscreen canvas and display as image
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(bitmap, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) showVizImage(blob);
  });
}

function renderResults(items: OcrResultItem[]): void {
  ui.results.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.text} (置信度: ${item.score.toFixed(3)})`;
    ui.results.appendChild(li);
  });
}

function getRuntimeOptions() {
  return {
    backend: ui.runtimeBackend.value as "auto" | "webgpu" | "wasm",
    wasmPaths: ORT_WASM_PATHS,
    numThreads: getDemoThreadCount(),
    simd: true
  };
}

async function initializeOcrEngine(): Promise<void> {
  state.ocrReady = false;
  updateRunButtonState();

  if (state.ocr) {
    await state.ocr.dispose();
  }

  const preset = ui.modelPreset.value;

  state.ocr = await PaddleOCR.create({
    initialize: false,
    worker: false,
    textDetectionModelName: `${preset}_det`,
    textRecognitionModelName: `${preset}_rec`,
    textDetectionModelAsset: { url: `/models/${preset}_det_onnx_infer.tar` },
    textRecognitionModelAsset: { url: `/models/${preset}_rec_onnx_infer.tar` },
    ortOptions: getRuntimeOptions()
  });

  const summary = await state.ocr.initialize();
  state.ocrReady = true;
  ui.metrics.textContent = [
    `模型版本: ${preset}`,
    `引擎初始化耗时: ${formatMs(summary.elapsedMs)}`,
    `加速后端(请求): ${summary.backend}`,
    `WebGPU 加速可用: ${summary.webgpuAvailable ? "✅ 是" : "❌ 否"}`,
    `检测算子提供方: ${summary.detProvider}`,
    `识别算子提供方: ${summary.recProvider}`,
    `加载离线模型文件数: ${String(summary.assets.length)} 个`
  ].join("\n");
  updateRunButtonState();
}

async function handleImageSelection(file: File | undefined): Promise<void> {
  if (!file) return;
  state.imageFile = file;
  state.previewBitmap?.close();
  state.previewBitmap = await createImageBitmap(file);
  showPreviewImage(state.previewBitmap);
  updateRunButtonState();
  setStatus(`已选择图片: ${file.name}`);
}

async function runOcr(): Promise<void> {
  if (!state.ocrReady || !state.ocr || !state.imageFile) {
    setStatus("请先等待离线 OCR 引擎初始化完毕，然后选择一张图片。", true);
    return;
  }

  try {
    setStatus("正在识别中（纯前端端侧离线推理）...");
    const result: OcrResult = (
      await state.ocr.predict(state.imageFile, {
        textDetThresh: Number(ui.detThresh.value),
        textDetBoxThresh: Number(ui.boxThresh.value),
        textDetUnclipRatio: Number(ui.unclipRatio.value),
        textRecScoreThresh: Number(ui.recScoreThresh.value)
      })
    )[0];

    if (!state.previewBitmap) {
      state.previewBitmap = await createImageBitmap(state.imageFile);
    }

    // Render side-by-side visualization using viz module
    const blob = await visualizer.toBlob(state.previewBitmap, result);
    showVizImage(blob);

    renderResults(result.items);
    state.lastResult = result;
    ui.metrics.textContent = [
      ui.metrics.textContent,
      "",
      `-----------------------------------------`,
      `⚡ 文本检测耗时 (Det): ${formatMs(result.metrics.detMs)}`,
      `⚡ 文本识别耗时 (Rec): ${formatMs(result.metrics.recMs)}`,
      `⏱️ 本地识别总耗时: ${formatMs(result.metrics.totalMs)}`,
      `🎯 检测到的文本区域: ${String(result.metrics.detectedBoxes)} 个`,
      `📝 成功提取文本行数: ${String(result.metrics.recognizedCount)} 行`
    ].join("\n");
    setStatus(`识别成功！成功解析了 ${String(result.metrics.recognizedCount)} 行文本。`);
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`识别失败: ${message}`, true);
  }
}

ui.imageInput.addEventListener("change", (event: Event) => {
  const target = event.target as HTMLInputElement;
  void handleImageSelection(target.files?.[0]);
});

ui.chooseImageBtn.addEventListener("click", () => {
  ui.imageInput.click();
});

async function initialize(): Promise<void> {
  try {
    ui.reinitializeBtn.disabled = true;
    state.ocrReady = false;
    updateRunButtonState();

    setStatus("正在初始化 OCR 推理环境...");
    await initializeOcrEngine();

    setStatus("正在加载可视化中文字体...");
    try {
      await visualizer.loadFont();
    } catch (fontErr: unknown) {
      console.warn("中文字体加载失败，将退回系统默认字体:", fontErr);
      setStatus("就绪（标注可视化将采用系统默认字体）。");
      updateRunButtonState();
      return;
    }

    setStatus("离线 OCR 推理引擎就绪，请选择测试图片。");
    updateRunButtonState();
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`初始化失败: ${message}`, true);
    state.ocrReady = false;
    updateRunButtonState();
  } finally {
    ui.reinitializeBtn.disabled = false;
  }
}

ui.detThresh.value = String(DEFAULT_RUNTIME_PARAMS.textDetThresh);
ui.boxThresh.value = String(DEFAULT_RUNTIME_PARAMS.textDetBoxThresh);
ui.unclipRatio.value = String(DEFAULT_RUNTIME_PARAMS.textDetUnclipRatio);
ui.recScoreThresh.value = String(DEFAULT_RUNTIME_PARAMS.textRecScoreThresh);
ui.reinitializeBtn.addEventListener("click", () => void initialize());
ui.modelPreset.addEventListener("change", () => void initialize());
ui.runtimeBackend.addEventListener("change", () => void initialize());

ui.runBtn.addEventListener("click", () => void runOcr());

void initialize();
