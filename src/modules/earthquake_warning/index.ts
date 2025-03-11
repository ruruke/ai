import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import axios from 'axios';

// 地震データの型定義
interface EarthquakeData {
  latest_time?: string;
  result: {
    message: string;
  };
  is_training: boolean;
  is_cancel: boolean;
  is_final: boolean;
  report_id: string;
  region_name: string;
  calcintensity: string;
  magunitude: number; // スペルミスを修正
  depth: string;
}

export default class extends Module {
  public readonly name = 'earthquake_warning';

  private readonly URLS = {
    LATEST: 'http://www.kmoni.bosai.go.jp/webservice/server/pros/latest.json',
    BASE: 'http://www.kmoni.bosai.go.jp/webservice/hypo/eew/',
  };

  private readonly CONFIG = {
    REQUEST_TIMEOUT_MS: 10000,
    MAX_ERROR_RETRIES: 5,
    ERROR_COOLDOWN_MS: 60000, // 1分のクールダウン
    MIN_INTENSITY_THRESHOLD: 3,
    MIN_magunitude_FOR_WEAK: 4.0,
    MAX_REPORT_HISTORY: 100,
    CHECK_INTERVAL_MS: 1000, // 確認間隔を設定値として分離
  };

  private diffTimeMs = 0;
  private reportHistory: string[] = [];
  private isLoading = false;
  private errorCount = 0;
  private intervalId: NodeJS.Timeout | null = null;

  @bindThis
  public install() {
    axios.defaults.timeout = this.CONFIG.REQUEST_TIMEOUT_MS;

    this.initializeModule()
      .then(this.startMonitoring)
      .catch(this.handleError);

    return {};
  }

  @bindThis
  private startMonitoring(): void {
    this.intervalId = setInterval(() => {
      if (!this.isLoading) {
        this.checkForEarthquakes().catch(this.handleError);
      }
    }, this.CONFIG.CHECK_INTERVAL_MS);
  }

  @bindThis
  private handleError(error: any): void {
    console.error('地震警報モジュールエラー:', error);
    this.errorCount++;

    if (this.errorCount > this.CONFIG.MAX_ERROR_RETRIES) {
      console.error('エラー最大再試行回数を超えました。地震警報モジュールを停止します。');
      this.putmsg('地震警報モジュールで継続的なエラーが発生しています。');

      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }

    setTimeout(() => {
      this.errorCount = Math.max(0, this.errorCount - 1); // 徐々に減少させる
    }, this.CONFIG.ERROR_COOLDOWN_MS);
  }

  @bindThis
  private async initializeModule(): Promise<void> {
    try {
      const response = await axios.get<EarthquakeData>(this.URLS.LATEST);
      const serverTime = this.parseTimeString(response.data.latest_time || '');
      const clientTime = new Date();

      // サーバー時間とクライアント時間の差を計算（1秒のオフセットを含む）
      this.diffTimeMs = serverTime.getTime() - clientTime.getTime() - 1000;
    } catch (error) {
      this.handleError(error);
      this.diffTimeMs = 0; // エラー時はデフォルト値を設定
    }
  }

  @bindThis
  private async checkForEarthquakes(): Promise<void> {
    this.isLoading = true;

    try {
      const timestamp = this.formatDateForRequest(
        new Date(new Date().getTime() + this.diffTimeMs)
      );

      const response = await axios.get<EarthquakeData>(
        `${this.URLS.BASE}${timestamp}.json`
      );

      const data = response.data;

      if (data.result.message === '' && data.is_training === false) {
        await this.processEarthquakeData(data);
      }

      // 履歴の管理
      this.manageReportHistory(data.report_id);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
    }
  }

  @bindThis
  private async processEarthquakeData(data: EarthquakeData): Promise<void> {
    const isNewReport = this.reportHistory.indexOf(data.report_id) === -1;

    if (isNewReport) {
      // 新しい地震情報
      if (!data.is_cancel) {
        await this.processNewEarthquake(data);
      }
    } else if (data.is_cancel) {
      // キャンセル情報
      await this.processCancellation(data);
    } else if (data.is_final) {
      // 最終情報 - 現在は何も処理しない
    }
  }

  @bindThis
  private async processNewEarthquake(data: EarthquakeData): Promise<void> {
    // calcintensityから震度を抽出（空白で分割）
    const intensityParts = data.calcintensity.split(' ');
    const intensity = parseInt(intensityParts[0], 10);
    const magunitude = data.magunitude;

    // 震度条件の確認
    if (intensity < this.CONFIG.MIN_INTENSITY_THRESHOLD) {
      return; // 震度3未満は無視
    }

    if (intensity < 4 && magunitude < this.CONFIG.MIN_magunitude_FOR_WEAK) {
      return; // 震度4未満かつマグニチュード4.0未満は無視
    }

    const message = this.generateEarthquakeMessage(intensity, data);
    await this.putmsg(message);
  }

  @bindThis
  private generateEarthquakeMessage(intensity: number, data: EarthquakeData): string {
    let message = '';

    // 震度に応じたメッセージを選択
    if (intensity < 4) {
      message += this.randomChoice([
        'ゆれ……',
        'ゆれ?',
        '地震ですかね？',
        '揺れそうな気がします！',
        'ゆ……？',
        'ゆ？',
        'ぽよん！',
        ':blobbounce:',
      ]);
    } else if (intensity === 4) {
      message += this.randomChoice([
        'ゆれ……！',
        '地震です！！',
        '結構揺れます！'
      ]);
    } else if (intensity === 5) {
      message += this.randomChoice([
        'ゆれます……！　おおきいです！！',
        'かなり揺れます！',
      ]);
    } else if (intensity === 6) {
      message += this.randomChoice([
        '大地震です！！',
        'めちゃくちゃ揺れます！'
      ]);
    } else if (intensity >= 7) {
      message += this.randomChoice(['！！　大地震です！！']);
    }

    message += '\n\n';
    message += `${this.formatDateTimeJP(new Date())}頃、地震速報を受信しました！\n`;
    message += `${data.region_name}あたりで震度${data.calcintensity}位の揺れが予想されます！\n`;
    message += `マグニチュードは${data.magunitude}、震源の深さは${data.depth}みたいです。\n`;

    return message;
  }

  @bindThis
  private async processCancellation(data: EarthquakeData): Promise<void> {
    const message = `さっき${data.region_name}で揺れたのは気のせいみたいです！`;
    await this.putmsg(message);
  }

  @bindThis
  private async processFinalReport(data: EarthquakeData): Promise<void> {
    // 何もしない
  }

  @bindThis
  private async putmsg(message: string): Promise<void> {
    try {
      this.ai.post({
        text: message,
      });
    } catch (error) {
      console.error('メッセージ送信エラー:', error);
    }
  }

  @bindThis
  private manageReportHistory(reportId: string): void {
    if (!this.reportHistory.includes(reportId)) {
      this.reportHistory.push(reportId);
    }

    // 履歴が最大数を超えたら古いものから削除
    while (this.reportHistory.length > this.CONFIG.MAX_REPORT_HISTORY) {
      this.reportHistory.shift();
    }
  }

  // ユーティリティ関数
  @bindThis
  private parseTimeString(str: string): Date {
    if (!str) return new Date(); // 空文字列の場合は現在時刻を返す

    let dt = str.split(' ');
    let ymd = dt[0].split('/');
    let hms = dt[1].split(':');

    return new Date(
      parseInt(ymd[0], 10),
      parseInt(ymd[1], 10) - 1,
      parseInt(ymd[2], 10),
      parseInt(hms[0], 10),
      parseInt(hms[1], 10),
      parseInt(hms[2], 10)
    );
  }

  @bindThis
  private formatDateForRequest(d: Date): string {
    return (
      String(d.getFullYear()) +
      ('0' + String(d.getMonth() + 1)).slice(-2) +
      ('0' + String(d.getDate())).slice(-2) +
      ('0' + String(d.getHours())).slice(-2) +
      ('0' + String(d.getMinutes())).slice(-2) +
      ('0' + String(d.getSeconds())).slice(-2)
    );
  }

  @bindThis
  private formatDateTimeJP(d: Date): string {
    return (
      String(d.getFullYear()) +
      '/' +
      ('0' + String(d.getMonth() + 1)).slice(-2) +
      '/' +
      ('0' + String(d.getDate())).slice(-2) +
      ' ' +
      ('0' + String(d.getHours())).slice(-2) +
      ':' +
      ('0' + String(d.getMinutes())).slice(-2) +
      ':' +
      ('0' + String(d.getSeconds())).slice(-2) +
      ' JST'
    );
  }

  @bindThis
  private randomChoice(a: Array<string>): string {
    const r = Math.floor(Math.random() * a.length);
    return a[r];
  }
}
