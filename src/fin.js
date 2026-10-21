import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const statusDiv = document.getElementById("status");
const repsDiv = document.getElementById("reps");
const btn = document.getElementById("btn");

let poseLandmarker = null;
let webcamRunning = false;
let lastVideoTime = -1;
let lastSpokenTime = 0;

// Логика для подсчета повторений и анализа
let stage = "up"; // "up" или "down"
let reps = 0;
let isIncorrectDepth = false;

// Функция для расчета угла между тремя точками
function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
}

// Функция для голосовой подсказки (с защитой от спама)
function speak(text, force = false) {
    const now = Date.now();
    // Не повторяем одну и ту же фразу чаще раза в 3 секунды
    if (!force && now - lastSpokenTime < 3000) return;
    lastSpokenTime = now;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.1;
    utterance.pitch = 1.0;
    speechSynthesis.speak(utterance);
}

// Инициализация MediaPipe
async function initPose() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1
    });
    btn.disabled = false;
    btn.textContent = "▶ Начать тренировку";
    statusDiv.textContent = "Готов к работе";
}

// Основной цикл обработки видео
async function predictWebcam() {
    if (!webcamRunning) return;

    // Если видео ещё не загрузило кадры, ждём следующего тика
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        window.requestAnimationFrame(predictWebcam);
        return;
    }

    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;

        poseLandmarker.detectForVideo(video, startTimeMs, (result) => {
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

            // Рисуем сам кадр с камеры, чтобы изображение было видно
            canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

            if (result.landmarks && result.landmarks.length > 0) {
                const landmarks = result.landmarks[0];

                // Рисуем скелет
                const drawingUtils = new DrawingUtils(canvasCtx);
                drawingUtils.drawLandmarks(landmarks, {
                    radius: (data) => DrawingUtils.lerp(data.from.z, -0.15, 0.1, 5, 1)
                });
                drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS);

                // === АНАЛИЗ ПРИСЕДАНИЙ ===
                // Индексы точек MediaPipe: 23 - левое бедро, 25 - левое колено, 27 - левая лодыжка
                const hip = landmarks[23];
                const knee = landmarks[25];
                const ankle = landmarks[27];

                // Считаем угол в колене
                const kneeAngle = calculateAngle(hip, knee, ankle);

                // Логика приседа
                if (kneeAngle < 100) {
                    // Человек присел достаточно глубоко
                    if (stage === "up") {
                        stage = "down";
                        isIncorrectDepth = false;
                    }
                    statusDiv.textContent = "Отлично! Глубокий присед ✅";
                    statusDiv.className = "good";
                }
                else if (kneeAngle < 140) {
                    // Человек в среднем положении
                    if (stage === "up") {
                        // Это начало приседа
                        stage = "down";
                        if (kneeAngle > 120) {
                            // Присел, но недостаточно глубоко
                            isIncorrectDepth = true;
                            statusDiv.textContent = "Ниже! ⚠️";
                            statusDiv.className = "bad";
                            speak("Ниже");
                        }
                    }
                }
                else {
                    // Человек встал (угол близок к 180)
                    if (stage === "down") {
                        // Завершил повторение
                        stage = "up";
                        if (!isIncorrectDepth) {
                            reps++;
                            repsDiv.textContent = reps;
                        }
                        isIncorrectDepth = false;
                    }
                    statusDiv.textContent = "Исходное положение 🧍";
                    statusDiv.className = "";
                }

                // Дополнительная проверка: если угол слишком маленький (человек сложился)
                if (kneeAngle < 50) {
                    speak("Слишком низко, берегите колени");
                }
            } else {
                statusDiv.textContent = "Человек не найден 🔍";
                statusDiv.className = "bad";
            }

            canvasCtx.restore();
        });
    }

    if (webcamRunning) {
        window.requestAnimationFrame(predictWebcam);
    }
}

// Останавливаем камеру и освобождаем её для других приложений
function stopCamera() {
    if (video.srcObject) {
        const tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
    }
}

// Проверяем, есть ли в системе вообще какие-либо камеры
async function hasAnyCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return true;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some(device => device.kind === "videoinput");
    } catch {
        return true; // не смогли проверить — не мешаем
    }
}

// Подключаем полученный видеопоток к <video> и запускаем анализ
async function useStream(stream) {
    video.srcObject = stream;
    // Явно запускаем воспроизведение — без этого видео может остаться чёрным
    await video.play();
    predictWebcam();
}

// Запуск камеры с запасным вариантом запроса
async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Браузер не поддерживает доступ к камере. Откройте страницу по адресу http://localhost:8080");
    }

    // 1) Пробуем фронтальную камеру с нужным разрешением
    try {
        const constraints = { video: { width: 640, height: 480, facingMode: "user" } };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        await useStream(stream);
        return;
    } catch (firstErr) {
        console.warn("Не удалось открыть камеру с жёсткими ограничениями:", firstErr);
    }

    // 2) Запасной вариант: любая камера без ограничений
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    await useStream(stream);
}

// Понятное сообщение для каждой ошибки доступа к камере
async function showCameraError(err) {
    console.error(err);
    const name = err.name || "";
    const message = err.message || "";

    if (name === "NotFoundError" || /not found/i.test(message)) {
        // Уточняем, видит ли браузер камеры вообще
        const anyCamera = await hasAnyCamera();
        if (anyCamera) {
            statusDiv.textContent = "Камера не найдена: она выключена или занята другим приложением (Zoom, FaceTime и т.п.)";
        } else {
            statusDiv.textContent = "Браузер не видит ни одной камеры. Проверьте: macOS → Системные настройки → Конфиденциальность и безопасность → Камера — разрешите доступ браузеру.";
        }
    } else if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        statusDiv.textContent = "Доступ к камере запрещён. Нажмите на иконку камеры в адресной строке и разрешите доступ.";
    } else if (name === "NotReadableError") {
        statusDiv.textContent = "Не удалось открыть камеру — она уже используется другим приложением. Закройте его и попробуйте снова.";
    } else if (name === "SecurityError") {
        statusDiv.textContent = "Доступ к камере работает только по HTTPS или localhost. Откройте http://localhost:8080";
    } else {
        statusDiv.textContent = "Ошибка доступа к камере: " + message;
    }
}

// Запуск камеры
async function enableCam() {
    if (!poseLandmarker) {
        statusDiv.textContent = "Загрузка модели...";
        return;
    }

    if (webcamRunning) {
        webcamRunning = false;
        btn.textContent = "▶ Начать тренировку";
        statusDiv.textContent = "Тренировка остановлена";
        stopCamera();
        return;
    }

    webcamRunning = true;
    btn.textContent = "⏸ Остановить";

    // ВАЖНО: Запускаем распознавание речи здесь, внутри клика пользователя!
    // Это обходит ограничения браузера на автозапуск звука
    speak("Тренировка началась. Приседайте.", true);

    try {
        await startCamera();
    } catch (err) {
        webcamRunning = false;
        btn.textContent = "▶ Начать тренировку";
        await showCameraError(err);
    }
}

btn.addEventListener("click", enableCam);

// Стартуем инициализацию
initPose().catch(err => {
    console.error(err);
    statusDiv.textContent = "Ошибка загрузки модели";
});