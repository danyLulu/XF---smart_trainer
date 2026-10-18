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

    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;

        poseLandmarker.detectForVideo(video, startTimeMs, (result) => {
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

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
    } else {
        webcamRunning = true;
        btn.textContent = "⏸ Остановить";

        // ВАЖНО: Запускаем распознавание речи здесь, внутри клика пользователя!
        // Это обходит ограничения браузера на автозапуск звука
        speak("Тренировка началась. Приседайте.", true);

        const constraints = { video: { width: 640, height: 480, facingMode: "user" } };
        navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
            video.srcObject = stream;
            video.addEventListener("loadeddata", predictWebcam);
        }).catch(err => {
            statusDiv.textContent = "Ошибка доступа к камере: " + err.message;
        });
    }
}

btn.addEventListener("click", enableCam);

// Стартуем инициализацию
initPose().catch(err => {
    console.error(err);
    statusDiv.textContent = "Ошибка загрузки модели";
});