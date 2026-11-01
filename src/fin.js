// ============================================
// Наш итоговый проект 10 класс
// Умный тренажер который считает упражнения:
// приседания, отжимания, берпи, лодочка, штанга и гантели
// ============================================

// импортирую библиотеку mediapipe с интернета
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.0";

// получаю элементы со страницы
var video = document.getElementById("webcam");
var canvasElement = document.getElementById("output_canvas");
var canvasCtx = canvasElement.getContext("2d");
var statusDiv = document.getElementById("status");
var repsDiv = document.getElementById("reps");
var repsLabelDiv = document.getElementById("reps-label");
var btn = document.getElementById("btn");
var hintEl = document.getElementById("hint");
var sectionSub = document.getElementById("section-sub");

// переменные для работы программы
var poseLandmarker = null; // тут будет нейросеть
var webcamRunning = false; // включена ли камера
var lastVideoTime = -1;
var lastSpokenTime = 0;

// количество повторений (для лодочки это секунды)
var reps = 0;

// ================== ОПИСАНИЕ УПРАЖНЕНИЙ ==================
var EXERCISES = {
    squat: {
        name: "Приседания",
        repsLabel: "Повторений",
        sub: "Включите камеру, отойдите на 2-3 метра и делайте приседания",
        hint: "Совет: держите спину ровно, колени не должны уходить за носки.",
        startPhrase: "Тренировка началась. Приседайте."
    },
    pushup: {
        name: "Отжимания",
        repsLabel: "Повторений",
        sub: "Встаньте в упор лёжа так, чтобы камера видела всё тело, и отжимайтесь",
        hint: "Совет: держите тело прямой линией, не проваливайте поясницу.",
        startPhrase: "Тренировка началась. Отжимайтесь."
    },
    burpee: {
        name: "Берпи",
        repsLabel: "Повторений",
        sub: "Встаньте в полный рост, опуститесь на пол и встаньте обратно — это одно берпи",
        hint: "Совет: берпи = приседание + упор лёжа + подъём. Двигайтесь плавно.",
        startPhrase: "Тренировка началась. Делайте берпи."
    },
    superman: {
        name: "Лодочка",
        repsLabel: "Секунд",
        sub: "Лягте на живот, поднимите руки и ноги и держите «лодочку» — я посчитаю секунды",
        hint: "Совет: тяните руки вперёд, ноги назад, не задерживайте дыхание.",
        startPhrase: "Тренировка началась. Держите лодочку."
    },
    curl: {
        name: "Штанга и гантели",
        repsLabel: "Повторений",
        sub: "Возьмите штангу или гантели и сгибайте руки на бицепс — я посчитаю подъёмы",
        hint: "Совет: локти прижаты к телу, сгибайте руку полностью до конца.",
        startPhrase: "Тренировка началась. Сгибайте руки."
    }
};

var currentExercise = "squat"; // какое упражнение выбрано сейчас

// ================== НАСТРОЙКИ СЧЁТЧИКА ==================
// сколько кадров подряд нужно, чтобы сменить состояние (присел / встал).
// это защита от шума: нейросеть иногда на один кадр выдает мусорные
// координаты, и раньше из-за этого засчитывались лишние повторения
var NOISE_FRAMES = 3;

// ================== СОСТОЯНИЕ КАЖДОГО УПРАЖНЕНИЯ ==================
// у каждого упражнения свои переменные, чтобы при переключении не путались
// minAngle - самый маленький угол за время подхода (для проверки глубины)
// downFrames / upFrames - счётчики подряд идущих кадров для защиты от шума
var state = {
    squat: { stage: "up", minAngle: 999, downFrames: 0, upFrames: 0 },
    pushup: { stage: "up", minAngle: 999, downFrames: 0, upFrames: 0 },
    burpee: { stage: "up", downFrames: 0, upFrames: 0 },
    superman: { holding: false, lastTime: null, seconds: 0, holdFrames: 0 },
    curl: { stage: "extended", minAngle: 999, bentFrames: 0, extendedFrames: 0 }
};

// сбрасываю состояние всех упражнений
function resetAllStates() {
    state.squat = { stage: "up", minAngle: 999, downFrames: 0, upFrames: 0 };
    state.pushup = { stage: "up", minAngle: 999, downFrames: 0, upFrames: 0 };
    state.burpee = { stage: "up", downFrames: 0, upFrames: 0 };
    state.superman = { holding: false, lastTime: null, seconds: 0, holdFrames: 0 };
    state.curl = { stage: "extended", minAngle: 999, bentFrames: 0, extendedFrames: 0 };
    reps = 0;
    repsDiv.textContent = "0";
}

// функция для расчета угла между тремя точками (b это вершина угла)
// aspect - соотношение сторон видео (ширина/высота). Координаты у mediapipe
// нормализованы (от 0 до 1), поэтому без растяжения по x угол колена/локтя
// сильно искажается и счётчик работает неправильно
function calculateAngle(a, b, c, aspect) {
    aspect = aspect || 1;
    var ax = a.x * aspect, ay = a.y;
    var bx = b.x * aspect, by = b.y;
    var cx = c.x * aspect, cy = c.y;

    var radians = Math.atan2(cy - by, cx - bx) - Math.atan2(ay - by, ax - bx);
    var angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) {
        angle = 360 - angle;
    }
    return angle;
}

// проверяю что нужные точки тела видны камере.
// если человек вышел из кадра, нейросеть выдает мусорные координаты,
// и без этой проверки счётчик начинает считать что попало
function allVisible(landmarks, indexes) {
    for (var i = 0; i < indexes.length; i++) {
        var p = landmarks[indexes[i]];
        if (p && p.visibility !== undefined && p.visibility < 0.5) {
            return false;
        }
    }
    return true;
}

// функция которая говорит голосом
function speak(text, force = false) {
    var now = Date.now();
    // чтобы программа не спамила голосом, говорим не чаще чем раз в 3 секунды
    if (!force && now - lastSpokenTime < 3000) return;
    lastSpokenTime = now;

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    speechSynthesis.speak(utterance);
}

// ================== 1. ПРИСЕДАНИЯ ==================
// точки: 23 левое бедро, 25 левое колено, 27 левая лодыжка
// логика с гистерезисом:
//   - присел: угол меньше 105 градусов (3 кадра подряд)
//   - встал: угол больше 160 градусов (3 кадра подряд)
//   - повторение засчитывается только если присед был глубоким (минимальный угол меньше 135)
function analyzeSquat(landmarks, aspect) {
    var st = state.squat;

    if (!allVisible(landmarks, [23, 25, 27])) {
        return "Не видно ног, отойдите дальше 🔍";
    }

    var kneeAngle = calculateAngle(landmarks[23], landmarks[25], landmarks[27], aspect);

    // запоминаю самую глубокую точку приседа
    if (kneeAngle < st.minAngle) {
        st.minAngle = kneeAngle;
    }

    // гистерезис с защитой от шума
    if (kneeAngle < 105) {
        st.downFrames++;
        st.upFrames = 0;
    } else if (kneeAngle > 160) {
        st.upFrames++;
        st.downFrames = 0;
    } else {
        st.downFrames = 0;
        st.upFrames = 0;
    }

    // человек присел
    if (st.stage === "up" && st.downFrames >= NOISE_FRAMES) {
        st.stage = "down";
        st.minAngle = kneeAngle; // отсчитываю глубину этого приседа заново
        return "Приседайте...";
    }

    // человек встал — считаю повторение только если присел достаточно глубоко
    if (st.stage === "down" && st.upFrames >= NOISE_FRAMES) {
        st.stage = "up";
        if (st.minAngle > 135) {
            speak("Ниже");
            return "Ниже! Приседание не засчитано ";
        }
        reps++;
        repsDiv.textContent = reps;
        return "Повторение! ";
    }

    if (st.stage === "down") {
        if (kneeAngle > 135) {
            return "Ниже! ";
        }
        return "Отлично! Глубокий присед ";
    }
    return "Исходное положение 🧍";
}

// ================== 2. ОТЖИМАНИЯ ==================
// точки: 11 плечо, 13 локоть, 15 запястье (смотрим угол в локте)
// та же логика что у приседаний: опустился ниже 100°, поднялся выше 155°,
// засчитываем только если опустился достаточно низко (минимальный угол меньше 110°)
function analyzePushup(landmarks, aspect) {
    var st = state.pushup;

    if (!allVisible(landmarks, [11, 13, 15])) {
        return "Не видно рук, встаньте боком к камере ";
    }

    var elbowAngle = calculateAngle(landmarks[11], landmarks[13], landmarks[15], aspect);

    if (elbowAngle < st.minAngle) {
        st.minAngle = elbowAngle;
    }

    if (elbowAngle < 100) {
        st.downFrames++;
        st.upFrames = 0;
    } else if (elbowAngle > 155) {
        st.upFrames++;
        st.downFrames = 0;
    } else {
        st.downFrames = 0;
        st.upFrames = 0;
    }

    if (st.stage === "up" && st.downFrames >= NOISE_FRAMES) {
        st.stage = "down";
        st.minAngle = elbowAngle;
        return "Опускайтесь...";
    }

    if (st.stage === "down" && st.upFrames >= NOISE_FRAMES) {
        st.stage = "up";
        if (st.minAngle > 110) {
            speak("Ниже");
            return "Ниже! Отжимание не засчитано ";
        }
        reps++;
        repsDiv.textContent = reps;
        return "Повторение! ";
    }

    if (st.stage === "down") {
        if (elbowAngle > 110) {
            return "Ниже! ";
        }
        return "Отлично! Глубокое отжимание ";
    }
    return "Руки выпрямлены ";
}

// ================== 3. БЕРПИ ==================
// берпи это когда человек встал -> лёг на пол -> встал.
// я смотрю на высоту бедра: когда стоишь бедро высоко, когда лежишь — низко.
// тоже требует несколько кадров подряд, чтобы мусорный кадр не засчитался
function analyzeBurpee(landmarks) {
    var st = state.burpee;

    var hipY = (landmarks[23].y + landmarks[24].y) / 2;
    var shoulderY = (landmarks[11].y + landmarks[12].y) / 2;

    // насколько тело вертикально: когда стоишь плечи сильно выше бедер
    var torsoHeight = hipY - shoulderY;

    if (st.stage === "up") {
        // стоим, ждем когда человек опустится на пол
        if (hipY > 0.58 || torsoHeight < 0.08) {
            st.downFrames++;
            st.upFrames = 0;
        } else {
            st.downFrames = 0;
        }
        if (st.downFrames >= NOISE_FRAMES) {
            st.stage = "down";
            st.downFrames = 0;
            return "Теперь встаньте обратно! ";
        }
        return "Опуститесь на пол ";
    }
    else {
        // лежали, ждем когда встанет
        if (hipY < 0.52 && torsoHeight > 0.12) {
            st.upFrames++;
            st.downFrames = 0;
        } else {
            st.upFrames = 0;
        }
        if (st.upFrames >= NOISE_FRAMES) {
            st.stage = "up";
            st.upFrames = 0;
            reps++;
            repsDiv.textContent = reps;
            return "Берпи засчитано! ";
        }
        return "Вставайте! ";
    }
}

// ================== 4. ЛОДОЧКА ==================
// это статическое упражнение, поэтому считаю не повторения а секунды.
// лодочка: человек лежит горизонтально и тело прямое (не согнутое)
function analyzeSuperman(landmarks, now, aspect) {
    var st = state.superman;

    var shoulder = landmarks[11];
    var hip = landmarks[23];
    var knee = landmarks[25];

    if (!allVisible(landmarks, [11, 23, 25])) {
        st.holding = false;
        st.holdFrames = 0;
        return "Лягте так, чтобы камера видела всё тело 🔍";
    }

    // угол тела: если тело прямое то угол больше 145
    var bodyAngle = calculateAngle(shoulder, hip, knee, aspect);

    // горизонтальность: когда лежишь плечо и бедро на одной высоте
    var horizontal = Math.abs(shoulder.y - hip.y) < 0.15;

    if (bodyAngle > 145 && horizontal) {
        // секунды начинаю считать только после 3 кадров подряд в правильной позе,
        // чтобы одиночный удачный кадр не добавил время
        st.holdFrames++;
        if (st.holdFrames < NOISE_FRAMES) {
            return "Держите! 🎯";
        }

        if (!st.holding) {
            st.holding = true;
            st.lastTime = now;
        }
        st.seconds += (now - st.lastTime) / 1000;
        st.lastTime = now;

        var newSeconds = Math.floor(st.seconds);
        if (newSeconds > reps) {
            reps = newSeconds;
            repsDiv.textContent = reps;
        }
        return "Держите! ";
    }

    // человек опустился — пауза
    st.holding = false;
    st.holdFrames = 0;
    return "Поднимите руки и ноги! ";
}

// ================== 5. ШТАНГА И ГАНТЕЛИ (СГИБАНИЕ НА БИЦЕПС) ==================
// точки: 11 плечо, 13 локоть, 15 запястье. Смотрю угол в локте.
// беру ту руку которая согнута сильнее (меньший угол), так работает и штанга и гантели
// засчитываю повторение только если рука согнулась меньше чем до 70°
function analyzeCurl(landmarks, aspect) {
    var st = state.curl;

    if (!allVisible(landmarks, [11, 13, 15]) && !allVisible(landmarks, [12, 14, 16])) {
        return "Не видно рук ";
    }

    var angleRight = calculateAngle(landmarks[11], landmarks[13], landmarks[15], aspect);
    var angleLeft = calculateAngle(landmarks[12], landmarks[14], landmarks[16], aspect);
    var angle = Math.min(angleRight, angleLeft);

    if (angle < st.minAngle) {
        st.minAngle = angle;
    }

    if (angle < 70) {
        st.bentFrames++;
        st.extendedFrames = 0;
    } else if (angle > 150) {
        st.extendedFrames++;
        st.bentFrames = 0;
    } else {
        st.bentFrames = 0;
        st.extendedFrames = 0;
    }

    // рука согнулась
    if (st.stage === "extended" && st.bentFrames >= NOISE_FRAMES) {
        st.stage = "bent";
        st.minAngle = angle;
        return "Согнули! 💪";
    }

    // рука выпрямилась — считаю повторение
    if (st.stage === "bent" && st.extendedFrames >= NOISE_FRAMES) {
        st.stage = "extended";
        if (st.minAngle > 90) {
            return "Сгибайте руку полностью! Повторение не засчитано ⚠️";
        }
        reps++;
        repsDiv.textContent = reps;
        return "Повторение! 💪";
    }

    if (st.stage === "bent" && angle > 100) {
        return "Сгибайте сильнее! ⚠️";
    }
    if (st.stage === "bent") {
        return "Согнули! 💪";
    }
    return "Руки опущены 🧍";
}

// главная функция анализа: выбирает нужное упражнение
function analyzeExercise(landmarks, now, aspect) {
    if (currentExercise === "squat") return analyzeSquat(landmarks, aspect);
    if (currentExercise === "pushup") return analyzePushup(landmarks, aspect);
    if (currentExercise === "burpee") return analyzeBurpee(landmarks);
    if (currentExercise === "superman") return analyzeSuperman(landmarks, now, aspect);
    if (currentExercise === "curl") return analyzeCurl(landmarks, aspect);
    return "";
}

// ================== ПЕРЕКЛЮЧЕНИЕ УПРАЖНЕНИЙ ==================
var exerciseButtons = document.querySelectorAll(".exercise-btn");

exerciseButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        // меняю активную кнопку
        exerciseButtons.forEach(function (b) { b.classList.remove("active"); });
        button.classList.add("active");

        // меняю упражнение и сбрасываю счетчик
        currentExercise = button.dataset.exercise;
        resetAllStates();

        // обновляю тексты на странице
        repsLabelDiv.textContent = EXERCISES[currentExercise].repsLabel;
        hintEl.textContent = EXERCISES[currentExercise].hint;
        sectionSub.textContent = EXERCISES[currentExercise].sub;
        statusDiv.textContent = "Выбрано: " + EXERCISES[currentExercise].name;
        statusDiv.className = "";
    });
});

// тут загружается нейросеть которая видит человека
async function initPose() {
    statusDiv.textContent = "Загрузка нейросети...";
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
    btn.textContent = "Начать тренировку";
    statusDiv.textContent = "Готов к работе";
}

// главный цикл программы, работает много раз в секунду
async function predictWebcam() {
    if (!webcamRunning) return;

    // если видео еще не загрузилось то ждем
    if (video.videoWidth === 0 || video.videoHeight === 0) {
        window.requestAnimationFrame(predictWebcam);
        return;
    }

    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;

        poseLandmarker.detectForVideo(video, performance.now(), (result) => {
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

            // рисую кадр с камеры на канвас чтобы все было видно
            canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

            if (result.landmarks && result.landmarks.length > 0) {
                var landmarks = result.landmarks[0];

                // рисую скелет
                var drawingUtils = new DrawingUtils(canvasCtx);
                drawingUtils.drawLandmarks(landmarks, {
                    radius: (data) => DrawingUtils.lerp(data.from.z, -0.15, 0.1, 5, 1)
                });
                drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS);

                // ================== АНАЛИЗ УПРАЖНЕНИЯ ==================
                // передаю соотношение сторон видео, чтобы углы считались точно
                var aspect = video.videoWidth / video.videoHeight;
                var feedback = analyzeExercise(landmarks, performance.now(), aspect);

                statusDiv.textContent = feedback;
                // если в сообщении есть восклицательный знак со значком то это ошибка
                if (feedback.indexOf("") !== -1) {
                    statusDiv.className = "bad";
                } else if (feedback.indexOf("") !== -1 || feedback.indexOf("") !== -1 || feedback.indexOf("") !== -1 || feedback.indexOf("") !== -1) {
                    statusDiv.className = "good";
                } else {
                    statusDiv.className = "";
                }
            } else {
                statusDiv.textContent = "Человек не найден ";
                statusDiv.className = "bad";
            }
        });
    }

    window.requestAnimationFrame(predictWebcam);
}

// выключаем камеру
function stopCamera() {
    if (video.srcObject) {
        var tracks = video.srcObject.getTracks();
        tracks.forEach(track => track.stop());
        video.srcObject = null;
    }
}

// запуск камеры
async function startCamera() {
    try {
        // сначала пробую обычную камеру
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: "user" }
        });
        video.srcObject = stream;
        await video.play();
        predictWebcam();
    } catch (err) {
        console.warn("первая попытка не сработала", err);
        // если не получилось то пробую просто любую камеру
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await video.play();
        predictWebcam();
    }
}

// если камера не работает то пишем почему
function showCameraError(err) {
    console.error(err);
    if (err.name === "NotAllowedError") {
        statusDiv.textContent = "Доступ к камере запрещён. Разрешите доступ в браузере.";
    } else if (err.name === "NotFoundError") {
        statusDiv.textContent = "Камера не найдена. Может она занята другим приложением (Zoom, FaceTime)?";
    } else if (err.name === "NotReadableError") {
        statusDiv.textContent = "Камера занята другим приложением. Закройте его и попробуйте снова.";
    } else {
        statusDiv.textContent = "Ошибка камеры: " + err.message;
    }
}

// что происходит когда нажали на кнопку
async function enableCam() {
    if (!poseLandmarker) {
        statusDiv.textContent = "Загрузка модели...";
        return;
    }

    // если тренировка уже идет то останавливаем
    if (webcamRunning) {
        webcamRunning = false;
        btn.textContent = "▶ Начать тренировку";
        statusDiv.textContent = "Тренировка остановлена";
        stopCamera();
        return;
    }

    webcamRunning = true;
    btn.textContent = "⏸ Остановить";

    // сбрасываю счетчик при каждом старте
    resetAllStates();

    // говорю фразу здесь потому что браузер не дает говорить звук без нажатия кнопки
    speak(EXERCISES[currentExercise].startPhrase, true);

    try {
        await startCamera();
    } catch (err) {
        webcamRunning = false;
        btn.textContent = " Начать тренировку";
        showCameraError(err);
    }
}

btn.addEventListener("click", enableCam);

// запускаем загрузку нейросети когда страница открылась
initPose().catch(err => {
    console.error(err);
    statusDiv.textContent = "Ошибка загрузки модели";
});
