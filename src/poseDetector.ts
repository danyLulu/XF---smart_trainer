import {
    PoseLandmarker,
    FilesetResolver,
    PoseLandmarkerCallback
} from "@mediapipe/tasks-vision";

export class PoseDetector {
    private poseLandmarker: PoseLandmarker | null = null;

    async initialize() {
        const vision = await FilesetResolver.forVisionTasks(
            // Фиксируем версию WASM, чтобы она совпадала с версией
            // установленного npm-пакета (иначе возможна несовместимость рантайма)
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm"
        );

        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `/models/pose_landmarker_full.task`,
                delegate: "GPU" // Используем GPU-ускорение в браузере
            },
            // В версии 1.1.1 поддерживаются только режимы "IMAGE" и "VIDEO".
            // Для обработки видео-потока кадр за кадром используется "VIDEO".
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
    }

    /**
     * Обрабатывает кадр видео и вызывает callback с результатом.
     * В версии 1.1.1 метод `detectAsync` отсутствует — вместо него
     * используется `detectForVideo` (для runningMode: "VIDEO").
     */
    detectForVideo(
        videoFrame: HTMLVideoElement,
        timestamp: number,
        callback: PoseLandmarkerCallback
    ) {
        if (!this.poseLandmarker) return;
        this.poseLandmarker.detectForVideo(videoFrame, timestamp, callback);
    }

    /** Освобождает ресурсы Wasm-рантайма. */
    close() {
        this.poseLandmarker?.close();
        this.poseLandmarker = null;
    }
}
