import { v4 as uuid } from 'uuid';
import { bindThis } from '@/decorators.js';
import type DatabaseManager from '@/database/DatabaseManager.js';
import log from '@/utils/log.js';
import chalk from 'chalk';

type TimeoutCallback = (data?: any) => void;
type Module = {
  name: string;
  [key: string]: any;
};

/**
 * タイマー管理クラス
 * 永続化されたタイマーの管理と監視を担当
 */
export default class TimerManager {
  private dbManager: DatabaseManager;
  private timeoutCallbacks: { [moduleName: string]: TimeoutCallback };
  private monitoringInterval?: NodeJS.Timeout;

  constructor(
    dbManager: DatabaseManager,
    timeoutCallbacks: { [moduleName: string]: TimeoutCallback }
  ) {
    this.dbManager = dbManager;
    this.timeoutCallbacks = timeoutCallbacks;
  }

  @bindThis
  private log(msg: string) {
    log(`[${chalk.yellow('TimerManager')}]: ${msg}`);
  }

  /**
   * タイマー監視を開始します
   */
  @bindThis
  public startMonitoring() {
    // 初回実行
    this.crawleTimer();

    // 1秒間隔で監視
    this.monitoringInterval = setInterval(this.crawleTimer, 1000);
    this.log('Timer monitoring started');
  }

  /**
   * タイマー監視を停止します
   */
  @bindThis
  public stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.log('Timer monitoring stopped');
    }
  }

  /**
   * 指定したミリ秒経過後に、そのモジュールのタイムアウトコールバックを呼び出します。
   * このタイマーは記憶に永続化されるので、途中でプロセスを再起動しても有効です。
   * @param module モジュール名
   * @param delay ミリ秒
   * @param data オプションのデータ
   */
  @bindThis
  public setTimeoutWithPersistence(module: Module, delay: number, data?: any) {
    const id = uuid();
    const timers = this.dbManager.getCollection('timers');

    timers.insertOne({
      id: id,
      module: module.name,
      insertedAt: Date.now(),
      delay: delay,
      data: data,
    });

    this.log(`Timer persisted: ${module.name} ${id} ${delay}ms`);
  }

  /**
   * タイマーをチェックし、期限切れのタイマーを実行します
   */
  @bindThis
  private crawleTimer() {
    const timers = this.dbManager.getCollection('timers');
    const timerList = timers.find();

    for (const timer of timerList) {
      // タイマーが時間切れかどうか
      if (Date.now() - (timer.insertedAt + timer.delay) >= 0) {
        this.log(`Timer expired: ${timer.module} ${timer.id}`);
        timers.remove(timer);

        // コールバックが存在する場合のみ実行
        if (this.timeoutCallbacks[timer.module]) {
          this.timeoutCallbacks[timer.module](timer.data);
        } else {
          this.log(`Warning: No timeout callback for module ${timer.module}`);
        }
      }
    }
  }

  /**
   * タイムアウトコールバックを更新します
   */
  @bindThis
  public updateTimeoutCallbacks(timeoutCallbacks: {
    [moduleName: string]: TimeoutCallback;
  }) {
    this.timeoutCallbacks = timeoutCallbacks;
  }
}
