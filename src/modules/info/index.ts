import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import type { default as AI } from '@/ai.js';
import type Message from '@/message.js';
import config from '@/config.js';
import type DatabaseManager from '@/database/DatabaseManager.js';
import * as fs from 'fs';
import path from 'path';
import os from 'os';

// 型定義
declare namespace NodeJS {
  interface Global {
    gc?(minor?: boolean): void;
    gc?(options: { type?: 'major' | 'minor' | 'major-snapshot' }): void;
    gc?(options: {
      type?: 'major' | 'minor' | 'major-snapshot';
      execution: 'async';
    }): Promise<void>;
  }
}

type GCType =
  | 'major'
  | 'minor'
  | 'full'
  | 'incremental'
  | 'unknown'
  | 'none'
  | 'major-snapshot';

type DatabaseStats = {
  collections: number;
  documents: number;
  size: number;
};

const DEFAULT_CONFIG = {
  eventLoopMonitoringInterval: 1000,
  enableGCMonitoring: true,
  precision: 2,
};

// グローバル変数・状態
const gcStats = {
  totalGCTime: 0,
  totalGCCount: 0,
  lastGCType: 'none' as GCType,
  lastGCDuration: 0,
};

let version = 'unknown';
let eventLoopDelay = 0;
let dbStats: DatabaseStats = {
  collections: 0,
  documents: 0,
  size: 0,
};

// ユーティリティ関数
function isPromise(p: any): p is Promise<any> {
  return p !== null && typeof p === 'object' && typeof p.then === 'function';
}

// 初期化処理
/**
 * バージョン情報をpackage.jsonから取得します。
 */
function initializeVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')
    );
    version = pkg._v || pkg.version || 'development';
  } catch (e) {
    console.error(
      'Failed to get version:',
      e instanceof Error ? e.message : String(e)
    );
  }
}

/**
 * GC監視をセットアップします。
 * Node.jsの--expose-gcフラグが必要です。
 */
function setupGCMonitoring() {
  if (!config.info?.enableGCMonitoring || typeof global.gc !== 'function') {
    console.warn(
      'GC function is not available. To enable, run Node.js with the --expose-gc flag.'
    );
    return;
  }

  const originalGC = global.gc;

  const wrappedGC = (
    arg?:
      | boolean
      | { type?: 'major' | 'minor' | 'major-snapshot'; execution?: 'async' }
  ): undefined | Promise<void> => {
    const start = process.hrtime();
    try {
      let result: any;
      let gcType: GCType = 'unknown';

      if (typeof arg === 'boolean') {
        result = originalGC(arg);
        gcType = arg ? 'major' : 'minor';
      } else if (arg && typeof arg === 'object') {
        result = originalGC(arg);
        gcType = arg.type || 'unknown';
      } else {
        result = originalGC();
        gcType = 'unknown';
      }

      if (isPromise(result)) {
        return result.then(() => {
          updateGCStats(start, gcType);
        });
      }

      updateGCStats(start, gcType);
      return result;
    } catch (error) {
      console.error(
        'GC error:',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  };

  global.gc = wrappedGC as NodeJS.Global['gc'];
}

initializeVersion();
setupGCMonitoring();

// 統計更新関数
/**
 * GC統計を更新します。
 */
function updateGCStats(start: [number, number], type: GCType = 'unknown') {
  const diff = process.hrtime(start);
  const duration = diff[0] * 1000 + diff[1] / 1e6; // ms

  gcStats.totalGCTime += duration;
  gcStats.totalGCCount++;
  gcStats.lastGCType = type;
  gcStats.lastGCDuration = duration;
}

/**
 * データベース統計を非同期で更新します。
 */
async function updateDatabaseStats(ai: AI): Promise<void> {
  try {
    const stats = ai.getDatabaseStats();
    dbStats = stats;
  } catch (error) {
    console.error(
      'Failed to update database stats:',
      error instanceof Error ? error.message : String(error)
    );
    dbStats = { collections: 0, documents: 0, size: 0 }; // エラー時はリセット
  }
}

// フォーマット関数
function formatMemoryUsage(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const precision = config.info?.precision ?? DEFAULT_CONFIG.precision;
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(precision))} ${
    sizes[i]
  }`;
}

function formatUptime(uptime: number): string {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  return [
    days > 0 ? `${days}日` : '',
    hours > 0 ? `${hours}時間` : '',
    minutes > 0 ? `${minutes}分` : '',
    `${seconds}秒`,
  ]
    .filter(Boolean)
    .join('');
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '不明';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

// 設定表示用の定数とヘルパー関数
const CONFIG_LABELS = {
  sections: {
    basicFeatures: '**基本機能:**',
    gameFeatures: '**ゲーム機能:**',
    postSettings: '**投稿設定:**',
    aiFeatures: '**AI機能:**',
    earthquake: '**地震速報:**',
    pressure: '**気圧監視:**',
    others: '**その他:**',
  },
  basic: {
    keywordEnabled: 'キーワード検索',
    reversiEnabled: 'リバーシ',
    notingEnabled: '自動単語',
    chartEnabled: 'チャート',
    timeSignalEnabled: '時刻通知',
    serverMonitoring: 'サーバー監視',
    checkEmojisEnabled: '絵文字チェック',
  },
  game: {
    mazeEnable: '迷路',
    pollEnable: '投票',
  },
  post: {
    postNotPublic: 'パブリック投稿制限',
    defaultVisibility: 'デフォルト公開範囲',
  },
  ai: {
    enabled: 'Gemini',
    model: 'モデル',
    thinkingBudget: '思考予算',
    autoNoteEnabled: '自動ノート',
    autoNoteProbability: '投稿確率',
    autoNoteInterval: '投稿間隔',
    autoNoteDisableNight: '夜間投稿無効',
    randomTalkEnabled: 'ランダムトーク',
    randomTalkProbability: '反応確率',
    randomTalkFollowingOnly: 'フォロー限定',
    chatEnabled: 'チャット',
    chatGrounding: 'Google検索連携',
  },
  earthquake: {
    enable: '地震速報',
    minIntensity: '最小震度閾値',
    minMagnitude: '弱震時の最小規模',
  },
  pressure: {
    minPostLevel: '最小投稿レベル',
    updateInterval: '更新間隔',
  },
  others: {
    weatherAutoNoteHour: '天気自動投稿時刻',
    weatherAutoNotePref: '天気地域設定',
    imagenEnabled: 'Imagen',
    imagenModel: 'Imagenモデル',
  },
} as const;

const DEFAULTS = {
  notSet: '未設定',
  enabled: '✅',
  disabled: '❌',
} as const;

function safeConfigValue<T>(
  value: T | null | undefined,
  fallback: string = DEFAULTS.notSet
): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function formatBooleanSetting(value: boolean | undefined): string {
  return value ? DEFAULTS.enabled : DEFAULTS.disabled;
}

function formatBasicFeatures(): string {
  const lines: string[] = [
    CONFIG_LABELS.sections.basicFeatures,
    `- ${CONFIG_LABELS.basic.keywordEnabled}: ${formatBooleanSetting(
      config.keywordEnabled
    )}`,
    `- ${CONFIG_LABELS.basic.reversiEnabled}: ${formatBooleanSetting(
      config.reversiEnabled
    )}`,
    `- ${CONFIG_LABELS.basic.notingEnabled}: ${formatBooleanSetting(
      config.notingEnabled
    )}`,
    `- ${CONFIG_LABELS.basic.chartEnabled}: ${formatBooleanSetting(
      config.chartEnabled
    )}`,
    `- ${CONFIG_LABELS.basic.timeSignalEnabled}: ${formatBooleanSetting(
      config.timeSignalEnabled
    )}`,
    `- ${CONFIG_LABELS.basic.serverMonitoring}: ${formatBooleanSetting(
      config.serverMonitoring
    )}`,
    `- ${CONFIG_LABELS.basic.checkEmojisEnabled}: ${formatBooleanSetting(
      config.checkEmojisEnabled
    )}`,
  ];
  return lines.join('\n') + '\n';
}

function formatGameFeatures(): string {
  const lines: string[] = [
    CONFIG_LABELS.sections.gameFeatures,
    `- ${CONFIG_LABELS.game.mazeEnable}: ${formatBooleanSetting(
      config.mazeEnable
    )}`,
    `- ${CONFIG_LABELS.game.pollEnable}: ${formatBooleanSetting(
      config.pollEnable
    )}`,
  ];
  return lines.join('\n') + '\n';
}

function formatPostSettings(): string {
  const lines: string[] = [
    CONFIG_LABELS.sections.postSettings,
    `- ${CONFIG_LABELS.post.postNotPublic}: ${formatBooleanSetting(
      config.postNotPublic
    )}`,
    `- ${CONFIG_LABELS.post.defaultVisibility}: ${safeConfigValue(
      config.defaultVisibility
    )}`,
  ];
  return lines.join('\n') + '\n';
}

function formatAIFeatures(): string {
  if (!config.gemini) return '';

  const lines: string[] = [CONFIG_LABELS.sections.aiFeatures];

  lines.push(
    `- ${CONFIG_LABELS.ai.enabled}: ${formatBooleanSetting(
      config.gemini.enabled
    )}`
  );
  lines.push(
    `- ${CONFIG_LABELS.ai.model}: ${safeConfigValue(config.gemini.model)}`
  );
  lines.push(
    `- ${CONFIG_LABELS.ai.thinkingBudget}: ${safeConfigValue(
      config.gemini.thinkingBudget
    )}`
  );

  if (config.gemini.autoNote) {
    lines.push(
      `- ${CONFIG_LABELS.ai.autoNoteEnabled}: ${formatBooleanSetting(
        config.gemini.autoNote.enabled
      )}`
    );
    lines.push(
      `- ${CONFIG_LABELS.ai.autoNoteProbability}: ${safeConfigValue(
        config.gemini.autoNote.probability
      )}`
    );
    lines.push(
      `- ${CONFIG_LABELS.ai.autoNoteInterval}: ${safeConfigValue(
        config.gemini.autoNote.intervalMinutes
      )}分`
    );
    lines.push(
      `- ${CONFIG_LABELS.ai.autoNoteDisableNight}: ${formatBooleanSetting(
        config.gemini.autoNote.disableNightPosting
      )}`
    );
  }

  if (config.gemini.randomTalk) {
    lines.push(
      `- ${CONFIG_LABELS.ai.randomTalkEnabled}: ${formatBooleanSetting(
        config.gemini.randomTalk.enabled
      )}`
    );
    lines.push(
      `- ${CONFIG_LABELS.ai.randomTalkProbability}: ${safeConfigValue(
        config.gemini.randomTalk.probability
      )}`
    );
    lines.push(
      `- ${CONFIG_LABELS.ai.randomTalkFollowingOnly}: ${formatBooleanSetting(
        config.gemini.randomTalk.followingOnly
      )}`
    );
  }

  if (config.gemini.chat) {
    lines.push(
      `- ${CONFIG_LABELS.ai.chatEnabled}: ${formatBooleanSetting(
        config.gemini.chat.enabled
      )}`
    );
    lines.push(
      `- ${CONFIG_LABELS.ai.chatGrounding}: ${formatBooleanSetting(
        config.gemini.chat.groundingWithGoogleSearch
      )}`
    );
  }

  return lines.join('\n') + '\n';
}

function formatEarthquakeSettings(): string {
  const lines: string[] = [CONFIG_LABELS.sections.earthquake];

  // 地震速報機能の有効/無効
  lines.push(
    `- ${CONFIG_LABELS.earthquake.enable}: ${formatBooleanSetting(
      config.earthquakeWarning?.enabled
    )}`
  );

  // 地震警報の詳細設定（設定されている場合のみ）
  if (config.earthquakeWarning) {
    lines.push(
      `- ${CONFIG_LABELS.earthquake.minIntensity}: ${safeConfigValue(
        config.earthquakeWarning.minIntensityThreshold
      )}`
    );
    lines.push(
      `- ${CONFIG_LABELS.earthquake.minMagnitude}: ${safeConfigValue(
        config.earthquakeWarning.minMagunitudeForWeak
      )}`
    );
  }

  return lines.join('\n') + '\n';
}

function formatPressureSettings(): string {
  if (!config.kiatsu) return '';

  const updateIntervalMinutes = config.kiatsu.updateIntervalMs
    ? Math.floor(config.kiatsu.updateIntervalMs / 60000) + '分'
    : DEFAULTS.notSet;

  const lines: string[] = [
    CONFIG_LABELS.sections.pressure,
    `- ${CONFIG_LABELS.pressure.minPostLevel}: ${safeConfigValue(
      config.kiatsu.minPostLevel
    )}`,
    `- ${CONFIG_LABELS.pressure.updateInterval}: ${updateIntervalMinutes}`,
  ];

  return lines.join('\n') + '\n';
}

function formatOtherSettings(): string {
  const lines: string[] = [CONFIG_LABELS.sections.others];

  const weatherHour =
    config.weatherAutoNoteHour !== null &&
    config.weatherAutoNoteHour !== undefined
      ? `${config.weatherAutoNoteHour}時`
      : DEFAULTS.notSet;
  lines.push(`- ${CONFIG_LABELS.others.weatherAutoNoteHour}: ${weatherHour}`);
  lines.push(
    `- ${CONFIG_LABELS.others.weatherAutoNotePref}: ${safeConfigValue(
      config.weatherAutoNotePref
    )}`
  );

  if (config.imagen) {
    lines.push(
      `- ${CONFIG_LABELS.others.imagenEnabled}: ${formatBooleanSetting(
        config.imagen.enabled
      )}`
    );
    lines.push(
      `- ${CONFIG_LABELS.others.imagenModel}: ${safeConfigValue(
        config.imagen.model
      )}`
    );
  }

  return lines.join('\n') + '\n';
}

function formatSafeConfigInfo(): string {
  let configInfo = `\n⚙️ **設定情報**\n`;

  configInfo += formatBasicFeatures();
  configInfo += formatGameFeatures();
  configInfo += formatPostSettings();
  configInfo += formatAIFeatures();
  configInfo += formatEarthquakeSettings();
  configInfo += formatPressureSettings();
  configInfo += formatOtherSettings();

  return configInfo;
}

export default class InfoModule extends Module {
  public readonly name = 'info';
  private startTime = Date.now();
  private eventLoopMeasureInterval: ReturnType<typeof setInterval> | null =
    null;

  @bindThis
  public install() {
    this.startEventLoopMonitoring();
    return { mentionHook: this.mentionHook };
  }

  @bindThis
  public uninstall() {
    this.stopEventLoopMonitoring();
  }

  private startEventLoopMonitoring() {
    if (this.eventLoopMeasureInterval) return;
    const interval =
      config.info?.eventLoopMonitoringInterval ??
      DEFAULT_CONFIG.eventLoopMonitoringInterval;
    let last = process.hrtime();
    this.eventLoopMeasureInterval = setInterval(() => {
      const start = process.hrtime();
      const diff = process.hrtime(last);
      const diffInMs = diff[0] * 1000 + diff[1] / 1e6;
      eventLoopDelay = Math.max(0, diffInMs - interval);
      last = start;
    }, interval);
  }

  private stopEventLoopMonitoring() {
    if (this.eventLoopMeasureInterval) {
      clearInterval(this.eventLoopMeasureInterval);
      this.eventLoopMeasureInterval = null;
    }
  }

  @bindThis
  private async mentionHook(msg: Message) {
    if (!msg.includes(['info'])) return false;

    try {
      await updateDatabaseStats(this.ai);

      const isMaster =
        msg.user.username === config.master && msg.user.host === null;
      let response = `ℹ️ バージョン: ${version}\n`;

      if (isMaster) {
        response += this.formatMasterReply();
      } else {
        response += `\n⚠️ 詳細情報を表示する権限がありません`;
      }

      msg.reply(response);
      return { reaction: '💾' };
    } catch (error) {
      console.error(
        'Error in info mentionHook:',
        error instanceof Error ? error.message : String(error)
      );
      msg.reply('⚠️ 情報の取得中にエラーが発生しました。');
      return { reaction: '❌' };
    }
  }

  private formatMasterReply(): string {
    const uptime = (Date.now() - this.startTime) / 1000;
    const mem = process.memoryUsage();
    const precision = config.info?.precision ?? DEFAULT_CONFIG.precision;

    const loadedModules = this.ai.modules.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    let reply = `\n🖥️ **システム情報**\n`;
    reply += `- ホスト: ${config.host}\n`;
    reply += `- サーバー名: ${config.serverName || '未設定'}\n`;
    reply += `- 稼働時間: ${formatUptime(uptime)}\n`;
    reply += `- 起動時刻: ${formatDate(new Date(this.startTime))}\n`;

    reply += `\n⚡ **パフォーマンス**\n`;
    reply += `- イベントループ遅延: ${eventLoopDelay.toFixed(precision)}ms\n`;
    const interval =
      config.info?.eventLoopMonitoringInterval ??
      DEFAULT_CONFIG.eventLoopMonitoringInterval;
    const usage = Math.min(100, (eventLoopDelay / interval) * 100).toFixed(1);
    reply += `- イベントループ使用率: ${usage}%\n`;

    if (config.info?.enableGCMonitoring && global.gc) {
      reply += `\n🗑️ **ガベージコレクション**\n`;
      reply += `- 総実行回数: ${gcStats.totalGCCount.toLocaleString()}\n`;
      reply += `- 総実行時間: ${gcStats.totalGCTime.toFixed(precision)}ms\n`;
      reply += `- 最終実行: ${
        gcStats.lastGCType
      } (${gcStats.lastGCDuration.toFixed(precision)}ms)\n`;
    }

    reply += `\n🧠 **メモリ使用量**\n`;
    reply += `- RSS: ${formatMemoryUsage(mem.rss)}\n`;
    reply += `- ヒープ使用量: ${formatMemoryUsage(
      mem.heapUsed
    )} / ${formatMemoryUsage(mem.heapTotal)}\n`;
    reply += `- 外部メモリ: ${formatMemoryUsage(mem.external)}\n`;
    reply += `- ヒープ使用率: ${((mem.heapUsed / mem.heapTotal) * 100).toFixed(
      1
    )}%\n`;

    reply += `\n💾 **データベース**\n`;
    reply += `- コレクション数: ${dbStats.collections.toLocaleString()}\n`;
    reply += `- ドキュメント数: ${dbStats.documents.toLocaleString()}\n`;
    reply += `- データサイズ: ${formatMemoryUsage(dbStats.size)} (概算)\n`;

    reply += `\n📦 **ロード済みモジュール (${loadedModules.length})**\n`;
    reply += loadedModules.map((module) => `- ${module.name}`).join('\n');
    reply += '\n';

    reply += `\n💻 **システムリソース**\n`;
    reply += `- OS: ${os.type()} ${os.release()} (${os.arch()})\n`;
    const cpus = os.cpus();
    if (cpus.length > 0) {
      reply += `- CPU: ${cpus[0].model} (${cpus.length}コア)\n`;
    }
    reply += `- メモリ: ${formatMemoryUsage(
      os.totalmem() - os.freemem()
    )} / ${formatMemoryUsage(os.totalmem())}\n`;

    // 設定情報を追加
    reply += formatSafeConfigInfo();

    reply += `\n💡 このメッセージはマスターユーザーのみに表示されています`;

    return reply;
  }
}
