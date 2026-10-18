import { PoseDetector } from "./poseDetector";
import { SquatAnalyzer } from "./exerciseAnalyzer";
import { DrawingUtils, PoseLandmarker } from "@mediapipe/tasks-vision";

async function run() {
    const video = document.getElementById("webcam") as HTMLVideoElement;
    const canvas = document.getElementById("output_canvas") as HTMLCanvasElement;
    const canvasCtx = canvas.getContext("2d")!;
    const counterEl = document.getElementById("counter")!;
    const feedbackEl = document.getElementById("feedback")!;

    // 1. Запуск камеры
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = stream;
    await new Promise((resolve) => { video.onloadedmetadata = resolve; });
    video.play();

    // 2. Инициализация моделей
    const detector = new PoseDetector();
    await detector.initialize();
    const analyzer = new SquatAnalyzer();
    const drawingUtils = new DrawingUtils(canvasCtx);

    let lastVideoTime = -1;

    // 3. Главный цикл обработки кадров
    function predictionLoop() {
        if (video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            detector.detectForVideo(video, performance.now(), (result) => {
                canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

                if (result.landmarks && result.landmarks.length > 0) {
                    const landmarks = result.landmarks[0];

                    // Отрисовка скелета
                    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: "#00FF00", lineWidth: 4 });
                    drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", radius: 2 });

                    // Анализ движения
                    const analysis = analyzer.analyze(landmarks);
                    
                    // Обновление UI
                    counterEl.innerText = `Повторения: ${analyzer.repCount}`;
                    feedbackEl.innerText = analysis.feedback;
                }
            });
        }
        requestAnimationFrame(predictionLoop);
    }

    predictionLoop();
}

run();
