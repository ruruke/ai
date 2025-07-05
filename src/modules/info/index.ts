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

    reply += `\n💡 このメッセージはマスターユーザーのみに表示されています`;

    return reply;
  }
}
