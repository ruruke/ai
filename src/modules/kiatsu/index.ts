import { bindThis } from '@/decorators.js';
import Message from '@/message.js';
import Module from '@/module.js';
import axios from 'axios';
import config from '@/config.js';

// 気圧データのインターフェイス
interface WeatherItem {
  time: string;
  weather: string;
  temp: string;
  pressure: string;
  pressure_level: string;
}

interface WeatherData {
  place_name: string;
  place_id: string;
  prefectures_id: string;
  dateTime: string;
  yesterday?: WeatherItem[];
  today: WeatherItem[];
  tomorrow?: WeatherItem[];
  dayaftertomorrow?: WeatherItem[];
  tommorow?: WeatherItem[]; // APIの誤字に対応するため
}

export default class extends Module {
  public readonly name = 'kiatsu';

  private currentPressure: string = "";
  private currentPressureLevel: string = "0";
  private currentLocationName: string = "不明な地点";
  private updateIntervalId: NodeJS.Timeout | null = null;
  private postIntervalId: NodeJS.Timeout | null = null;
  private errorCount = 0;

  private readonly stringPressureLevel: { [key: string]: (locationName: string, hPa: string) => string } = {
    "0": (locationName, hPa) => `${locationName}の気圧は${hPa}hPaだから問題ないかも。無理しないでね。`,
    "1": (locationName, hPa) => `${locationName}の気圧は${hPa}hPaだから問題ないかも。無理しないでね。`,
    "2": (locationName, hPa) => `${locationName}の気圧が${hPa}hPaでちょっとやばいかも。無理しないでね。`,
    "3": (locationName, hPa) => `${locationName}の気圧が${hPa}hPaでやばいかも！頭痛とか起きやすいから、ゆっくり休んでね。`,
    "4": (locationName, hPa) => `${locationName}の気圧が${hPa}hPaでかなりやばいかも！体調に気をつけてね。頭痛や気分の変化があったら休憩してね。`,
  };

  @bindThis
  public install() {
    this.startMonitoring();
    this.update(); // 初回実行

    return {
      mentionHook: this.mentionHook,
    };
  }

  @bindThis
  private startMonitoring(): void {
    // 設定された間隔で気圧データを更新
    this.updateIntervalId = setInterval(
      this.update,
      config.kiatsu?.updateIntervalMs ?? 10 * 60 * 1000
    );

    // 設定された間隔で投稿（レベルが高い場合のみ）
    this.postIntervalId = setInterval(
      this.post,
      config.kiatsu?.postIntervalMs ?? 12 * 60 * 60 * 1000
    );
  }

  @bindThis
  private async update() {
    try {
      const locationCode = config.kiatsu?.locationCode ?? "13102";
      const url = `https://zutool.jp/api/getweatherstatus/${locationCode}`;

      this.log(`気圧データ取得中... URL: ${url}`);

      const response = await axios.get<WeatherData>(url, {
        timeout: config.kiatsu?.requestTimeoutMs ?? 10000
      });

      const data = response.data;

      // 基本チェック
      if (!data || !data.today || !Array.isArray(data.today)) {
        this.log("Invalid data format received.");
        this.handleError();
        return;
      }

      const date = new Date();
      const hour = date.getHours().toString();
      const hourData = data.today.find(item => item.time === hour);

      if (!hourData) {
        this.log(`現在の時間 (${hour}) のデータが見つかりません。`);
        this.handleError();
        return;
      }

      this.currentPressureLevel = hourData.pressure_level;
      this.currentPressure = hourData.pressure;
      this.currentLocationName = data.place_name || "不明な地点";

      // APIから地点名を取得して表示
      this.log(`地点名: ${this.currentLocationName}, 気圧データを更新しました: ${this.currentPressure}hPa (レベル: ${this.currentPressureLevel})`);

      // エラーカウントをリセット
      this.errorCount = 0;
    } catch (error) {
      this.log("Failed to fetch weather status.");
      console.warn(error);
      this.handleError();
    }
  }

  @bindThis
  private handleError(): void {
    this.errorCount++;

    const maxErrors = config.kiatsu?.maxErrorRetries ?? 5;

    // エラーが閾値以上続くと監視を一時停止
    if (this.errorCount > maxErrors) {
      this.log("エラーが続いています。監視を一時停止します。");
      this.ai.post({
        text: "エラーが続いています。気圧監視を一時停止しました。"
      });

      if (this.updateIntervalId) {
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = null;
      }

      if (this.postIntervalId) {
        clearInterval(this.postIntervalId);
        this.postIntervalId = null;
      }

      // 設定された時間後に再開
      const cooldownMs = config.kiatsu?.errorCooldownMs ?? 60 * 60 * 1000;

      setTimeout(() => {
        this.log("監視を再開します。");
        this.ai.post({
          text: "気圧監視を再開しました。"
        });
        this.startMonitoring();
        this.update();
      }, cooldownMs);
    }
  }

  @bindThis
  private post() {
    const minPostLevel = config.kiatsu?.minPostLevel ?? 2;
    const currentLevel = parseInt(this.currentPressureLevel, 10);

    // 設定された最小レベル未満の場合は投稿しない
    if (currentLevel < minPostLevel) return;

    this.ai.post({
      text: this.stringPressureLevel[this.currentPressureLevel](this.currentLocationName, this.currentPressure),
    });
  }

  @bindThis
  private async mentionHook(message: Message) {
    if (!message.includes(["気圧", "きあつ", "kiatsu"])) return false;

    message.reply(this.stringPressureLevel[this.currentPressureLevel](this.currentLocationName, this.currentPressure), {
      immediate: true
    });

    return true;
  }
}