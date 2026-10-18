export interface Point3D {
    x: number;
    y: number;
    z: number;
    visibility?: number;
}

export type ExerciseState = "UP" | "DESCENDING" | "DOWN" | "ASCENDING";

export class SquatAnalyzer {
    private state: ExerciseState = "UP";
    public repCount: number = 0;
    private minKneeAngleAchieved: number = 180;

    // Вычисление угла между тремя точками (B — вершина)
    private calculateAngle(A: Point3D, B: Point3D, C: Point3D): number {
        const BA = { x: A.x - B.x, y: A.y - B.y, z: A.z - B.z };
        const BC = { x: C.x - B.x, y: C.y - B.y, z: C.z - B.z };

        const dotProduct = BA.x * BC.x + BA.y * BC.y + BA.z * BC.z;
        const magnitudeBA = Math.sqrt(BA.x ** 2 + BA.y ** 2 + BA.z ** 2);
        const magnitudeBC = Math.sqrt(BC.x ** 2 + BC.y ** 2 + BC.z ** 2);

        if (magnitudeBA === 0 || magnitudeBC === 0) return 0;

        let radian = Math.acos(dotProduct / (magnitudeBA * magnitudeBC));
        let angle = (radian * 180) / Math.PI;
        return angle;
    }

    public analyze(landmarks: Point3D[]): { feedback: string; state: ExerciseState } {
        if (!landmarks || landmarks.length < 29) {
            return { feedback: "Встаньте в полный рост", state: this.state };
        }

        // Индексы MediaPipe для правой стороны (бедро: 24, колено: 26, лодыжка: 28)
        const hip = landmarks[24];
        const knee = landmarks[26];
        const ankle = landmarks[28];
        const shoulder = landmarks[12];

        const kneeAngle = this.calculateAngle(hip, knee, ankle);
        let feedback = "";

        // Логика FSM для приседаний
        switch (this.state) {
            case "UP":
                if (kneeAngle < 150) {
                    this.state = "DESCENDING";
                    this.minKneeAngleAchieved = kneeAngle;
                }
                break;

            case "DESCENDING":
                if (kneeAngle < this.minKneeAngleAchieved) {
                    this.minKneeAngleAchieved = kneeAngle;
                }
                if (kneeAngle <= 95) {
                    this.state = "DOWN";
                }
                break;

            case "DOWN":
                if (kneeAngle > 105) {
                    this.state = "ASCENDING";
                }
                break;

            case "ASCENDING":
                if (kneeAngle > 165) {
                    // Проверка ошибок по завершении фазы
                    if (this.minKneeAngleAchieved > 110) {
                        feedback = "Приседайте глубже!";
                    } else {
                        this.repCount++;
                        feedback = "Отлично!";
                    }
                    this.state = "UP";
                }
                break;
        }

        return { feedback, state: this.state };
    }
}
