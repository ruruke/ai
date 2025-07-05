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
type GCType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'symbol'
  | 'bigint'
  | 'undefined'
  | 'object'
  | 'function'
  | 'all';
type DatabaseStats = {
  collections: number;
  documents: number;
  size: number;
  lastModified: Date | null;
};
// ガベージコレクション統計
const gcStats = {
  totalGCTime: 0,
  totalGCCount: 0,
  lastGCType: 'none' as string | GCType,
  lastGCDuration: 0,
};

// GC関数のラッパー
function setupGCMonitoring() {
  // @ts-ignore - Node.jsのグローバルGC関数
  if (typeof global.gc !== 'function') return;

  // @ts-ignore - Node.jsのグローバルGC関数
  const originalGC: (options?: any) => any = global.gc;

  // @ts-ignore - Node.jsの型定義に合わせる
  global.gc = function wrappedGC(options?: any) {
    const start = process.hrtime();

    try {
      // 元のGC関数を呼び出し
      const result = originalGC(options);

      // 非同期GCの場合はPromiseを待機
      if (result && typeof result.then === 'function') {
        return result.then(() => {
          updateGCStats(start, options);
        }) as Promise<void>;
      }

      // 同期GCの場合は即時更新
      updateGCStats(start, options);
      return result;
    } catch (error) {
      console.error('GC error:', error);
      throw error;
    }
  };
}

// 起動時にGCモニタリングをセットアップ
setupGCMonitoring();

// バージョン情報の取得（シンプルな方法）
let version = 'unknown';
try {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')
  );
  version = pkg._v || pkg.version || 'development';
} catch (e) {
  console.error('Failed to get version:', e);
}

// イベントループ遅延計測用
let eventLoopDelay = 0;
let eventLoopMeasureInterval: NodeJS.Timeout | null = null;

// データベース統計
let dbStats: DatabaseStats = {
  collections: 0,
  documents: 0,
  size: 0,
  lastModified: null,
};

/**
 * イベントループの監視を開始
 */
function startEventLoopMonitoring() {
  if (eventLoopMeasureInterval) return;

  let last = process.hrtime();
  eventLoopMeasureInterval = setInterval(() => {
    const start = process.hrtime();
    const diff = process.hrtime(last);
    const diffInMs = diff[0] * 1000 + diff[1] / 1e6;
    eventLoopDelay = Math.max(0, diffInMs - 1000); // 1000msからの差分（負の値にならないように）
    last = start;
  }, 1000);
}

/**
 * GC統計を更新
 */
function updateGCStats(start: [number, number], options?: any) {
  const diff = process.hrtime(start);
  const duration = diff[0] * 1000 + diff[1] / 1e6; // ms

  gcStats.totalGCTime += duration;
  gcStats.totalGCCount++;

  if (options && typeof options === 'object') {
    gcStats.lastGCType = options.type || 'unknown';
  } else if (options === true) {
    gcStats.lastGCType = 'full';
  } else if (options === false) {
    gcStats.lastGCType = 'incremental';
  } else {
    gcStats.lastGCType = 'default';
  }

  gcStats.lastGCDuration = duration;
}

/**
 * データベース統計を更新
 */
function updateDatabaseStats(ai: AI) {
  try {
    const db = (ai as any).dbManager as DatabaseManager;
    if (!db) return;

    // DatabaseManagerで管理されているコレクションを直接リストアップ
    const collections = [
      db.meta,
      db.contexts,
      db.timers,
      db.friends,
      db.moduleData,
    ].filter(c => c != null); // 未初期化の場合を考慮してnullを除外

    let totalDocuments = 0;
    let totalSize = 0;

    for (const collection of collections) {
      totalDocuments += collection.count();
      // 各コレクションのデータサイズをJSON文字列化して概算
      totalSize += JSON.stringify(collection.data).length;
    }

    dbStats = {
      collections: collections.length,
      documents: totalDocuments,
      size: totalSize,
      lastModified: new Date(), // 正確な最終更新時刻が取得できないため現在時刻を使用
    };
  } catch (e) {
    console.error('Failed to update database stats:', e);
    dbStats = {
      collections: 0,
      documents: 0,
      size: 0,
      lastModified: null,
    };
  }
}

/**
 * メモリ使用量をフォーマット
 */
function formatMemoryUsage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 稼働時間をフォーマット
 */
function formatUptime(uptime: number): string {
  const days = Math.floor(uptime / (24 * 60 * 60));
  const hours = Math.floor((uptime % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((uptime % (60 * 60)) / 60);
  const seconds = Math.floor(uptime % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}日`);
  if (hours > 0) parts.push(`${hours}時間`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);

  return parts.join(' ');
}

/**
 * 日付をフォーマット
 */
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

  constructor() {
    super();
    startEventLoopMonitoring();
  }

  @bindThis
  public install() {
    return {
      mentionHook: this.mentionHook,
    };
  }

  @bindThis
  private async mentionHook(msg: Message) {
    if (!msg.includes(['info'])) return false;

    // データベース統計を更新
    updateDatabaseStats(this.ai);

    const uptime = (Date.now() - this.startTime) / 1000;
    const mem = process.memoryUsage();
    const isMaster =
      msg.user.username === config.master && msg.user.host == null;

    let response = `ℹ️ バージョン: ${version}\n`;

    // マスターユーザーのみ詳細情報を表示
    if (isMaster) {
      // システム情報
      response += `\n🖥️ システム情報\n`;
      response += `- ホスト: ${config.host}\n`;
      response += `- サーバー名: ${config.serverName || '未設定'}\n`;
      response += `- 稼働時間: ${formatUptime(uptime)}\n`;
      response += `- 起動時刻: ${formatDate(new Date(this.startTime))}\n`;

      // パフォーマンス情報
      response += `\n⚡ パフォーマンス\n`;
      response += `- イベントループ遅延: ${eventLoopDelay.toFixed(2)}ms\n`;
      response += `- イベントループ使用率: ${Math.min(100, (eventLoopDelay / 10) * 100).toFixed(1)}%\n`;

      // ガベージコレクション統計
      if (global.gc) {
        response += `\n🗑️ ガベージコレクション\n`;
        response += `- 総実行回数: ${gcStats.totalGCCount.toLocaleString()}\n`;
        response += `- 総実行時間: ${gcStats.totalGCTime.toFixed(2)}ms\n`;
        response += `- 最終実行: ${gcStats.lastGCType} (${gcStats.lastGCDuration.toFixed(2)}ms)\n`;
      }

      // メモリ使用量
      response += `\n🧠 メモリ使用量\n`;
      response += `- RSS: ${formatMemoryUsage(mem.rss)}\n`;
      response += `- ヒープ使用量: ${formatMemoryUsage(mem.heapUsed)} / ${formatMemoryUsage(mem.heapTotal)}\n`;
      response += `- 外部メモリ: ${formatMemoryUsage(mem.external)}\n`;
      response += `- ヒープ使用率: ${((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)}%\n`;

      // データベース統計
      response += `\n💾 データベース\n`;
      response += `- コレクション数: ${dbStats.collections.toLocaleString()}\n`;
      response += `- ドキュメント数: ${dbStats.documents.toLocaleString()}\n`;
      response += `- データサイズ: ${formatMemoryUsage(dbStats.size)} (概算)\n`;

      // ロード済みモジュール
      const loadedModules = Object.entries(this.ai.modules)
        .filter(([key]) => key !== 'index')
        .sort(([a], [b]) => a.localeCompare(b));

      response += `\n📦 ロード済みモジュール (${loadedModules.length})\n`;
      loadedModules.forEach(([name, module]) => {
        response += `- ${name}`;
        if (module.name) response += ` (${module.name})`;
        response += '\n';
      });

      // システム情報（CPU・メモリ）
      response += `\n💻 システムリソース\n`;
      response += `- OS: ${os.type()} ${os.release()} (${os.arch()})\n`;
      response += `- CPU: ${os.cpus()[0]?.model} (${os.cpus().length}コア)\n`;
      response += `- メモリ: ${formatMemoryUsage(os.totalmem() - os.freemem())} / ${formatMemoryUsage(os.totalmem())}\n`;

      // ヒント
      response += `\n💡 このメッセージはマスターユーザーのみに表示されています`;
    } else {
      response += `\n⚠️ 詳細情報を表示する権限がありません`;
    }

    msg.reply(response);

    return {
      reaction: '💾'
    };
  }
}

