import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import WebSocket from 'ws';
import config from '@/config.js';

// Wolfx APIからの地震データの型定義
interface WolfxEarthquakeData {
  type: string;
  Title: string;
  CodeType: string;
  Issue: {
    Source: string;
    Status: string;
  };
  EventID: string;
  Serial: number;
  AnnouncedTime: string;
  OriginTime: string;
  Hypocenter: string;
  Latitude: number;
  Longitude: number;
  Magunitude: number;
  Depth: number;
  MaxIntensity: string;
  Accuracy: {
    Epicenter: string;
    Depth: string;
    Magnitude: string;
  };
  MaxIntChange?: {
    String: string;
    Reason: string;
  };
  WarnArea?: {
    Chiiki: string;
    Shindo1: string;
    Shindo2: string;
    Time: string;
    Type: string;
    Arrive: boolean;
  }[];
  isSea: boolean;
  isTraining: boolean;
  isAssumption: boolean;
  isWarn: boolean;
  isFinal: boolean;
  isCancel: boolean;
  OriginalText: string;
}

// WebSocketからのハートビートデータの型定義
interface HeartbeatData {
  type: string;
  ver: string;
  id: string;
  timestamp: number;
}

interface P2PQuakeTsunamiData {
  id: string;
  code: number;
  time: string;
  cancelled: boolean;
  issue: {
    source?: string;
    time: string;
    type: string;
  };
  areas?: TsunamiArea[];
}

interface TsunamiArea {
  grade?: string;
  immediate?: boolean;
  name?: string;
  firstHeight?: {
    arrivalTime?: string;
    condition?: string;
  };
  maxHeight?: {
    description?: string;
    value?: number;
  };
}

// 地震イベントを追跡するための型定義
interface EarthquakeEvent {
  eventId: string;
  initialPostId: string;
  lastUpdate: number;
  reportCount: number;
  isFinal: boolean;
  isCancel: boolean;
  connectionId: string;
}

interface EarthquakeMessageGenerator {
  generateInitialMessage(data: WolfxEarthquakeData): string;
  generateUpdateMessage(
    data: WolfxEarthquakeData,
    existingEvent: EarthquakeEvent
  ): string;
  generateFinalMessage(data: WolfxEarthquakeData): string;
  generateCancellationMessage(): string;
}

export default class extends Module {
  public readonly name = 'earthquake_warning';

  private readonly WOLFX_WEBSOCKET_URL = 'wss://ws-api.wolfx.jp/jma_eew';
  private readonly P2P_WEBSOCKET_URL =
    config.earthquakeWarning?.p2pWebSocketUrl ?? 'wss://api.p2pquake.net/v2/ws';
  // private readonly WOLFX_WEBSOCKET_URL = "ws://localhost:8765/"; // ローカルでのテスト用
  private ws: WebSocket | null = null;
  private p2pWs: WebSocket | null = null;
  private reconnectAttempts = 0;
  private p2pReconnectAttempts = 0;
  private maxReconnectAttempts =
    config.earthquakeWarning?.websocketReconnectMaxAttempts ?? 10;
  private reconnectDelay =
    config.earthquakeWarning?.websocketReconnectDelay ?? 5000; // ms
  private maxReconnectDelay =
    config.earthquakeWarning?.maxReconnectDelay ?? 300000; // 最大5分
  private p2pReconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat = 0;
  private activeEvents: Map<string, EarthquakeEvent> = new Map();
  private lastEarthquakeData: Map<string, WolfxEarthquakeData> = new Map();
  private processedTsunamiIds: Map<string, number> = new Map();
  // 接続後のデータ無視制御用
  private ignoreInitialData = true;
  private initialDataTimer: NodeJS.Timeout | null = null;
  private connectionId: string = ''; // 空文字列で初期化

  @bindThis
  public install() {
    if (!config.earthquakeWarning?.enabled) {
      this.log('地震警報モジュールは無効になっています。');
      return {};
    }
    this.log('地震警報モジュールを初期化しています...');
    this.connectionId = this.generateConnectionId();
    this.connectWebSocket();
    this.connectP2PWebSocket();
    return {};
  }

  private generateConnectionId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  @bindThis
  private connectWebSocket(): void {
    try {
      this.log('WebSocketに接続しています...');

      // WebSocket接続オプションを設定
      const wsOptions: any = {};

      // User-Agentを設定（設定ファイルから取得）
      if (config.userAgent?.websocket) {
        wsOptions.headers = {
          'User-Agent': config.userAgent?.websocket,
        };
      }

      this.ws = new WebSocket(this.WOLFX_WEBSOCKET_URL, [], wsOptions);

      // 安全なイベントリスナーを設定
      this.ws.on('open', this.safeEventHandler(this.onWebSocketOpen));
      this.ws.on('message', this.safeEventHandler(this.onWebSocketMessage));
      this.ws.on('error', this.safeEventHandler(this.onWebSocketError));
      this.ws.on('close', this.safeEventHandler(this.onWebSocketClose));

      // ハートビートチェック開始
      this.startHeartbeatCheck();
    } catch (error) {
      this.log(`WebSocket接続エラー: ${error}`);
      this.scheduleReconnect();
    }
  }

  @bindThis
  private connectP2PWebSocket(): void {
    try {
      if (
        this.p2pWs &&
        (this.p2pWs.readyState === WebSocket.CONNECTING ||
          this.p2pWs.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      this.log('P2PQuake WebSocketに接続しています...');

      const wsOptions: any = {};

      if (config.userAgent?.websocket) {
        wsOptions.headers = {
          'User-Agent': config.userAgent?.websocket,
        };
      }

      this.p2pWs = new WebSocket(this.P2P_WEBSOCKET_URL, [], wsOptions);

      this.p2pWs.on('open', this.safeP2PEventHandler(this.onP2PWebSocketOpen));
      this.p2pWs.on(
        'message',
        this.safeP2PEventHandler(this.onP2PWebSocketMessage)
      );
      this.p2pWs.on(
        'error',
        this.safeP2PEventHandler(this.onP2PWebSocketError)
      );
      this.p2pWs.on(
        'close',
        this.safeP2PEventHandler(this.onP2PWebSocketClose)
      );
    } catch (error) {
      this.log(`P2PQuake WebSocket接続エラー: ${error}`);
      this.scheduleP2PReconnect();
    }
  }

  @bindThis
  private safeEventHandler(handler: Function): (...args: any[]) => void {
    return (...args: any[]) => {
      try {
        handler.apply(this, args);
      } catch (error) {
        this.log(`イベントハンドラでエラーが発生しました: ${error}`);
        // 重大なエラーの場合は再接続を試みる
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.log('接続を再確立します...');
          this.closeConnection();
          this.scheduleReconnect();
        }
      }
    };
  }

  @bindThis
  private safeP2PEventHandler(handler: Function): (...args: any[]) => void {
    return (...args: any[]) => {
      try {
        handler.apply(this, args);
      } catch (error) {
        this.log(`P2PQuakeイベントハンドラでエラーが発生しました: ${error}`);
        this.closeP2PConnection();
        this.scheduleP2PReconnect();
      }
    };
  }

  @bindThis
  private onWebSocketOpen(): void {
    this.log('WebSocket接続が確立されました');
    this.reconnectAttempts = 0;

    // 接続直後のデータを無視するフラグを設定
    this.ignoreInitialData = true;

    // 一定時間後にフラグをリセット（10秒後）
    this.initialDataTimer = setTimeout(() => {
      this.ignoreInitialData = false;
      this.initialDataTimer = null;
      this.log('初期データの無視期間が終了しました');
    }, 10000);
  }

  @bindThis
  private onWebSocketMessage(data: WebSocket.Data): void {
    try {
      if (!data) {
        this.log('空のメッセージを受信しました');
        return;
      }

      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (parseError) {
        this.log(
          `JSON解析エラー: ${parseError}、受信データ: ${data
            .toString()
            .slice(0, 100)}`
        );
        return;
      }

      // ハートビートメッセージの処理
      if (message.type === 'heartbeat') {
        this.handleHeartbeat(message);
        return;
      }

      // 地震情報の処理
      if (message.type === 'jma_eew') {
        this.handleEarthquakeData(message);
      }
    } catch (error) {
      this.log(`メッセージ処理エラー: ${error}`);
    }
  }

  @bindThis
  private onWebSocketError(error: Error): void {
    // エラータイプに基づいた特定のハンドリング
    if (error.message.includes('ECONNREFUSED')) {
      this.log(`接続が拒否されました: ${error.message}`);
    } else if (error.message.includes('ETIMEDOUT')) {
      this.log(`接続がタイムアウトしました: ${error.message}`);
    } else if (error.message.includes('ENOTFOUND')) {
      this.log(`ホストが見つかりません: ${error.message}`);
    } else {
      this.log(`WebSocketエラー: ${error.message}`);
    }

    // エラー後に再接続を試みる
    this.scheduleReconnect();
  }

  @bindThis
  private onWebSocketClose(code: number, reason: string): void {
    this.log(`WebSocket接続が閉じられました: ${code} ${reason}`);
    this.stopHeartbeatCheck();
    this.scheduleReconnect();
  }

  @bindThis
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('最大再接続試行回数を超えました。再接続を停止します。');
      return;
    }

    this.reconnectAttempts++;

    // 指数バックオフ+ジッター方式で再接続遅延を計算
    const baseDelay =
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    const jitter = 0.1 * baseDelay * (Math.random() - 0.5); // ±5%のジッター
    let delay = baseDelay + jitter;

    // 最大遅延時間を設定
    delay = Math.min(delay, this.maxReconnectDelay);

    this.log(
      `${Math.round(delay)}ms後に再接続を試みます (試行: ${
        this.reconnectAttempts
      }/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  @bindThis
  private onP2PWebSocketOpen(): void {
    this.log('P2PQuake WebSocket接続が確立されました');
    this.p2pReconnectAttempts = 0;

    if (this.p2pReconnectTimer) {
      clearTimeout(this.p2pReconnectTimer);
      this.p2pReconnectTimer = null;
    }
  }

  @bindThis
  private onP2PWebSocketMessage(data: WebSocket.Data): void {
    try {
      if (!data) {
        return;
      }

      const parsed = JSON.parse(data.toString()) as unknown;

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (!('code' in parsed) || parsed.code !== 552) {
        return;
      }

      void this.handleTsunamiData(parsed);
    } catch (error) {
      this.log(`P2PQuakeメッセージ処理エラー: ${error}`);
    }
  }

  @bindThis
  private onP2PWebSocketError(error: Error): void {
    this.log(`P2PQuake WebSocketエラー: ${error.message}`);
    this.closeP2PConnection();
    this.scheduleP2PReconnect();
  }

  @bindThis
  private onP2PWebSocketClose(code: number, reason: string): void {
    this.log(`P2PQuake WebSocket接続が閉じられました: ${code} ${reason}`);
    this.p2pWs = null;
    this.scheduleP2PReconnect();
  }

  @bindThis
  private scheduleP2PReconnect(): void {
    if (this.p2pReconnectTimer) {
      return;
    }

    if (this.p2pReconnectAttempts >= this.maxReconnectAttempts) {
      this.log(
        'P2PQuake: 最大再接続試行回数を超えました。再接続を停止します。'
      );
      return;
    }

    this.p2pReconnectAttempts++;

    const baseDelay =
      this.reconnectDelay * Math.pow(1.5, this.p2pReconnectAttempts - 1);
    const jitter = 0.1 * baseDelay * (Math.random() - 0.5);
    const delay = Math.min(baseDelay + jitter, this.maxReconnectDelay);

    this.log(
      `${Math.round(delay)}ms後にP2PQuakeへ再接続を試みます (試行: ${
        this.p2pReconnectAttempts
      }/${this.maxReconnectAttempts})`
    );

    this.p2pReconnectTimer = setTimeout(() => {
      this.p2pReconnectTimer = null;
      this.connectP2PWebSocket();
    }, delay);
  }

  @bindThis
  private handleHeartbeat(data: HeartbeatData): void {
    if (
      !data ||
      typeof data !== 'object' ||
      !('type' in data) ||
      data.type !== 'heartbeat'
    ) {
      this.log(
        `無効なハートビートデータを受信しました: ${JSON.stringify(data)}`
      );
      return;
    }

    this.lastHeartbeat = Date.now();

    // ハートビートに応答
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send('ping');
    }
  }

  @bindThis
  private startHeartbeatCheck(): void {
    this.lastHeartbeat = Date.now();
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      // 2分以上ハートビートがない場合は再接続
      if (now - this.lastHeartbeat > 120000) {
        this.log('ハートビートのタイムアウト。再接続します。');
        this.closeConnection();
        this.connectWebSocket();
      }
    }, 60000);
  }

  @bindThis
  private stopHeartbeatCheck(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  @bindThis
  private closeConnection(): void {
    // 初期データ無視タイマーをクリア
    if (this.initialDataTimer) {
      clearTimeout(this.initialDataTimer);
      this.initialDataTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (error) {
        this.log(`接続終了エラー: ${error}`);
      } finally {
        this.ws = null;
      }
    }
  }

  @bindThis
  private closeP2PConnection(): void {
    if (this.p2pReconnectTimer) {
      clearTimeout(this.p2pReconnectTimer);
      this.p2pReconnectTimer = null;
    }

    if (this.p2pWs) {
      try {
        this.p2pWs.terminate();
      } catch (error) {
        this.log(`P2PQuake接続終了エラー: ${error}`);
      } finally {
        this.p2pWs = null;
      }
    }
  }

  @bindThis
  private async handleTsunamiData(data: unknown): Promise<void> {
    if (!this.validateTsunamiData(data)) {
      this.log('無効な津波データを受信しました。処理をスキップします。');
      return;
    }

    if (this.processedTsunamiIds.has(data.id)) {
      return;
    }

    this.processedTsunamiIds.set(data.id, Date.now());
    const message = this.generateTsunamiMessage(data);

    try {
      await this.ai.post({
        text: message,
      });

      this.log(`津波情報を送信しました: ${data.id}`);
      this.pruneProcessedTsunamiIds();
    } catch (error) {
      // 投稿失敗時は再受信で再試行できるようにする
      this.processedTsunamiIds.delete(data.id);
      this.log(`津波情報の送信エラー: ${error}`);
    }
  }

  @bindThis
  private validateTsunamiData(data: unknown): data is P2PQuakeTsunamiData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const tsunamiData = data as Partial<P2PQuakeTsunamiData>;

    if (typeof tsunamiData.id !== 'string') {
      return false;
    }

    if (tsunamiData.code !== 552) {
      return false;
    }

    if (typeof tsunamiData.time !== 'string') {
      return false;
    }

    if (typeof tsunamiData.cancelled !== 'boolean') {
      return false;
    }

    if (!tsunamiData.issue || typeof tsunamiData.issue !== 'object') {
      return false;
    }

    if (
      typeof tsunamiData.issue.time !== 'string' ||
      typeof tsunamiData.issue.type !== 'string'
    ) {
      return false;
    }

    if (tsunamiData.areas !== undefined && !Array.isArray(tsunamiData.areas)) {
      return false;
    }

    return true;
  }

  @bindThis
  private generateTsunamiMessage(data: P2PQuakeTsunamiData): string {
    const issueTime = this.formatP2PDateTime(data.issue.time || data.time);
    const issueSource = data.issue.source || '気象庁';

    if (data.cancelled) {
      return (
        `🌊 津波情報\n\n` +
        `${issueTime}、${issueSource}の津波予報は解除されました。\n` +
        `念のため沿岸部では安全確認を続けてください。`
      );
    }

    const areas = Array.isArray(data.areas) ? data.areas : [];
    const gradeCounts = new Map<string, number>();

    for (const area of areas) {
      const grade = this.convertTsunamiGrade(area.grade);
      gradeCounts.set(grade, (gradeCounts.get(grade) ?? 0) + 1);
    }

    const gradeSummary = Array.from(gradeCounts.entries())
      .map(([grade, count]) => `${grade} ${count}地域`)
      .join(' / ');

    let message = '🌊 津波情報を受信しました\n\n';
    message += `${issueTime}、${issueSource}から津波予報が発表されました。\n`;

    if (gradeSummary) {
      message += `区分: ${gradeSummary}\n`;
    }

    if (areas.length === 0) {
      message += '\n対象地域の詳細は確認できませんでした。';
      return message;
    }

    message += '\n対象地域:\n';
    const displayAreas = areas.slice(0, 6);

    for (const area of displayAreas) {
      message += `・${this.formatTsunamiArea(area)}\n`;
    }

    if (areas.length > displayAreas.length) {
      message += `・他${areas.length - displayAreas.length}地域\n`;
    }

    message += '\n海岸や河口付近から離れ、自治体の避難情報に従ってください。';
    return message;
  }

  @bindThis
  private formatTsunamiArea(area: TsunamiArea): string {
    const name = area.name || '名称不明';
    const grade = this.convertTsunamiGrade(area.grade);
    const details: string[] = [];

    if (area.immediate) {
      details.push('直ちに津波来襲と予測');
    }

    if (area.firstHeight?.condition) {
      details.push(area.firstHeight.condition);
    } else if (area.firstHeight?.arrivalTime) {
      details.push(`第1波: ${area.firstHeight.arrivalTime}`);
    }

    if (area.maxHeight?.description) {
      details.push(`予想高さ: ${area.maxHeight.description}`);
    } else if (typeof area.maxHeight?.value === 'number') {
      details.push(`予想高さ: ${area.maxHeight.value}m`);
    }

    if (details.length === 0) {
      return `${name} (${grade})`;
    }

    return `${name} (${grade}) ${details.join(' / ')}`;
  }

  @bindThis
  private convertTsunamiGrade(grade?: string): string {
    if (grade === 'MajorWarning') return '大津波警報';
    if (grade === 'Warning') return '津波警報';
    if (grade === 'Watch') return '津波注意報';
    return '不明';
  }

  @bindThis
  private formatP2PDateTime(value: string): string {
    const parsed = new Date(value);

    if (isNaN(parsed.getTime())) {
      return `${value} JST`;
    }

    return this.formatJSTDateTime(parsed);
  }

  @bindThis
  private pruneProcessedTsunamiIds(): void {
    if (this.processedTsunamiIds.size < 500) {
      return;
    }

    const expiryMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const [id, processedAt] of this.processedTsunamiIds) {
      if (now - processedAt > expiryMs) {
        this.processedTsunamiIds.delete(id);
      }
    }
  }

  @bindThis
  private handleEarthquakeData(data: WolfxEarthquakeData): void {
    // データの基本検証
    if (!this.validateEarthquakeData(data)) {
      this.log('無効な地震データを受信しました。処理をスキップします。');
      return;
    }

    // 接続直後のデータは無視
    if (this.ignoreInitialData) {
      this.log(
        `接続直後のデータのため無視します: ${data.Hypocenter} M${data.Magunitude}`
      );
      return;
    }

    // トレーニングデータは無視
    if (data.isTraining) {
      this.log('トレーニングデータを受信しました（処理をスキップ）');
      return;
    }

    const eventId = data.EventID;
    const existingEvent = this.activeEvents.get(eventId);

    // イベントの処理
    if (!existingEvent) {
      // 新しい地震イベント
      if (!this.shouldReportEarthquake(data)) {
        this.log(
          `報告基準を満たさない地震を検出: ${data.Hypocenter} M${data.Magunitude}`
        );
        return;
      }

      this.processNewEarthquake(data);
    } else if (data.isCancel && !existingEvent.isCancel) {
      // キャンセル情報
      this.processCancellation(data, existingEvent);
    } else if (data.isFinal && !existingEvent.isFinal) {
      // 最終報
      this.processFinalReport(data, existingEvent);
    } else {
      // 続報
      this.processUpdateReport(data, existingEvent);
    }
  }

  @bindThis
  private validateEarthquakeData(data: any): data is WolfxEarthquakeData {
    if (!data || typeof data !== 'object') return false;

    // 必須フィールドの存在チェック
    const requiredFields = [
      'type',
      'EventID',
      'AnnouncedTime',
      'Hypocenter',
      'Latitude',
      'Longitude',
      'Magunitude',
      'Depth',
      'MaxIntensity',
    ];

    for (const field of requiredFields) {
      if (!(field in data)) {
        this.log(`地震データに必須フィールド ${field} がありません`);
        return false;
      }
    }

    // データ型の検証
    if (
      typeof data.EventID !== 'string' ||
      typeof data.Hypocenter !== 'string' ||
      typeof data.MaxIntensity !== 'string'
    ) {
      this.log('地震データの型が正しくありません');
      return false;
    }

    // 数値フィールドの検証
    if (
      isNaN(Number(data.Latitude)) ||
      isNaN(Number(data.Longitude)) ||
      isNaN(Number(data.Magunitude)) ||
      isNaN(Number(data.Depth))
    ) {
      this.log('地震データの数値フィールドが無効です');
      return false;
    }

    return true;
  }

  @bindThis
  private shouldReportEarthquake(data: WolfxEarthquakeData): boolean {
    // 震度の数値変換
    const intensityValue = this.convertIntensityToNumber(data.MaxIntensity);

    // 震度条件の確認
    const minIntensityThreshold =
      config.earthquakeWarning?.minIntensityThreshold ?? 3;
    if (intensityValue < minIntensityThreshold) {
      return false; // 最小震度未満は無視
    }

    const minMagunitudeForWeak =
      config.earthquakeWarning?.minMagunitudeForWeak ?? 4.0;
    if (intensityValue < 4 && data.Magunitude < minMagunitudeForWeak) {
      return false; // 震度4未満かつマグニチュード基準未満は無視
    }

    return true;
  }

  @bindThis
  private async processNewEarthquake(data: WolfxEarthquakeData): Promise<void> {
    // 既存のイベントをチェック
    const existingEvent = this.activeEvents.get(data.EventID);
    if (existingEvent && existingEvent.connectionId !== this.connectionId) {
      this.log(`他の接続で既に処理されているイベントです: ${data.EventID}`);
      return;
    }

    const message = this.generateEarthquakeMessage(data, true);
    const finalMessage = data.isFinal ? `【最終報】\n${message}` : message;

    try {
      const post = await this.ai.post({
        text: finalMessage,
      });

      this.activeEvents.set(data.EventID, {
        eventId: data.EventID,
        initialPostId: post.id,
        lastUpdate: Date.now(),
        reportCount: 1,
        isFinal: data.isFinal,
        isCancel: data.isCancel,
        connectionId: this.connectionId,
      });

      if (data.isFinal) {
        this.log(
          `新しい地震速報（最終報）を送信しました: ${data.Hypocenter} M${data.Magunitude}`
        );
        this.scheduleEventCleanup(data.EventID);
      } else {
        this.log(
          `新しい地震速報を送信しました: ${data.Hypocenter} M${data.Magunitude}`
        );
      }
    } catch (error) {
      this.log(`メッセージ送信エラー: ${error}`);
    }
  }

  @bindThis
  private async processUpdateReport(
    data: WolfxEarthquakeData,
    existingEvent: EarthquakeEvent
  ): Promise<void> {
    // 接続IDのチェック
    if (existingEvent.connectionId !== this.connectionId) {
      this.log(
        `他の接続で処理されているイベントの更新は無視します: ${data.EventID}`
      );
      return;
    }

    const reportNumber = existingEvent.reportCount + 1;
    const message = `【続報 #${reportNumber}】\n${this.generateEarthquakeMessage(
      data,
      false
    )}`;

    try {
      await this.ai.post({
        text: message,
        replyId: existingEvent.initialPostId,
      });

      this.activeEvents.set(data.EventID, {
        ...existingEvent,
        lastUpdate: Date.now(),
        reportCount: reportNumber,
      });

      this.log(
        `地震速報の続報を送信しました: ${data.Hypocenter} M${data.Magunitude}`
      );
    } catch (error) {
      this.log(`続報送信エラー: ${error}`);
    }
  }

  @bindThis
  private async processCancellation(
    data: WolfxEarthquakeData,
    existingEvent: EarthquakeEvent
  ): Promise<void> {
    if (existingEvent.connectionId !== this.connectionId) {
      this.log(
        `他の接続で処理されているイベントのキャンセルは無視します: ${data.EventID}`
      );
      return;
    }

    const message = `さっきの地震速報は取り消されました。実際の揺れはなかったようです。`;

    try {
      await this.ai.post({
        text: message,
        replyId: existingEvent.initialPostId,
      });

      this.activeEvents.set(data.EventID, {
        ...existingEvent,
        isCancel: true,
        lastUpdate: Date.now(),
      });

      this.log(`地震速報のキャンセルを送信しました: ${data.EventID}`);
      this.scheduleEventCleanup(data.EventID);
    } catch (error) {
      this.log(`キャンセル送信エラー: ${error}`);
    }
  }

  @bindThis
  private async processFinalReport(
    data: WolfxEarthquakeData,
    existingEvent: EarthquakeEvent
  ): Promise<void> {
    if (existingEvent.connectionId !== this.connectionId) {
      this.log(
        `他の接続で処理されているイベントの最終報は無視します: ${data.EventID}`
      );
      return;
    }

    if (existingEvent.isFinal) {
      this.log(`すでに最終報として処理済みのイベントです: ${data.EventID}`);
      return;
    }

    const message = `【最終報】\n${this.generateEarthquakeMessage(
      data,
      false
    )}`;

    try {
      await this.ai.post({
        text: message,
        replyId: existingEvent.initialPostId,
      });

      this.activeEvents.set(data.EventID, {
        ...existingEvent,
        isFinal: true,
        lastUpdate: Date.now(),
      });

      this.log(`地震速報の最終報を送信しました: ${data.EventID}`);
      this.scheduleEventCleanup(data.EventID);
    } catch (error) {
      this.log(`最終報送信エラー: ${error}`);
    }
  }

  @bindThis
  private generateEarthquakeMessage(
    data: WolfxEarthquakeData,
    isInitial: boolean
  ): string {
    let message = '';
    const intensityValue = this.convertIntensityToNumber(data.MaxIntensity);

    // 初回メッセージの場合のみ、震度に応じた反応を追加
    if (isInitial) {
      if (intensityValue < 4) {
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
      } else if (intensityValue === 4) {
        message += this.randomChoice([
          'ゆれ……！',
          '地震です！！',
          '結構揺れます！',
        ]);
      } else if (intensityValue === 5) {
        message += this.randomChoice([
          'ゆれます……！　おおきいです！！',
          'かなり揺れます！',
        ]);
      } else if (intensityValue === 6) {
        message += this.randomChoice([
          '大地震です！！',
          'めちゃくちゃ揺れます！',
        ]);
      } else if (intensityValue >= 7) {
        message += this.randomChoice(['！！　大地震です！！']);
      }

      message += '\n\n';
    }

    const announcedTime = this.formatJSTDateTime(new Date(data.AnnouncedTime));
    message += `${announcedTime}、地震速報を受信しました！\n`;
    message += `${data.Hypocenter}付近で震度${this.convertIntensityDisplay(
      data.MaxIntensity
    )}の揺れが予想されます！\n`;
    message += `マグニチュードは${data.Magunitude}、震源の深さは約${data.Depth}kmです。\n`;

    // 警報の場合は特別な表示
    if (data.isWarn) {
      message += `\n⚠️ これは警報です！強い揺れに注意してください ⚠️\n`;
    }

    // 震源精度情報がある場合
    if (data.Accuracy) {
      const accuracyInfo: string[] = [];
      if (data.Accuracy.Epicenter && data.Accuracy.Epicenter !== '不明') {
        accuracyInfo.push(`震源: ${data.Accuracy.Epicenter}`);
      }
      if (data.Accuracy.Magnitude && data.Accuracy.Magnitude !== '不明') {
        accuracyInfo.push(`M: ${data.Accuracy.Magnitude}`);
      }
      if (data.Accuracy.Depth && data.Accuracy.Depth !== '不明') {
        accuracyInfo.push(`深さ: ${data.Accuracy.Depth}`);
      }

      if (accuracyInfo.length > 0) {
        message += `\n精度情報: ${accuracyInfo.join('、')}\n`;
      }
    }

    // 震度変更情報がある場合
    if (data.MaxIntChange && data.MaxIntChange.String) {
      // 震度表示を変換
      const convertedString = data.MaxIntChange.String.replace(
        '震度5-',
        '震度5弱'
      )
        .replace('震度5+', '震度5強')
        .replace('震度6-', '震度6弱')
        .replace('震度6+', '震度6強');

      message += `\n震度情報が変更されました: ${convertedString}\n`;
      if (data.MaxIntChange.Reason) {
        message += `変更理由: ${data.MaxIntChange.Reason}\n`;
      }
    }

    // 更新情報の追加（初回以外で表示）
    if (!isInitial && this.lastEarthquakeData.has(data.EventID)) {
      const lastData = this.lastEarthquakeData.get(data.EventID);
      if (lastData) {
        const updates: string[] = [];

        // マグニチュードの変化
        if (lastData.Magunitude !== data.Magunitude) {
          const diff = data.Magunitude - lastData.Magunitude;
          const direction = diff > 0 ? '上方' : '下方';
          updates.push(
            `マグニチュード: ${lastData.Magunitude} → ${data.Magunitude} (${direction}修正)`
          );
        }

        // 震源の深さの変化
        if (lastData.Depth !== data.Depth) {
          const diff = data.Depth - lastData.Depth;
          updates.push(
            `震源の深さ: ${lastData.Depth}km → ${data.Depth}km (${
              diff > 0 ? '深く' : '浅く'
            }修正)`
          );
        }

        // 震度の変化（MaxIntChangeとは別に、単純な前回との比較）
        if (lastData.MaxIntensity !== data.MaxIntensity) {
          updates.push(
            `震度: ${this.convertIntensityDisplay(
              lastData.MaxIntensity
            )} → ${this.convertIntensityDisplay(data.MaxIntensity)}`
          );
        }

        if (updates.length > 0) {
          message += '\n📊 前回からの更新情報:\n';
          updates.forEach((update) => {
            message += `・${update}\n`;
          });
        }
      }
    }

    // 警戒地域情報がある場合
    if (data.WarnArea && data.WarnArea.length > 0) {
      message += `\n警戒地域:\n`;
      for (let i = 0; i < Math.min(data.WarnArea.length, 5); i++) {
        // 最大5地域まで表示
        const area = data.WarnArea[i];
        message += `- ${area.Chiiki}: 震度${this.convertIntensityDisplay(
          area.Shindo1
        )}～${this.convertIntensityDisplay(area.Shindo2)} (${area.Type})\n`;
      }
      if (data.WarnArea.length > 5) {
        message += `他${data.WarnArea.length - 5}地域...\n`;
      }
    }

    // データを保存して次回の比較に使用
    this.lastEarthquakeData.set(data.EventID, { ...data });

    return message;
  }

  // ユーティリティ関数
  @bindThis
  private convertIntensityToNumber(intensity: string): number {
    // 入力検証
    if (!intensity || typeof intensity !== 'string') {
      this.log(`無効な震度文字列: ${intensity}`);
      return 0;
    }

    // 震度文字列を数値に変換 (互換性を保持しつつ処理)
    if (intensity.includes('7')) return 7;
    if (intensity.includes('6+') || intensity.includes('6強')) return 6;
    if (intensity.includes('6-') || intensity.includes('6弱')) return 6;
    if (intensity.includes('5+') || intensity.includes('5強')) return 5;
    if (intensity.includes('5-') || intensity.includes('5弱')) return 5;
    if (intensity.includes('4')) return 4;
    if (intensity.includes('3')) return 3;
    if (intensity.includes('2')) return 2;
    if (intensity.includes('1')) return 1;
    return 0;
  }

  @bindThis
  private convertIntensityDisplay(intensity: string): string {
    // -/+ を 弱/強 に変換して表示する (元のデータは変更しない)
    return intensity
      .replace('5-', '5弱')
      .replace('5+', '5強')
      .replace('6-', '6弱')
      .replace('6+', '6強');
  }

  @bindThis
  private formatJSTDateTime(date: Date): string {
    return (
      date.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' JST'
    );
  }

  @bindThis
  private randomChoice(a: Array<string>): string {
    const r = Math.floor(Math.random() * a.length);
    return a[r];
  }

  private scheduleEventCleanup(eventId: string): void {
    setTimeout(() => {
      this.activeEvents.delete(eventId);
      this.lastEarthquakeData.delete(eventId);
    }, 3600000); // 1時間後
  }
}
