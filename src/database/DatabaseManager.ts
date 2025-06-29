import loki from 'lokijs';
import { bindThis } from '@/decorators.js';
import config from '@/config.js';
import chalk from 'chalk';
import type { Meta } from '@/ai.js';

/**
 * データベース管理クラス
 * LokiJSデータベースの初期化と管理を担当
 */
export default class DatabaseManager {
  public db: loki;
  public meta!: loki.Collection<Meta>;
  public contexts!: loki.Collection<{
    isChat: boolean;
    noteId?: string;
    userId?: string;
    module: string;
    key: string | null;
    data?: any;
  }>;
  public timers!: loki.Collection<{
    id: string;
    module: string;
    insertedAt: number;
    delay: number;
    data?: any;
  }>;
  public friends!: loki.Collection<any>;
  public moduleData!: loki.Collection<any>;

  constructor(onReady: () => void, onError: (err: any) => void) {
    let memoryDir = '.';
    if (config.memoryDir) {
      memoryDir = config.memoryDir;
    }
    const file =
      process.env.NODE_ENV === 'test'
        ? `${memoryDir}/test.memory.json`
        : `${memoryDir}/memory.json`;

    this.db = new loki(file, {
      autoload: true,
      autosave: true,
      autosaveInterval: 1000,
      autoloadCallback: (err) => {
        if (err) {
          onError(err);
        } else {
          this.initializeCollections();
          onReady();
        }
      },
    });
  }

  /**
   * データベースコレクションを初期化
   */
  @bindThis
  private initializeCollections() {
    this.meta = this.getCollection('meta', {});
    this.contexts = this.getCollection('contexts', {
      indices: ['key'],
    });
    this.timers = this.getCollection('timers', {
      indices: ['module'],
    });
    this.friends = this.getCollection('friends', {
      indices: ['userId'],
    });
    this.moduleData = this.getCollection('moduleData', {
      indices: ['module'],
    });
  }

  /**
   * コレクションを取得、存在しない場合は作成
   */
  @bindThis
  public getCollection(name: string, opts?: any): loki.Collection {
    let collection: loki.Collection;

    collection = this.db.getCollection(name);

    if (collection == null) {
      collection = this.db.addCollection(name, opts);
    }

    return collection;
  }

  /**
   * メタデータを取得
   */
  @bindThis
  public getMeta(): Meta {
    const rec = this.meta.findOne();

    if (rec) {
      return rec;
    } else {
      const initial: Meta = {
        lastWakingAt: Date.now(),
      };

      this.meta.insertOne(initial);
      return initial;
    }
  }

  /**
   * メタデータを更新
   */
  @bindThis
  public setMeta(meta: Partial<Meta>) {
    const rec = this.getMeta();

    for (const [k, v] of Object.entries(meta)) {
      rec[k] = v;
    }

    this.meta.update(rec);
  }
}
